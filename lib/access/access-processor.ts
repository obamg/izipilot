// lib/access/access-processor.ts
// Processeur 5 minutes de la gestion des accès (phase 3b, D-11, FP:229).
// Cinq devoirs idempotents, par organisation active, bornés à
// PROCESSOR_BATCH_SIZE lignes par devoir et par passage ; une transaction
// par ligne (un échec n'arrête pas le reste). Aucun appel externe, aucune
// notification (A25). Chevauchement de passages : les clés uniques
// (idempotencyKey, index partiels) et les `updateMany` conditionnels
// suffisent, pas de verrou consultatif.
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { recordAuditInTx } from "./audit-server";
import { EXPIRED_BEFORE_FULFILMENT_REASON, GRANT_FAMILY_TASK_WHERE } from "./fulfilment";
import { SYSTEM_ACTOR, releaseTaskInTx } from "./fulfilment-server";

const SUPERSEDED_ORPHAN_REASON = "Retrait déjà effectué ou affectation modifiée";

const logger = log.child("access-processor");

export const PROCESSOR_BATCH_SIZE = 200;

export interface ProcessorReport {
  /** 1. AUTHORIZED_WAITING_START arrivées à `periodStart` → READY + tâche. */
  released: number;
  /** 2. READY_FOR_FULFILMENT sans tâche → tâche (auto-réparation, rattrapage). */
  repaired: number;
  /** 3. Affectations temporaires échues → EXPIRED_REMOVAL_PENDING + tâche de retrait. */
  expired: number;
  /** 4. Tâches READY dont la période est échue → version REVISION_REQUIRED. */
  revisionRequired: number;
  /** 5. Tâches d'expiration READY orphelines (affectation retirée/modifiée) → annulées. */
  sweptExpiry: number;
  errors: number;
}

async function eachRow<T>(
  rows: T[],
  report: ProcessorReport,
  duty: string,
  fn: (row: T) => Promise<boolean>
): Promise<number> {
  let done = 0;
  for (const row of rows) {
    try {
      if (await fn(row)) done++;
    } catch (err) {
      report.errors++;
      logger.error("row failed", { duty }, err);
    }
  }
  return done;
}

async function releaseWaitingVersions(orgId: string, now: Date, report: ProcessorReport): Promise<void> {
  const versions = await prisma.accessRequestVersion.findMany({
    where: { state: "AUTHORIZED_WAITING_START", periodStart: { lte: now }, request: { orgId, closedAt: null } },
    include: { request: true },
    orderBy: { periodStart: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.released += await eachRow(versions, report, "release", (v) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.accessRequestVersion.updateMany({
        where: { id: v.id, state: "AUTHORIZED_WAITING_START" },
        data: { state: "READY_FOR_FULFILMENT", revision: { increment: 1 } },
      });
      if (count === 0) return false;
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ACCESS_REQUEST",
        scopeId: v.requestId,
        eventType: "REQUEST_RELEASED",
        objectType: "AccessRequestVersion",
        objectId: v.id,
        objectVersion: v.versionNumber,
        beneficiaryId: v.request.beneficiaryId,
        before: { state: "AUTHORIZED_WAITING_START" },
        after: { state: "READY_FOR_FULFILMENT" },
        reason: null,
        outcome: "SUCCESS",
        correlationId: null,
      });
      await releaseTaskInTx(tx, { orgId, actorId: SYSTEM_ACTOR, version: v, request: v.request });
      return true;
    })
  );
}

