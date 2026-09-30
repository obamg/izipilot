// tests/unit/access-db/fulfilment-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { cancelRequest, submitRequest } from "@/lib/access/requests-server";
import {
  FulfilmentError,
  blockTask,
  cancelReadyTaskForVersionInTx,
  claimTask,
  claimTasksBatch,
  completeTask,
  completeTasksBatch,
  getFulfilmentAssetIds,
  handoverTask,
  reconcileTask,
  releaseTaskInTx,
  resumeTask,
} from "@/lib/access/fulfilment-server";
import {
  approvedReduction,
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  currentAssignment,
  giveAccess,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(FulfilmentError);
  await expect(p).rejects.toMatchObject({ code });
}

async function readyVersionRow(
  fx: FulfilmentFixture,
  beneficiaryId: string,
  targetLevelId: string | null,
  kind: "GRANT" | "UPGRADE" | "REVOKE",
  assignmentVersion: number
) {
  const request = await prisma.accessRequest.create({ data: { orgId: fx.orgId, beneficiaryId, assetId: fx.assetId } });
  const version = await prisma.accessRequestVersion.create({
    data: {
      requestId: request.id,
      versionNumber: 1,
      kind,
      initiatorId: beneficiaryId,
      targetLevelId,
      justification: "fondations",
      periodStart: new Date(),
      departmentSnapshot: fx.departmentId,
      assignmentVersion,
      catalogueVersion: 1,
      state: "READY_FOR_FULFILMENT",
    },
  });
  return { request, version };
}

describe("fulfilment-server — fondations (périmètre, libération, annulation READY)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("fondations");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("getFulfilmentAssetIds : propriétaire et suppléant, actifs archivés COMPRIS ; tiers → aucun", async () => {
    const archived = await prisma.accessAsset.create({
      data: { orgId: fx.orgId, name: "Archivé", ownerId: fx.users.owner, archivedAt: new Date() },
    });
    expect((await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.owner)).sort()).toEqual([fx.assetId, archived.id].sort());
    expect(await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.backup)).toEqual([fx.assetId]);
    expect(await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.stranger)).toEqual([]);
    await prisma.accessAsset.delete({ where: { id: archived.id } });
  });

  it("getFulfilmentAssetIds : un propriétaire parti (indisponible) n'a plus aucun actif d'exécution", async () => {
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "DEPARTED" } });
    expect(await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.backup)).toEqual([]);
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "ACTIVE" } });
  });

  it("releaseTaskInTx : crée UNE tâche READY (clé REQ:<versionId>), idempotent au rejeu, avec événement et audit", async () => {
    const assignment = await giveAccess(fx, fx.users.employee, fx.levels.reader);
    const { request, version } = await readyVersionRow(fx, fx.users.employee, fx.levels.editor, "UPGRADE", assignment.version);

    const first = await prisma.$transaction((tx) =>
      releaseTaskInTx(tx, { orgId: fx.orgId, actorId: fx.users.ciso, version, request })
    );
    const second = await prisma.$transaction((tx) =>
      releaseTaskInTx(tx, { orgId: fx.orgId, actorId: fx.users.ciso, version, request })
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ taskId: first.taskId, created: false });

    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: first.taskId } });
    expect(task).toMatchObject({
      state: "READY",
      action: "CHANGE_LEVEL",
      idempotencyKey: `REQ:${version.id}`,
      fromLevelId: fx.levels.reader,
      toLevelId: fx.levels.editor,
      expectedAssignmentVersion: assignment.version,
      beneficiaryId: fx.users.employee,
      assetId: fx.assetId,
    });
    expect(await prisma.accessTaskEvent.count({ where: { taskId: task.id, type: "RELEASED" } })).toBe(1);
    expect(
      await prisma.accessAuditEvent.count({ where: { orgId: fx.orgId, eventType: "TASK_RELEASED", objectId: task.id } })
    ).toBe(1);

    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });

  it("cancelReadyTaskForVersionInTx : READY → CANCELLED une seule fois ; false sans tâche READY", async () => {
    const { request, version } = await readyVersionRow(fx, fx.users.stranger, fx.levels.reader, "GRANT", 0);
    const { taskId } = await prisma.$transaction((tx) =>
      releaseTaskInTx(tx, { orgId: fx.orgId, actorId: fx.users.ciso, version, request })
    );
    const input = { orgId: fx.orgId, actorId: fx.users.stranger, versionId: version.id, reason: "annulée", outcome: "NOT_PERFORMED" as const };
    expect(await prisma.$transaction((tx) => cancelReadyTaskForVersionInTx(tx, input))).toBe(true);
    expect(await prisma.$transaction((tx) => cancelReadyTaskForVersionInTx(tx, input))).toBe(false);
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("CANCELLED");
    expect(task.outcome).toBe("NOT_PERFORMED");
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });
});

