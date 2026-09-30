// lib/access/fulfilment-server.ts
// Exécution des demandes (phase 3b) — tâches d'exécution : libération,
// périmètre, revérification et mutations (réclamer, passer la main, bloquer,
// reprendre, confirmer, réconcilier, lots).
//
// Discipline de concurrence (D-20, même idiome que requests-server.ts) :
// toutes les lectures ET écritures d'une action se font dans UNE transaction
// Read Committed ; les écritures sont des `updateMany` conditionnels (état +
// révision) dont la clause WHERE est ré-évaluée par Postgres après le commit
// d'une transaction concurrente. Ordre de verrouillage IDENTIQUE partout pour
// éviter les interblocages : version de demande → tâche → tâche d'expiration
// supplantée → affectation.
import type { AccessRequest, AccessRequestVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { isAvailable } from "./roles";
import { taskActionForKind, type TaskOutcome } from "./fulfilment";

export type DbClient = Prisma.TransactionClient | typeof prisma;

export type FulfilmentErrorCode = "NOT_FOUND" | "STALE" | "INVALID_TRANSITION" | "VALIDATION";

/** Erreur typée (D-8) : NOT_FOUND → 404, STALE/INVALID_TRANSITION → 409, VALIDATION → 400. */
export class FulfilmentError extends Error {
  readonly code: FulfilmentErrorCode;
  constructor(code: FulfilmentErrorCode, message: string) {
    super(message);
    this.name = "FulfilmentError";
    this.code = code;
  }
}

export function fulfilmentErrorStatus(code: FulfilmentErrorCode): 400 | 404 | 409 {
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION") return 400;
  return 409;
}

/** Acteur du processeur 5 minutes dans l'audit (colonne sans FK, D-11). */
export const SYSTEM_ACTOR = "SYSTEM";

async function isUserAvailable(client: DbClient, orgId: string, userId: string): Promise<boolean> {
  const [user, profile] = await Promise.all([
    client.user.findFirst({ where: { id: userId, orgId }, select: { isActive: true } }),
    client.accessProfile.findUnique({ where: { userId }, select: { lifecycle: true } }),
  ]);
  return !!user && isAvailable({ userId, isActive: user.isActive, lifecycle: profile?.lifecycle ?? null });
}

/**
 * Actifs sur lesquels l'utilisateur exécute (D-5) : propriétaire OU suppléant,
 * archivés COMPRIS (le retrait doit rester possible, FP:110), lecteur
 * disponible exigé. Distinct de `getOwnedAssetIds` (registre, non archivés).
 * Accepte un `tx` pour les revérifications transactionnelles.
 */
export async function getFulfilmentAssetIds(client: DbClient, orgId: string, userId: string): Promise<string[]> {
  if (!(await isUserAvailable(client, orgId, userId))) return [];
  const assets = await client.accessAsset.findMany({
    where: { orgId, OR: [{ ownerId: userId }, { backupOwnerId: userId }] },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return assets.map((a) => a.id);
}

export interface ReleaseTaskInput {
  orgId: string;
  /** Utilisateur à l'origine du passage à READY_FOR_FULFILMENT, ou SYSTEM_ACTOR. */
  actorId: string;
  version: Pick<
    AccessRequestVersion,
    "id" | "kind" | "targetLevelId" | "periodStart" | "periodEnd" | "assignmentVersion"
  >;
  request: Pick<AccessRequest, "id" | "beneficiaryId" | "assetId">;
  correlationId?: string | null;
}

/**
 * Libère la tâche d'exécution d'une version autorisée (D-2), dans la
 * transaction de l'appelant. Idempotent : la clé `REQ:<versionId>` est
 * unique et l'insertion est un `INSERT … ON CONFLICT DO NOTHING`
 * (`skipDuplicates`) — une violation d'unicité avorterait la transaction
 * Postgres de l'appelant, un try/catch ne suffirait pas.
 */
export async function releaseTaskInTx(
  tx: Prisma.TransactionClient,
  input: ReleaseTaskInput
): Promise<{ taskId: string; created: boolean }> {
  const { orgId, version, request } = input;
  const idempotencyKey = `REQ:${version.id}`;
  const assignment = await tx.accessAssignment.findFirst({
    where: { orgId, userId: request.beneficiaryId, assetId: request.assetId },
    select: { levelId: true },
  });
  const action = taskActionForKind(version.kind);
  const { count } = await tx.accessFulfilmentTask.createMany({
    data: [
      {
        orgId,
        assetId: request.assetId,
        beneficiaryId: request.beneficiaryId,
        action,
        requestVersionId: version.id,
        fromLevelId: assignment?.levelId ?? null,
        toLevelId: version.targetLevelId,
        periodStart: version.periodStart,
        periodEnd: version.periodEnd,
        // Instantané approuvé : si l'affectation a bougé depuis, la
        // confirmation sera refusée (D-9) au lieu de s'appliquer à l'aveugle.
        expectedAssignmentVersion: version.assignmentVersion,
        idempotencyKey,
      },
    ],
    skipDuplicates: true,
  });
  const task = await tx.accessFulfilmentTask.findUniqueOrThrow({ where: { idempotencyKey }, select: { id: true } });
  if (count === 1) {
    const isSystem = input.actorId === SYSTEM_ACTOR;
    await tx.accessTaskEvent.create({
      data: {
        orgId,
        taskId: task.id,
        type: "RELEASED",
        actorId: isSystem ? null : input.actorId,
        actingAs: isSystem ? "SYSTEM" : null,
      },
    });
    await recordAuditInTx(tx, {
      orgId,
      actorId: input.actorId,
      actorRole: null,
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: request.assetId,
      eventType: "TASK_RELEASED",
      objectType: "AccessFulfilmentTask",
      objectId: task.id,
      objectVersion: 1,
      beneficiaryId: request.beneficiaryId,
      before: null,
      after: { action, state: "READY", requestVersionId: version.id, idempotencyKey },
      reason: null,
      outcome: "SUCCESS",
      correlationId: input.correlationId ?? null,
    });
  }
  return { taskId: task.id, created: count === 1 };
}

/**
 * Annule la tâche READY d'une version (annulation avant réclamation, D-19).
 * Renvoie false s'il n'y en a pas (version prête avant la phase 3b, que le
 * processeur n'a pas encore réparée).
 */
export async function cancelReadyTaskForVersionInTx(
  tx: Prisma.TransactionClient,
  input: { orgId: string; actorId: string; versionId: string; reason: string; outcome: TaskOutcome }
): Promise<boolean> {
  const task = await tx.accessFulfilmentTask.findFirst({
    where: { orgId: input.orgId, requestVersionId: input.versionId, state: "READY" },
    select: { id: true, revision: true, assetId: true, beneficiaryId: true },
  });
  if (!task) return false;
  const { count } = await tx.accessFulfilmentTask.updateMany({
    where: { id: task.id, state: "READY" },
    data: { state: "CANCELLED", outcome: input.outcome, revision: { increment: 1 } },
  });
  if (count === 0) return false;
  const isSystem = input.actorId === SYSTEM_ACTOR;
  await tx.accessTaskEvent.create({
    data: {
      orgId: input.orgId,
      taskId: task.id,
      type: "CANCELLED",
      actorId: isSystem ? null : input.actorId,
      actingAs: isSystem ? "SYSTEM" : null,
      reason: input.reason,
    },
  });
  await recordAuditInTx(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    actorRole: null,
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: task.assetId,
    eventType: "TASK_CANCELLED",
    objectType: "AccessFulfilmentTask",
    objectId: task.id,
    objectVersion: task.revision + 1,
    beneficiaryId: task.beneficiaryId,
    before: { state: "READY" },
    after: { state: "CANCELLED", outcome: input.outcome },
    reason: input.reason,
    outcome: "SUCCESS",
    correlationId: null,
  });
  return true;
}