async function repairMissingTasks(orgId: string, report: ProcessorReport): Promise<void> {
  const versions = await prisma.accessRequestVersion.findMany({
    where: { state: "READY_FOR_FULFILMENT", fulfilmentTasks: { none: {} }, request: { orgId } },
    include: { request: true },
    orderBy: { updatedAt: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.repaired += await eachRow(versions, report, "repair", (v) =>
    prisma.$transaction(async (tx) => {
      // Les candidats ont été lus hors transaction : verrou sans effet gardé sur l'état
      // (sérialise avec `cancelRequest`, qui verrouille la version en premier ; pas
      // d'incrément de `revision`). Si la version n'est plus READY, on ne crée rien.
      const lock = await tx.accessRequestVersion.updateMany({
        where: { id: v.id, state: "READY_FOR_FULFILMENT" },
        data: { state: "READY_FOR_FULFILMENT" },
      });
      if (lock.count === 0) return false;
      const { created } = await releaseTaskInTx(tx, { orgId, actorId: SYSTEM_ACTOR, version: v, request: v.request });
      return created;
    })
  );
}

/**
 * FP:229 : à l'échéance, EXPIRED_REMOVAL_PENDING + UNE tâche de retrait par
 * version d'affectation (clé `EXP:<assignmentId>:<version>`). Le niveau
 * courant est conservé jusqu'à confirmation du retrait, et `version` n'est
 * PAS incrémentée (le niveau ne change pas) : un renouvellement approuvé sur
 * cette même version peut ensuite supplanter l'expiration (FP:231, D-23).
 */
async function expireTemporaryAssignments(orgId: string, now: Date, report: ProcessorReport): Promise<void> {
  const assignments = await prisma.accessAssignment.findMany({
    where: { orgId, status: "ACTIVE", periodEnd: { lte: now } },
    orderBy: { periodEnd: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.expired += await eachRow(assignments, report, "expire", (a) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.accessAssignment.updateMany({
        where: { id: a.id, status: "ACTIVE", version: a.version },
        data: { status: "EXPIRED_REMOVAL_PENDING" },
      });
      if (count === 0) return false;
      const idempotencyKey = `EXP:${a.id}:${a.version}`;
      const inserted = await tx.accessFulfilmentTask.createMany({
        data: [
          {
            orgId,
            assetId: a.assetId,
            beneficiaryId: a.userId,
            action: "EXPIRY_REMOVAL",
            sourceAssignmentId: a.id,
            sourceAssignmentVersion: a.version,
            fromLevelId: a.levelId,
            toLevelId: null,
            periodStart: a.periodStart,
            periodEnd: a.periodEnd,
            expectedAssignmentVersion: a.version,
            idempotencyKey,
          },
        ],
        skipDuplicates: true,
      });
      const task = await tx.accessFulfilmentTask.findUniqueOrThrow({ where: { idempotencyKey }, select: { id: true } });
      await tx.accessAssignmentEvent.create({
        data: {
          orgId,
          assignmentId: a.id,
          userId: a.userId,
          assetId: a.assetId,
          beforeLevelId: a.levelId,
          afterLevelId: a.levelId,
          actorId: null,
          actorRole: null,
          sourceType: "EXPIRY",
          sourceId: task.id,
          outcome: "EXPIRED_REMOVAL_PENDING",
        },
      });
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ASSET",
        scopeId: a.assetId,
        eventType: "ASSIGNMENT_EXPIRED",
        objectType: "AccessAssignment",
        objectId: a.id,
        objectVersion: a.version,
        beneficiaryId: a.userId,
        before: { status: "ACTIVE" },
        after: { status: "EXPIRED_REMOVAL_PENDING", taskId: task.id },
        reason: null,
        outcome: "SUCCESS",
        correlationId: null,
      });
      if (inserted.count === 1) {
        await tx.accessTaskEvent.create({
          data: { orgId, taskId: task.id, type: "RELEASED", actorId: null, actingAs: "SYSTEM" },
        });
        await recordAuditInTx(tx, {
          orgId,
          actorId: SYSTEM_ACTOR,
          actorRole: null,
          primaryCoveredId: null,
          scopeType: "ASSET",
          scopeId: a.assetId,
          eventType: "TASK_RELEASED",
          objectType: "AccessFulfilmentTask",
          objectId: task.id,
          objectVersion: 1,
          beneficiaryId: a.userId,
          before: null,
          after: { action: "EXPIRY_REMOVAL", state: "READY", idempotencyKey },
          reason: null,
          outcome: "SUCCESS",
          correlationId: null,
        });
      }
      return true;
    })
  );
}

/**
 * FP:231 : une demande dont la fin temporaire est passée doit être révisée
 * avant exécution. Seulement les tâches NON réclamées ; une tâche réclamée
 * est refusée à la confirmation (revérification) et se réconcilie.
 */
async function sendOverdueReadyTasksToRevision(orgId: string, now: Date, report: ProcessorReport): Promise<void> {
  const tasks = await prisma.accessFulfilmentTask.findMany({
    where: {
      orgId,
      state: "READY",
      requestVersionId: { not: null },
      // Même règle que `revalidateTask` : une réduction n'est jamais bloquée par une période échue.
      ...GRANT_FAMILY_TASK_WHERE,
      periodEnd: { lte: now },
    },
    orderBy: { periodEnd: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.revisionRequired += await eachRow(tasks, report, "revision", (t) =>
    prisma.$transaction(async (tx) => {
      // Même ordre de verrouillage que claimTask : version, puis tâche.
      const version = await tx.accessRequestVersion.updateMany({
        where: { id: t.requestVersionId as string, state: "READY_FOR_FULFILMENT" },
        data: { state: "REVISION_REQUIRED", revision: { increment: 1 } },
      });
      if (version.count === 0) return false;
      const task = await tx.accessFulfilmentTask.updateMany({
        where: { id: t.id, state: "READY" },
        data: { state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT", revision: { increment: 1 } },
      });
      if (task.count === 0) throw new Error("Tâche modifiée pendant le renvoi en révision");
      await tx.accessTaskEvent.create({
        data: {
          orgId,
          taskId: t.id,
          type: "CANCELLED",
          actorId: null,
          actingAs: "SYSTEM",
          reason: EXPIRED_BEFORE_FULFILMENT_REASON,
        },
      });
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ASSET",
        scopeId: t.assetId,
        eventType: "TASK_CANCELLED",
        objectType: "AccessFulfilmentTask",
        objectId: t.id,
        objectVersion: t.revision + 1,
        beneficiaryId: t.beneficiaryId,
        before: { state: "READY" },
        after: { state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT", versionState: "REVISION_REQUIRED" },
        reason: EXPIRED_BEFORE_FULFILMENT_REASON,
        outcome: "SUCCESS",
        correlationId: null,
      });
      return true;
    })
  );
}

/**
 * Balayage idempotent : une tâche d'expiration READY dont l'affectation n'est
 * plus en attente de retrait, ou a changé de version, n'a plus d'objet (un
 * retrait ou un renouvellement est passé par un autre chemin). Annulée, jamais
 * exécutée. Une tâche réclamée n'est pas touchée (elle se réconcilie).
 */
async function sweepOrphanExpiryTasks(orgId: string, report: ProcessorReport): Promise<void> {
  const tasks = await prisma.accessFulfilmentTask.findMany({
    where: { orgId, state: "READY", action: "EXPIRY_REMOVAL", sourceAssignmentId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  if (tasks.length === 0) return;
  const assignments = await prisma.accessAssignment.findMany({
    where: { id: { in: tasks.map((t) => t.sourceAssignmentId as string) } },
    select: { id: true, status: true, version: true },
  });
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const orphans = tasks.filter((t) => {
    const a = byId.get(t.sourceAssignmentId as string);
    return !a || a.status !== "EXPIRED_REMOVAL_PENDING" || a.version !== t.sourceAssignmentVersion;
  });
  report.sweptExpiry += await eachRow(orphans, report, "sweep-expiry", (t) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.accessFulfilmentTask.updateMany({
        where: { id: t.id, state: "READY" },
        data: { state: "CANCELLED", outcome: "SUPERSEDED", revision: { increment: 1 } },
      });
      if (count === 0) return false;
      await tx.accessTaskEvent.create({
        data: { orgId, taskId: t.id, type: "CANCELLED", actorId: null, actingAs: "SYSTEM", reason: SUPERSEDED_ORPHAN_REASON },
      });
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ASSET",
        scopeId: t.assetId,
        eventType: "TASK_CANCELLED",
        objectType: "AccessFulfilmentTask",
        objectId: t.id,
        objectVersion: t.revision + 1,
        beneficiaryId: t.beneficiaryId,
        before: { state: "READY" },
        after: { state: "CANCELLED", outcome: "SUPERSEDED" },
        reason: SUPERSEDED_ORPHAN_REASON,
        outcome: "SUCCESS",
        correlationId: null,
      });
      return true;
    })
  );
}

/**
 * `options.orgIds` restreint le passage à certaines organisations (tests :
 * les fichiers de test tournent en parallèle sur la même base). La route
 * cron l'appelle sans option.
 */
export async function runAccessProcessor(
  now: Date = new Date(),
  options: { orgIds?: string[] } = {}
): Promise<ProcessorReport> {
  const orgs = await prisma.organization.findMany({
    where: { isActive: true, ...(options.orgIds ? { id: { in: options.orgIds } } : {}) },
    select: { id: true },
  });
  const report: ProcessorReport = { released: 0, repaired: 0, expired: 0, revisionRequired: 0, sweptExpiry: 0, errors: 0 };
  for (const org of orgs) {
    await releaseWaitingVersions(org.id, now, report);
    await repairMissingTasks(org.id, report);
    await expireTemporaryAssignments(org.id, now, report);
    await sendOverdueReadyTasksToRevision(org.id, now, report);
    await sweepOrphanExpiryTasks(org.id, report);
  }
  return report;
}