describe("fulfilment-server — réclamer et passer la main", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("claim");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function readyTask(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return { emp, final, task: await taskForVersion(final.id) };
  }

  it("le propriétaire réclame : tâche CLAIMED, version IN_PROGRESS, événement et audit (rôle représenté)", async () => {
    const { final, task } = await readyTask("Claim1");
    const res = await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    expect(res).toEqual({ taskId: task.id, state: "CLAIMED", revision: 2 });
    const after = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after).toMatchObject({ state: "CLAIMED", claimantId: fx.users.owner });
    expect(after.claimedAt).not.toBeNull();
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("IN_PROGRESS");
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_CLAIMED", objectId: task.id } });
    expect(audit).toMatchObject({ actorId: fx.users.owner, actorRole: null, primaryCoveredId: null, scopeType: "ASSET", scopeId: fx.assetId });
    expect(audit.after).toMatchObject({ state: "CLAIMED", actingAs: "ASSET_OWNER", selfFulfilled: false });
  });

  it("le suppléant réclame à tout moment : audit ASSET_OWNER_BACKUP, propriétaire couvert renseigné (FP:83, FP:86)", async () => {
    const { task } = await readyTask("Claim2");
    await claimTask(fx.orgId, fx.users.backup, task.id, 1);
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_CLAIMED", objectId: task.id } });
    expect(audit.primaryCoveredId).toBe(fx.users.owner);
    expect(audit.after).toMatchObject({ actingAs: "ASSET_OWNER_BACKUP" });
  });

  it("un tiers → NOT_FOUND ; révision périmée → STALE ; déjà réclamée → INVALID_TRANSITION", async () => {
    const { task } = await readyTask("Claim3");
    await expectCode(claimTask(fx.orgId, fx.users.stranger, task.id, 1), "NOT_FOUND");
    await expectCode(claimTask(fx.orgId, fx.users.owner, "tache-inexistante", 1), "NOT_FOUND");
    await expectCode(claimTask(fx.orgId, fx.users.owner, task.id, 7), "STALE");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await expectCode(claimTask(fx.orgId, fx.users.backup, task.id, 2), "INVALID_TRANSITION");
  });

  it("réclamation concurrente propriétaire/suppléant : un seul gagnant", async () => {
    const { task } = await readyTask("Race");
    const results = await Promise.allSettled([
      claimTask(fx.orgId, fx.users.owner, task.id, 1),
      claimTask(fx.orgId, fx.users.backup, task.id, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(FulfilmentError);
    expect(["STALE", "INVALID_TRANSITION"]).toContain((loser.reason as FulfilmentError).code);
    expect(await prisma.accessTaskEvent.count({ where: { taskId: task.id, type: "CLAIMED" } })).toBe(1);
  });

  it("Review Focus #4 — annulation par le demandeur et réclamation simultanées : un seul effet, états cohérents", async () => {
    const { emp, final, task } = await readyTask("CancelRace");
    const [cancel, claim] = await Promise.allSettled([
      cancelRequest(fx.orgId, emp, final.requestId),
      claimTask(fx.orgId, fx.users.owner, task.id, 1),
    ]);
    const version = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } });
    const after = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } });
    if (claim.status === "fulfilled") {
      // La réclamation a gagné : l'annulation n'a pu que devenir une demande d'annulation, ou échouer.
      expect(after.state).toBe("CLAIMED");
      expect(version.state).toBe("IN_PROGRESS");
      expect(cancel.status === "rejected" || cancel.value === "CANCEL_REQUESTED").toBe(true);
    } else {
      expect(cancel).toEqual({ status: "fulfilled", value: "CANCELLED" });
      expect(after.state).toBe("CANCELLED");
      expect(version.state).toBe("CANCELLED");
    }
  });

  it("actif sans propriétaire : personne ne peut réclamer (FP:312)", async () => {
    const orphan = await prisma.accessAsset.create({ data: { orgId: fx.orgId, name: "Orpheline", requestsEnabled: true } });
    const level = await prisma.accessLevel.create({ data: { assetId: orphan.id, name: "Base", priority: 1, isAdmin: false } });
    const v = await submitRequest(fx.orgId, fx.users.coo, {
      beneficiaryId: fx.users.coo, assetId: orphan.id, targetLevelId: level.id, justification: "COO",
    });
    const task = await taskForVersion(v.id);
    for (const actor of [fx.users.coo, fx.users.ciso, fx.users.owner]) {
      await expectCode(claimTask(fx.orgId, actor, task.id, 1), "NOT_FOUND");
    }
  });

  it("passation au suppléant avec motif ; vers soi-même ou un tiers → VALIDATION ; tâche non réclamée → INVALID_TRANSITION", async () => {
    const { task } = await readyTask("Handover");
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 1 }), "INVALID_TRANSITION");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.owner, reason: "moi", expectedRevision: 2 }), "VALIDATION");
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.stranger, reason: "tiers", expectedRevision: 2 }), "VALIDATION");
    const res = await handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 2 });
    expect(res).toEqual({ taskId: task.id, state: "CLAIMED", revision: 3 });
    const after = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.claimantId).toBe(fx.users.backup);
    const event = await prisma.accessTaskEvent.findFirstOrThrow({ where: { taskId: task.id, type: "HANDED_OVER" } });
    expect(event).toMatchObject({ actorId: fx.users.owner, toUserId: fx.users.backup, reason: "congés" });
  });

  it("passation vers un suppléant indisponible → VALIDATION", async () => {
    const { task } = await readyTask("HandoverGone");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "OFFBOARDING" } });
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "départ", expectedRevision: 2 }), "VALIDATION");
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "ACTIVE" } });
  });

  it("Review Focus #1 — propriétaire remplacé après réclamation : l'ancien détenteur ne peut plus agir, le nouveau reprend par passation", async () => {
    const { task } = await readyTask("Replaced");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    const newOwner = await newEmployee(fx, "NewOwner");
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { ownerId: newOwner } });
    try {
      await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "x", expectedRevision: 2 }), "NOT_FOUND");
      const res = await handoverTask(fx.orgId, newOwner, task.id, { toUserId: newOwner, reason: "reprise après changement de propriétaire", expectedRevision: 2 });
      expect(res.revision).toBe(3);
      expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } })).claimantId).toBe(newOwner);
    } finally {
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { ownerId: fx.users.owner } });
    }
  });
});

