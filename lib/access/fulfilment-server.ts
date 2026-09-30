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
import type { AccessRequest, AccessRequestState, AccessRequestVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { isAvailable } from "./roles";
import {
  ASSIGNMENT_CHANGED_REASON,
  ownerRoleFor,
  taskActionForKind,
  type OwnerRole,
  type TaskOutcome,
  type TaskState,
} from "./fulfilment";

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

// ── Revérification (FP:245, D-9, D-12) ───────────────────────────────────

export interface RevalidationTarget {
  orgId: string;
  state: TaskState;
  action: "GRANT" | "CHANGE_LEVEL" | "RENEW" | "REVOKE" | "EXPIRY_REMOVAL";
  assetId: string;
  beneficiaryId: string;
  toLevelId: string | null;
  periodEnd: Date | null;
  expectedAssignmentVersion: number;
  asset: { archivedAt: Date | null; catalogueVersion: number };
  requestVersion: { state: AccessRequestState; kind: string; catalogueVersion: number } | null;
}

const EXPECTED_VERSION_STATE: Record<"READY" | "CLAIMED" | "BLOCKED", AccessRequestState> = {
  READY: "READY_FOR_FULFILMENT",
  CLAIMED: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
};

/**
 * Motif actionnable (français) si la tâche ne peut plus être exécutée telle
 * qu'approuvée, sinon null. Utilisée au claim, à la confirmation, pour
 * autoriser la réconciliation et pour l'affichage (`staleReason`).
 * Octroi/montée/renouvellement : bénéficiaire ACTIVE, actif non archivé,
 * période non échue. Réduction/retrait : aucun de ces trois contrôles
 * (FP:110, FP:124 — le nettoyage n'est jamais empêché).
 */
export async function revalidateTask(client: DbClient, task: RevalidationTarget, now: Date): Promise<string | null> {
  if (task.state === "COMPLETED" || task.state === "CANCELLED") return null;
  const version = task.requestVersion;
  if (version && version.state !== EXPECTED_VERSION_STATE[task.state]) {
    return "La demande a changé depuis l'approbation";
  }
  const grantFamily =
    task.action === "GRANT" || task.action === "RENEW" || (task.action === "CHANGE_LEVEL" && version?.kind === "UPGRADE");
  if (grantFamily) {
    const profile = await client.accessProfile.findUnique({
      where: { userId: task.beneficiaryId },
      select: { lifecycle: true },
    });
    if (profile?.lifecycle !== "ACTIVE") return "L'employé n'est plus actif";
    if (task.asset.archivedAt !== null) return "L'application a été archivée";
    if (task.periodEnd !== null && task.periodEnd.getTime() <= now.getTime()) {
      return "La période est terminée — la demande doit être révisée";
    }
  }
  if (version && task.asset.catalogueVersion !== version.catalogueVersion) {
    return "Le catalogue de l'application a changé depuis l'approbation";
  }
  if (task.toLevelId) {
    const level = await client.accessLevel.findFirst({
      where: { id: task.toLevelId, assetId: task.assetId },
      select: { archivedAt: true, enabled: true },
    });
    if (!level || level.archivedAt !== null || !level.enabled) return "Le niveau cible a été archivé";
  }
  const assignment = await client.accessAssignment.findFirst({
    where: { orgId: task.orgId, userId: task.beneficiaryId, assetId: task.assetId },
    select: { id: true, version: true },
  });
  if ((assignment?.version ?? 0) !== task.expectedAssignmentVersion) return ASSIGNMENT_CHANGED_REASON;
  if (assignment && (task.action === "GRANT" || task.action === "RENEW")) {
    const claimedExpiry = await client.accessFulfilmentTask.findFirst({
      where: { sourceAssignmentId: assignment.id, action: "EXPIRY_REMOVAL", state: { in: ["CLAIMED", "BLOCKED"] } },
      select: { id: true },
    });
    if (claimedExpiry) return "Un retrait est en cours — à réconcilier";
  }
  return null;
}

// ── Contexte d'action d'un propriétaire ─────────────────────────────────

const NOT_FOUND_MESSAGE = "Tâche introuvable";
const STALE_MESSAGE = "La tâche a changé, rechargez";

const TASK_INCLUDE = {
  asset: { select: { id: true, ownerId: true, backupOwnerId: true, archivedAt: true, catalogueVersion: true } },
  requestVersion: { include: { request: true } },
} satisfies Prisma.AccessFulfilmentTaskInclude;

type LoadedTask = Prisma.AccessFulfilmentTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

interface ActorContext {
  actingAs: OwnerRole;
  /** Propriétaire principal couvert quand le suppléant agit (FP:86). */
  primaryCoveredId: string | null;
}

/**
 * Charge la tâche et vérifie le périmètre de l'acteur EN DIRECT (D-5) :
 * propriétaire ou suppléant courant de l'actif, et disponible. Tâche
 * inexistante, d'une autre organisation ou hors périmètre → même 404.
 */
async function loadTaskForActor(
  tx: Prisma.TransactionClient,
  orgId: string,
  actorId: string,
  taskId: string
): Promise<{ task: LoadedTask; actor: ActorContext }> {
  const task = await tx.accessFulfilmentTask.findFirst({ where: { id: taskId, orgId }, include: TASK_INCLUDE });
  if (!task) throw new FulfilmentError("NOT_FOUND", NOT_FOUND_MESSAGE);
  const role = ownerRoleFor(task.asset, actorId);
  if (!role || !(await isUserAvailable(tx, orgId, actorId))) {
    throw new FulfilmentError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return {
    task,
    actor: { actingAs: role, primaryCoveredId: role === "ASSET_OWNER_BACKUP" ? task.asset.ownerId : null },
  };
}

async function runTaskTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn);
  } catch (err) {
    if (err instanceof FulfilmentError) throw err;
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : null;
    // P2002 : création concurrente de l'affectation (unique userId+assetId) ;
    // P2034 : conflit d'écriture/interblocage détecté par Postgres.
    if (code === "P2002" || code === "P2034") throw new FulfilmentError("STALE", STALE_MESSAGE);
    throw err;
  }
}