describe("fulfilment-server — bloquer, reprendre, réconcilier", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("block");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function claimedTask(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    return { emp, final, taskId: task.id };
  }

  it("blocage par le détenteur : tâche et version BLOCKED, motif et faits enregistrés, affectation intacte", async () => {
    const { emp, final, taskId } = await claimedTask("Block1");
    await expectCode(blockTask(fx.orgId, fx.users.backup, taskId, { reason: "pas moi", facts: null, expectedRevision: 2 }), "INVALID_TRANSITION");
    const res = await blockTask(fx.orgId, fx.users.owner, taskId, {
      reason: "Compte fournisseur verrouillé",
      facts: "tentative à 10h, erreur 403",
      expectedRevision: 2,
    });
    expect(res).toEqual({ taskId, state: "BLOCKED", revision: 3 });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.blockedReason).toBe("Compte fournisseur verrouillé");
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("BLOCKED");
    const event = await prisma.accessTaskEvent.findFirstOrThrow({ where: { taskId, type: "BLOCKED" } });
    expect(event.facts).toEqual({ note: "tentative à 10h, erreur 403" });
    expect(await prisma.accessAssignment.count({ where: { orgId: fx.orgId, userId: emp } })).toBe(0);
  });

  it("reprise par le suppléant : il devient détenteur, version IN_PROGRESS, motif effacé", async () => {
    const { final, taskId } = await claimedTask("Resume1");
    await blockTask(fx.orgId, fx.users.owner, taskId, { reason: "attente fournisseur", facts: null, expectedRevision: 2 });
    await expectCode(resumeTask(fx.orgId, fx.users.backup, taskId, 2), "STALE");
    const res = await resumeTask(fx.orgId, fx.users.backup, taskId, 3);
    expect(res).toEqual({ taskId, state: "CLAIMED", revision: 4 });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ claimantId: fx.users.backup, blockedReason: null });
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("IN_PROGRESS");
    await expectCode(resumeTask(fx.orgId, fx.users.backup, taskId, 4), "INVALID_TRANSITION");
  });

  it("réconciliation refusée sans demande d'annulation ni revérification en échec", async () => {
    const { taskId } = await claimedTask("Recon0");
    await expectCode(reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "rien fait", expectedRevision: 2 }), "INVALID_TRANSITION");
  });

  it("D-19 : annulation demandée après réclamation → le détenteur réconcilie « aucune modification » → CANCELLED, demande fermée", async () => {
    const { emp, final, taskId } = await claimedTask("Recon1");
    expect(await cancelRequest(fx.orgId, emp, final.requestId)).toBe("CANCEL_REQUESTED");
    await expectCode(reconcileTask(fx.orgId, fx.users.backup, taskId, { reason: "pas détenteur", expectedRevision: 2 }), "INVALID_TRANSITION");
    const res = await reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "Aucune modification effectuée", expectedRevision: 2 });
    expect(res).toEqual({ taskId, state: "CANCELLED", revision: 3 });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.outcome).toBe("NOT_PERFORMED");
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("CANCELLED");
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).not.toBeNull();
    expect(await prisma.accessTaskEvent.count({ where: { taskId, type: "RECONCILED" } })).toBe(1);
  });

  it("réconciliation autorisée quand la tâche est périmée (niveau cible archivé), y compris depuis BLOCKED", async () => {
    const { taskId } = await claimedTask("Recon2");
    await blockTask(fx.orgId, fx.users.owner, taskId, { reason: "niveau supprimé chez l'éditeur", facts: null, expectedRevision: 2 });
    await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: new Date() } });
    try {
      const res = await reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "Aucune modification effectuée", expectedRevision: 3 });
      expect(res.state).toBe("CANCELLED");
    } finally {
      await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: null } });
    }
  });
});

describe("fulfilment-server — confirmer (D-9, D-10, D-23, A16–A18)", () => {
  let fx: FulfilmentFixture;
  const DAY = 86_400_000;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("complete");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  function facts(over: Partial<{ reference: string | null; note: string | null; method: "DIRECT" | "REMOVE_THEN_GRANT"; completedAt: Date; partialRemovalOnly: boolean }> = {}) {
    return { completedAt: new Date(), reference: "TICKET-1", note: null, ...over };
  }

  async function claimed(finalId: string, actor = fx.users.owner) {
    const task = await taskForVersion(finalId);
    await claimTask(fx.orgId, actor, task.id, 1);
    return task.id;
  }

  it("GRANT : affectation créée ACTIVE (source REQUEST, OWNER_CONFIRMED), événement, version COMPLETED, demande fermée", async () => {
    const emp = await newEmployee(fx, "Grant");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    const completedAt = new Date(Date.now() - 60_000);
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ completedAt }), expectedRevision: 2 });
    expect(res).toEqual({ taskId, state: "COMPLETED", revision: 3, outcome: "PROVISIONED", assignmentVersion: 1, replayed: false });

    const a = await currentAssignment(fx, emp);
    expect(a).toMatchObject({ status: "ACTIVE", levelId: fx.levels.reader, source: "REQUEST", verification: "OWNER_CONFIRMED", version: 1 });
    expect(a?.grantedAt?.getTime()).toBe(completedAt.getTime());
    const events = await prisma.accessAssignmentEvent.findMany({ where: { assignmentId: a!.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sourceType: "FULFILMENT", sourceId: taskId, beforeLevelId: null, afterLevelId: fx.levels.reader, outcome: "PROVISIONED", actorId: fx.users.owner });
    const version = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } });
    expect(version).toMatchObject({ state: "COMPLETED", outcome: "PROVISIONED" });
    expect(version.completedAt?.getTime()).toBe(completedAt.getTime());
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).not.toBeNull();
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED", objectId: taskId } });
    expect(audit.after).toMatchObject({ outcome: "PROVISIONED", selfFulfilled: false, actingAs: "ASSET_OWNER", reference: "TICKET-1" });
  });

  it("CHANGE_LEVEL (montée, méthode directe) : niveau remplacé, version +1, ancien niveau dans l'historique", async () => {
    const emp = await newEmployee(fx, "Upgrade");
    const before = await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedSelfRequest(fx, emp, fx.levels.editor);
    expect(final.kind).toBe("UPGRADE");
    const taskId = await claimed(final.id);
    await expectCode(completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 }), "VALIDATION");
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ method: "DIRECT" }), expectedRevision: 2 });
    expect(res.outcome).toBe("CHANGED");
    const a = await currentAssignment(fx, emp);
    expect(a).toMatchObject({ levelId: fx.levels.editor, status: "ACTIVE", version: before.version + 1 });
    const event = await prisma.accessAssignmentEvent.findFirstOrThrow({ where: { assignmentId: before.id } });
    expect(event).toMatchObject({ beforeLevelId: fx.levels.reader, afterLevelId: fx.levels.editor });
  });

  it("RENEW : nouvelle fin de période, niveau et date d'octroi inchangés", async () => {
    const emp = await newEmployee(fx, "Renew");
    const before = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() + 10 * DAY) });
    const newEnd = new Date(Date.now() + 90 * DAY);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: newEnd });
    expect(final.kind).toBe("RENEW");
    const taskId = await claimed(final.id);
    await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 });
    const a = await currentAssignment(fx, emp);
    expect(a?.levelId).toBe(fx.levels.reader);
    expect(a?.periodEnd?.getTime()).toBe(newEnd.getTime());
    expect(a?.grantedAt).toEqual(before.grantedAt);
    expect(a?.version).toBe(before.version + 1);
  });

  it("REVOKE : REVOKED, niveau nul, date de retrait ; possible même pour un employé parti (FP:124)", async () => {
    const emp = await newEmployee(fx, "Revoke");
    await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedReduction(fx, emp, null);
    const taskId = await claimed(final.id);
    await prisma.accessProfile.update({ where: { userId: emp }, data: { lifecycle: "DEPARTED" } });
    const completedAt = new Date(Date.now() - 5_000);
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ completedAt }), expectedRevision: 2 });
    expect(res.outcome).toBe("REVOKED");
    const a = await currentAssignment(fx, emp);
    expect(a).toMatchObject({ status: "REVOKED", levelId: null, source: "LEGACY_IMPORT" });
    expect(a?.revokedAt?.getTime()).toBe(completedAt.getTime());
  });

  it("A17 — confirmation rejouée à l'identique : même résultat, aucune nouvelle écriture ; faits différents → refus", async () => {
    const emp = await newEmployee(fx, "Replay");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    const input = { ...facts({ completedAt: new Date(Date.now() - 1_000) }), expectedRevision: 2 };
    const first = await completeTask(fx.orgId, fx.users.owner, taskId, input);
    const second = await completeTask(fx.orgId, fx.users.owner, taskId, input);
    expect(second).toEqual({ ...first, replayed: true });
    const a = await currentAssignment(fx, emp);
    expect(a?.version).toBe(1);
    expect(await prisma.accessAssignmentEvent.count({ where: { assignmentId: a!.id } })).toBe(1);
    expect(await prisma.accessTaskEvent.count({ where: { taskId, type: "COMPLETED" } })).toBe(1);
    await expectCode(completeTask(fx.orgId, fx.users.owner, taskId, { ...input, reference: "AUTRE" }), "INVALID_TRANSITION");
  });

  it("A16 — double confirmation concurrente de la même tâche : un seul niveau courant, une seule écriture", async () => {
    const emp = await newEmployee(fx, "Double");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    const input = { ...facts({ completedAt: new Date(Date.now() - 1_000) }), expectedRevision: 2 };
    const results = await Promise.allSettled([
      completeTask(fx.orgId, fx.users.owner, taskId, input),
      completeTask(fx.orgId, fx.users.owner, taskId, input),
    ]);
    const writes = results.filter((r) => r.status === "fulfilled" && r.value.replayed === false);
    expect(writes).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as FulfilmentError).code).toBe("STALE");
    }
    expect(await prisma.accessAssignment.count({ where: { orgId: fx.orgId, userId: emp } })).toBe(1);
    expect(await prisma.accessAssignmentEvent.count({ where: { orgId: fx.orgId, userId: emp } })).toBe(1);
  });

  it("A16 — retrait demandé et retrait d'expiration confirmés en même temps : un seul gagne (compare-and-swap sur la version)", async () => {
    const emp = await newEmployee(fx, "TwoRemovals");
    const assignment = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - DAY) });
    const final = await approvedReduction(fx, emp, null);
    // Expiration telle que le processeur la posera (Tâche 11) : statut, tâche, version inchangée.
    await prisma.accessAssignment.update({ where: { id: assignment.id }, data: { status: "EXPIRED_REMOVAL_PENDING" } });
    const expiry = await prisma.accessFulfilmentTask.create({
      data: {
        orgId: fx.orgId, assetId: fx.assetId, beneficiaryId: emp, action: "EXPIRY_REMOVAL",
        sourceAssignmentId: assignment.id, sourceAssignmentVersion: assignment.version, fromLevelId: fx.levels.reader,
        expectedAssignmentVersion: assignment.version, idempotencyKey: `EXP:${assignment.id}:${assignment.version}`,
      },
    });
    const revokeTaskId = await claimed(final.id, fx.users.owner);
    await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);
    const results = await Promise.allSettled([
      completeTask(fx.orgId, fx.users.owner, revokeTaskId, { ...facts(), expectedRevision: 2 }),
      completeTask(fx.orgId, fx.users.backup, expiry.id, { ...facts(), expectedRevision: 2 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // Le perdant échoue toujours en STALE : soit la tâche d'expiration est déjà
    // réclamée (supplantation refusée), soit la version d'affectation a bougé.
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(FulfilmentError);
    expect((loser.reason as FulfilmentError).code).toBe("STALE");
    const a = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(a).toMatchObject({ status: "REVOKED", levelId: null, version: assignment.version + 1 });
    expect(await prisma.accessAssignmentEvent.count({ where: { assignmentId: assignment.id } })).toBe(1);
  });

  it("A18 — remplacement par retrait puis octroi : l'étape 1 seule enregistre « aucun accès » et un travail bloqué, puis la reprise accorde", async () => {
    const emp = await newEmployee(fx, "Partial");
    const before = await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedSelfRequest(fx, emp, fx.levels.editor);
    const taskId = await claimed(final.id);
    const step1 = await completeTask(fx.orgId, fx.users.owner, taskId, {
      ...facts({ method: "REMOVE_THEN_GRANT", partialRemovalOnly: true, note: "ancien rôle retiré" }),
      expectedRevision: 2,
    });
    expect(step1).toMatchObject({ state: "BLOCKED", outcome: null, assignmentVersion: before.version + 1 });
    const mid = await currentAssignment(fx, emp);
    expect(mid).toMatchObject({ status: "REVOKED", levelId: null });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("BLOCKED");
    expect(task.blockedReason).toBe("Ancien niveau retiré — nouvel accès pas encore accordé");
    expect(task.expectedAssignmentVersion).toBe(before.version + 1);
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("BLOCKED");
    // Rien de périmé ni d'annulation demandée : la reprise reste la seule issue.
    await expectCode(reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "rien fait", expectedRevision: 3 }), "INVALID_TRANSITION");

    await resumeTask(fx.orgId, fx.users.owner, taskId, 3);
    const done = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ method: "REMOVE_THEN_GRANT" }), expectedRevision: 4 });
    expect(done).toMatchObject({ state: "COMPLETED", outcome: "CHANGED", assignmentVersion: before.version + 2 });
    expect(await currentAssignment(fx, emp)).toMatchObject({ status: "ACTIVE", levelId: fx.levels.editor });
    const history = await prisma.accessAssignmentEvent.findMany({ where: { assignmentId: before.id }, orderBy: { occurredAt: "asc" } });
    expect(history.map((e) => [e.beforeLevelId, e.afterLevelId])).toEqual([[fx.levels.reader, null], [null, fx.levels.editor]]);
  });

  it("« seul l'ancien niveau retiré » refusé hors changement de niveau par retrait puis octroi", async () => {
    const emp = await newEmployee(fx, "PartialBad");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    await expectCode(
      completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ method: "REMOVE_THEN_GRANT", partialRemovalOnly: true }), expectedRevision: 2 }),
      "VALIDATION"
    );
  });

  it("confirmer une tâche non réclamée, ou réclamée par un autre → INVALID_TRANSITION", async () => {
    const emp = await newEmployee(fx, "NotClaimed");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await expectCode(completeTask(fx.orgId, fx.users.owner, task.id, { ...facts(), expectedRevision: 1 }), "INVALID_TRANSITION");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await expectCode(completeTask(fx.orgId, fx.users.backup, task.id, { ...facts(), expectedRevision: 2 }), "INVALID_TRANSITION");
  });

  describe("revérifications à la confirmation → STALE avec un motif actionnable", () => {
    async function claimedGrant(label: string, opts: { periodEnd?: Date } = {}) {
      const emp = await newEmployee(fx, label);
      const final = await approvedSelfRequest(fx, emp, fx.levels.reader, opts);
      return { emp, taskId: await claimed(final.id) };
    }
    async function expectStale(taskId: string, message: string, now?: Date) {
      const p = completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 }, now ? { now } : {});
      await expect(p).rejects.toMatchObject({ code: "STALE", message });
    }

    it("niveau cible archivé", async () => {
      const { taskId } = await claimedGrant("StaleLevel");
      await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: new Date() } });
      try {
        await expectStale(taskId, "Le niveau cible a été archivé");
      } finally {
        await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: null } });
      }
    });

    it("catalogueVersion modifiée", async () => {
      const { taskId } = await claimedGrant("StaleCatalogue");
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { catalogueVersion: { increment: 1 } } });
      try {
        await expectStale(taskId, "Le catalogue de l'application a changé depuis l'approbation");
      } finally {
        await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { catalogueVersion: { decrement: 1 } } });
      }
    });

    it("affectation modifiée depuis l'approbation (assignment.version)", async () => {
      const { emp, taskId } = await claimedGrant("StaleAssignment");
      await prisma.accessAssignment.create({
        data: { orgId: fx.orgId, userId: emp, assetId: fx.assetId, levelId: null, status: "REVOKED" },
      });
      await expectStale(taskId, "L'affectation a changé depuis l'approbation");
    });

    it("bénéficiaire parti (octroi)", async () => {
      const { emp, taskId } = await claimedGrant("StaleDeparted");
      await prisma.accessProfile.update({ where: { userId: emp }, data: { lifecycle: "DEPARTED" } });
      await expectStale(taskId, "L'employé n'est plus actif");
    });

    it("période temporaire échue avant la confirmation", async () => {
      const { taskId } = await claimedGrant("StalePeriod", { periodEnd: new Date(Date.now() + 3_600_000) });
      await expectStale(taskId, "La période est terminée — la demande doit être révisée", new Date(Date.now() + 2 * 3_600_000));
    });
  });

  it("D-23 — un renouvellement confirmé supplante la tâche d'expiration NON réclamée ; réclamée → refus « à réconcilier »", async () => {
    for (const expiryClaimed of [false, true]) {
      const emp = await newEmployee(fx, expiryClaimed ? "RenewBlocked" : "RenewWins");
      const assignment = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() + DAY) });
      const newEnd = new Date(Date.now() + 60 * DAY);
      const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: newEnd });
      const renewTaskId = await claimed(final.id);
      await prisma.accessAssignment.update({ where: { id: assignment.id }, data: { status: "EXPIRED_REMOVAL_PENDING" } });
      const expiry = await prisma.accessFulfilmentTask.create({
        data: {
          orgId: fx.orgId, assetId: fx.assetId, beneficiaryId: emp, action: "EXPIRY_REMOVAL",
          sourceAssignmentId: assignment.id, sourceAssignmentVersion: assignment.version, fromLevelId: fx.levels.reader,
          expectedAssignmentVersion: assignment.version, idempotencyKey: `EXP:${assignment.id}:${assignment.version}`,
        },
      });
      if (expiryClaimed) {
        await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);
        await expect(
          completeTask(fx.orgId, fx.users.owner, renewTaskId, { ...facts(), expectedRevision: 2 })
        ).rejects.toMatchObject({ code: "STALE", message: "Un retrait est en cours — à réconcilier" });
        continue;
      }
      await completeTask(fx.orgId, fx.users.owner, renewTaskId, { ...facts(), expectedRevision: 2 });
      const a = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a).toMatchObject({ status: "ACTIVE", levelId: fx.levels.reader, version: assignment.version + 1 });
      expect(a.periodEnd?.getTime()).toBe(newEnd.getTime());
      const superseded = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: expiry.id } });
      expect(superseded).toMatchObject({ state: "CANCELLED", outcome: "SUPERSEDED" });
      expect(await prisma.accessTaskEvent.findFirst({ where: { taskId: expiry.id, type: "CANCELLED" } })).toMatchObject({
        reason: "Supplantée par un renouvellement",
      });
    }
  });

  it("Review Focus #2 — le propriétaire exécute sa propre demande : autorisé (D-7), audit selfFulfilled", async () => {
    await prisma.accessProfile.update({ where: { userId: fx.users.owner }, data: { primaryDepartmentId: fx.departmentId } });
    const final = await approvedSelfRequest(fx, fx.users.owner, fx.levels.reader);
    const taskId = await claimed(final.id, fx.users.owner);
    await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 });
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED", objectId: taskId } });
    expect(audit.after).toMatchObject({ selfFulfilled: true });
    expect((await currentAssignment(fx, fx.users.owner))?.levelId).toBe(fx.levels.reader);
  });

  it("Review Focus #3 — actif archivé : le retrait reste confirmable, un octroi est refusé", async () => {
    const empRevoke = await newEmployee(fx, "ArchRevoke");
    await giveAccess(fx, empRevoke, fx.levels.reader);
    const revoke = await approvedReduction(fx, empRevoke, null);
    const revokeTaskId = await claimed(revoke.id);
    const empGrant = await newEmployee(fx, "ArchGrant");
    const grant = await approvedSelfRequest(fx, empGrant, fx.levels.reader);
    const grantTaskId = await claimed(grant.id);

    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: new Date() } });
    try {
      await expect(
        completeTask(fx.orgId, fx.users.owner, grantTaskId, { ...facts(), expectedRevision: 2 })
      ).rejects.toMatchObject({ code: "STALE", message: "L'application a été archivée" });
      const res = await completeTask(fx.orgId, fx.users.owner, revokeTaskId, { ...facts(), expectedRevision: 2 });
      expect(res.outcome).toBe("REVOKED");
    } finally {
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: null } });
    }
  });
});