async function moveVersionInTx(
  tx: Prisma.TransactionClient,
  versionId: string | null,
  from: AccessRequestState[],
  data: Prisma.AccessRequestVersionUpdateManyMutationInput
): Promise<void> {
  if (!versionId) return;
  const { count } = await tx.accessRequestVersion.updateMany({
    where: { id: versionId, state: { in: from } },
    data: { ...data, revision: { increment: 1 } },
  });
  if (count === 0) throw new FulfilmentError("STALE", "La demande a changé, rechargez");
}

interface TaskAuditInput {
  orgId: string;
  actorId: string;
  actor: ActorContext;
  task: { id: string; assetId: string; beneficiaryId: string };
  eventType: string;
  objectVersion: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  correlationId: string | null;
}

async function auditTaskInTx(tx: Prisma.TransactionClient, input: TaskAuditInput): Promise<void> {
  await recordAuditInTx(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    // Pas de valeur d'énumération « propriétaire d'actif » (D-18) : le rôle
    // représenté va dans `after.actingAs`.
    actorRole: null,
    primaryCoveredId: input.actor.primaryCoveredId,
    scopeType: "ASSET",
    scopeId: input.task.assetId,
    eventType: input.eventType,
    objectType: "AccessFulfilmentTask",
    objectId: input.task.id,
    objectVersion: input.objectVersion,
    beneficiaryId: input.task.beneficiaryId,
    before: input.before,
    after: { ...input.after, actingAs: input.actor.actingAs },
    reason: input.reason,
    outcome: "SUCCESS",
    correlationId: input.correlationId,
  });
}

export interface TaskMutationOptions {
  /** Lot (D-13) : même identifiant pour tous les éléments d'un appel. */
  correlationId?: string | null;
  /** Horloge injectable (tests). */
  now?: Date;
}

export interface TaskStateDTO {
  taskId: string;
  state: TaskState;
  revision: number;
}

function assertRevision(task: { revision: number }, expectedRevision: number): void {
  if (task.revision !== expectedRevision) throw new FulfilmentError("STALE", STALE_MESSAGE);
}

// ── Réclamer / passer la main ────────────────────────────────────────────

export async function claimTask(
  orgId: string,
  actorId: string,
  taskId: string,
  expectedRevision: number,
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  const now = opts.now ?? new Date();
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "READY") throw new FulfilmentError("INVALID_TRANSITION", "Cette tâche n'est plus à réclamer");
    assertRevision(task, expectedRevision);
    const stale = await revalidateTask(tx, task, now);
    if (stale) throw new FulfilmentError("STALE", stale);

    await moveVersionInTx(tx, task.requestVersionId, ["READY_FOR_FULFILMENT"], { state: "IN_PROGRESS" });
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: "READY", revision: expectedRevision },
      data: { state: "CLAIMED", claimantId: actorId, claimedAt: now, revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: { orgId, taskId: task.id, type: "CLAIMED", actorId, actingAs: actor.actingAs },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_CLAIMED",
      objectVersion: expectedRevision + 1,
      before: { state: "READY" },
      after: { state: "CLAIMED", selfFulfilled: actorId === task.beneficiaryId },
      reason: null,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: "CLAIMED", revision: expectedRevision + 1 };
  });
}

/**
 * Passation (D-8) vers l'AUTRE propriétaire/suppléant disponible de l'actif,
 * motif obligatoire. Faite par le détenteur OU par tout propriétaire/suppléant
 * courant (le détenteur a pu perdre son périmètre : FP:241, FP:112).
 */
export async function handoverTask(
  orgId: string,
  actorId: string,
  taskId: string,
  input: { toUserId: string; reason: string; expectedRevision: number },
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "CLAIMED" && task.state !== "BLOCKED") {
      throw new FulfilmentError("INVALID_TRANSITION", "Seule une tâche réclamée ou bloquée peut être passée");
    }
    assertRevision(task, input.expectedRevision);
    const candidates = [task.asset.ownerId, task.asset.backupOwnerId].filter(
      (id): id is string => id !== null && id !== task.claimantId
    );
    if (!candidates.includes(input.toUserId) || !(await isUserAvailable(tx, orgId, input.toUserId))) {
      throw new FulfilmentError(
        "VALIDATION",
        "Le destinataire doit être l'autre propriétaire ou suppléant disponible de l'application"
      );
    }
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: task.state, revision: input.expectedRevision },
      data: { claimantId: input.toUserId, revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: {
        orgId,
        taskId: task.id,
        type: "HANDED_OVER",
        actorId,
        actingAs: actor.actingAs,
        toUserId: input.toUserId,
        reason: input.reason,
      },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_HANDED_OVER",
      objectVersion: input.expectedRevision + 1,
      before: { claimantId: task.claimantId },
      after: { claimantId: input.toUserId },
      reason: input.reason,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: task.state, revision: input.expectedRevision + 1 };
  });
}