describe("fulfilment-server — lots (D-13, FP:252/254, A17)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("batch");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function readyTaskId(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return { emp, taskId: (await taskForVersion(final.id)).id };
  }

  it("réclamer en lot : résultat par élément, un élément hors périmètre n'empêche pas les autres, correlationId commun dans l'audit", async () => {
    const a = await readyTaskId("BatchA");
    const b = await readyTaskId("BatchB");
    const res = await claimTasksBatch(fx.orgId, fx.users.owner, [
      { taskId: a.taskId, expectedRevision: 1 },
      { taskId: "id-inexistant", expectedRevision: 1 },
      { taskId: b.taskId, expectedRevision: 1 },
    ]);
    expect(res.results).toEqual([
      { taskId: a.taskId, ok: true, error: null, code: null },
      { taskId: "id-inexistant", ok: false, error: "Tâche introuvable", code: "NOT_FOUND" },
      { taskId: b.taskId, ok: true, error: null, code: null },
    ]);
    const audits = await prisma.accessAuditEvent.findMany({ where: { orgId: fx.orgId, eventType: "TASK_CLAIMED" } });
    expect(audits.map((x) => x.correlationId)).toEqual([res.correlationId, res.correlationId]);
  });

  it("confirmer en lot : chaque élément porte sa propre preuve ; un échec n'annule pas les succès ; un nouvel essai ne duplique rien", async () => {
    const a = await readyTaskId("DoneA");
    const b = await readyTaskId("DoneB");
    await claimTasksBatch(fx.orgId, fx.users.owner, [
      { taskId: a.taskId, expectedRevision: 1 },
      { taskId: b.taskId, expectedRevision: 1 },
    ]);
    const completedAt = new Date(Date.now() - 1_000);
    const items = [
      { taskId: a.taskId, completedAt, reference: "REF-A", note: null, expectedRevision: 2 },
      { taskId: b.taskId, completedAt, reference: "REF-B", note: null, expectedRevision: 99 },
    ];
    const first = await completeTasksBatch(fx.orgId, fx.users.owner, items);
    expect(first.results.map((r) => [r.ok, r.code])).toEqual([[true, null], [false, "STALE"]]);
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: a.taskId } })).completionReference).toBe("REF-A");

    // Nouvel essai de tout le lot, B corrigé : A est rejouée sans écriture, B aboutit.
    const retry = await completeTasksBatch(fx.orgId, fx.users.owner, [items[0], { ...items[1], expectedRevision: 2 }]);
    expect(retry.results.every((r) => r.ok)).toBe(true);
    expect(await prisma.accessAssignmentEvent.count({ where: { orgId: fx.orgId, userId: a.emp } })).toBe(1);
    expect(await prisma.accessAssignmentEvent.count({ where: { orgId: fx.orgId, userId: b.emp } })).toBe(1);
    const completedAudits = await prisma.accessAuditEvent.findMany({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED" } });
    expect(completedAudits.map((x) => x.correlationId).sort()).toEqual([first.correlationId, retry.correlationId].sort());
  });
});

describe("fulfilment-server — correctifs ronde 1 (F1, F2)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("fix1");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function partiallyRemoved(label: string) {
    const emp = await newEmployee(fx, label);
    const before = await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedSelfRequest(fx, emp, fx.levels.editor);
    const task = await taskForVersion(final.id);
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await completeTask(fx.orgId, fx.users.owner, task.id, {
      completedAt: new Date(Date.now() - 1_000), reference: "R1", note: null,
      method: "REMOVE_THEN_GRANT", partialRemovalOnly: true, expectedRevision: 2,
    });
    return { emp, before, final, taskId: task.id };
  }

  it("F1 — retrait partiel puis niveau cible archivé : réconciliation OLD_LEVEL_REMOVED, demande fermée, affectation intacte, nouvelle demande possible", async () => {
    const { emp, final, taskId } = await partiallyRemoved("F1a");
    const assignmentBefore = await currentAssignment(fx, emp);
    await prisma.accessLevel.update({ where: { id: fx.levels.editor }, data: { archivedAt: new Date() } });
    try {
      const res = await reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "Niveau cible supprimé", expectedRevision: 3 });
      expect(res).toEqual({ taskId, state: "CANCELLED", revision: 4 });
      const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
      expect(task).toMatchObject({ state: "CANCELLED", outcome: "OLD_LEVEL_REMOVED" });
      const version = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } });
      expect(version).toMatchObject({ state: "CANCELLED", outcome: "OLD_LEVEL_REMOVED" });
      expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).not.toBeNull();
      const assignmentAfter = await currentAssignment(fx, emp);
      expect(assignmentAfter).toMatchObject({ status: "REVOKED", levelId: null, version: assignmentBefore!.version });
      const event = await prisma.accessTaskEvent.findFirstOrThrow({ where: { taskId, type: "RECONCILED" } });
      expect(event.reason).toBe("Niveau cible supprimé");
      expect(event.facts).toMatchObject({ oldRemovedAt: expect.any(String) });
      const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_RECONCILED", objectId: taskId } });
      expect(audit.after).toMatchObject({ outcome: "OLD_LEVEL_REMOVED" });
      const again = await submitRequest(fx.orgId, emp, {
        beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "nouvelle demande",
      });
      expect(again.state).toBeDefined();
    } finally {
      await prisma.accessLevel.update({ where: { id: fx.levels.editor }, data: { archivedAt: null } });
    }
  });

  it("F1 — retrait partiel, annulation demandée : réconciliation autorisée", async () => {
    const { emp, final, taskId } = await partiallyRemoved("F1c");
    expect(await cancelRequest(fx.orgId, emp, final.requestId)).toBe("CANCEL_REQUESTED");
    const res = await reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "annulée", expectedRevision: 3 });
    expect(res.state).toBe("CANCELLED");
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } })).outcome).toBe("OLD_LEVEL_REMOVED");
  });

  it("F1 — retrait partiel sans rien de périmé ni annulation : réconciliation toujours refusée", async () => {
    const { taskId } = await partiallyRemoved("F1b");
    await expectCode(reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "rien fait", expectedRevision: 3 }), "INVALID_TRANSITION");
  });

  it("F2 — confirmation finale après retrait partiel, méthode omise ou directe : REMOVE_THEN_GRANT enregistrée (tâche et audit)", async () => {
    for (const method of [undefined, "DIRECT" as const]) {
      const { taskId } = await partiallyRemoved(`F2${method ?? "none"}`);
      await resumeTask(fx.orgId, fx.users.owner, taskId, 3);
      await completeTask(fx.orgId, fx.users.owner, taskId, {
        completedAt: new Date(Date.now() - 500), reference: "R2", note: null, ...(method ? { method } : {}), expectedRevision: 4,
      });
      expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } })).completionMethod).toBe("REMOVE_THEN_GRANT");
      const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED", objectId: taskId } });
      expect(audit.after).toMatchObject({ method: "REMOVE_THEN_GRANT" });
    }
  });
});

describe("fulfilment-server — F3a : un retrait confirmé supplante l'expiration non réclamée", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("fix3a");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function revokeWithExpiry(label: string) {
    const emp = await newEmployee(fx, label);
    const assignment = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - 86_400_000) });
    const final = await approvedReduction(fx, emp, null);
    await prisma.accessAssignment.update({ where: { id: assignment.id }, data: { status: "EXPIRED_REMOVAL_PENDING" } });
    const expiry = await prisma.accessFulfilmentTask.create({
      data: {
        orgId: fx.orgId, assetId: fx.assetId, beneficiaryId: emp, action: "EXPIRY_REMOVAL",
        sourceAssignmentId: assignment.id, sourceAssignmentVersion: assignment.version, fromLevelId: fx.levels.reader,
        expectedAssignmentVersion: assignment.version, idempotencyKey: `EXP:${assignment.id}:${assignment.version}`,
      },
    });
    const task = await taskForVersion(final.id);
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    return { expiry, taskId: task.id };
  }
  const facts = () => ({ completedAt: new Date(), reference: "T", note: null, expectedRevision: 2 });

  it("expiration READY : annulée (SUPERSEDED) avec le motif du retrait confirmé", async () => {
    const { expiry, taskId } = await revokeWithExpiry("F3aReady");
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, facts());
    expect(res.outcome).toBe("REVOKED");
    expect(await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: expiry.id } })).toMatchObject({ state: "CANCELLED", outcome: "SUPERSEDED" });
    expect(await prisma.accessTaskEvent.findFirstOrThrow({ where: { taskId: expiry.id, type: "CANCELLED" } })).toMatchObject({
      reason: "Supplantée par un retrait confirmé",
    });
  });

  it("expiration réclamée : STALE « à réconcilier », rien n'est écrit", async () => {
    const { expiry, taskId } = await revokeWithExpiry("F3aClaimed");
    await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);
    await expect(completeTask(fx.orgId, fx.users.owner, taskId, facts())).rejects.toMatchObject({
      code: "STALE", message: "Un retrait est en cours — à réconcilier",
    });
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } })).state).toBe("CLAIMED");
  });
});

describe("fulfilment-server — garde-fous F5", () => {
  let fx: FulfilmentFixture;
  let other: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("guard");
    other = await createFulfilmentFixture("guardother");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
    await cleanupFulfilmentFixture(other.orgId);
  });

  async function readyTask(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return taskForVersion(final.id);
  }

  it("acteur indisponible (compte inactif ou profil OFFBOARDING) → NOT_FOUND à la réclamation", async () => {
    const task = await readyTask("Unavail");
    await prisma.user.update({ where: { id: fx.users.owner }, data: { isActive: false } });
    try {
      await expectCode(claimTask(fx.orgId, fx.users.owner, task.id, 1), "NOT_FOUND");
    } finally {
      await prisma.user.update({ where: { id: fx.users.owner }, data: { isActive: true } });
    }
    await prisma.accessProfile.update({ where: { userId: fx.users.owner }, data: { lifecycle: "OFFBOARDING" } });
    try {
      await expectCode(claimTask(fx.orgId, fx.users.owner, task.id, 1), "NOT_FOUND");
    } finally {
      await prisma.accessProfile.update({ where: { userId: fx.users.owner }, data: { lifecycle: "ACTIVE" } });
    }
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } })).state).toBe("READY");
  });

  it("réclamation d'une tâche périmée (niveau cible archivé) → STALE, la tâche reste READY", async () => {
    const task = await readyTask("StaleClaim");
    await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: new Date() } });
    try {
      await expect(claimTask(fx.orgId, fx.users.owner, task.id, 1)).rejects.toMatchObject({
        code: "STALE", message: "Le niveau cible a été archivé",
      });
    } finally {
      await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: null } });
    }
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } })).state).toBe("READY");
  });

  it("détenteur ayant perdu son périmètre (propriétaire changé) → confirmer, bloquer et réconcilier : NOT_FOUND", async () => {
    const task = await readyTask("LostScope");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    const newOwner = await newEmployee(fx, "LostScopeNewOwner");
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { ownerId: newOwner, backupOwnerId: null } });
    try {
      await expectCode(
        completeTask(fx.orgId, fx.users.owner, task.id, { completedAt: new Date(), reference: "X", note: null, expectedRevision: 2 }),
        "NOT_FOUND"
      );
      await expectCode(blockTask(fx.orgId, fx.users.owner, task.id, { reason: "x", facts: null, expectedRevision: 2 }), "NOT_FOUND");
      await expectCode(reconcileTask(fx.orgId, fx.users.owner, task.id, { reason: "x", expectedRevision: 2 }), "NOT_FOUND");
    } finally {
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { ownerId: fx.users.owner, backupOwnerId: fx.users.backup } });
    }
  });

  it("acteur d'une autre organisation → NOT_FOUND", async () => {
    const task = await readyTask("CrossOrg");
    await expectCode(claimTask(other.orgId, other.users.owner, task.id, 1), "NOT_FOUND");
    await expectCode(claimTask(fx.orgId, other.users.owner, task.id, 1), "NOT_FOUND");
  });
});
