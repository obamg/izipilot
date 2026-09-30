// tests/unit/access-db/fulfilment-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { cancelRequest, submitRequest } from "@/lib/access/requests-server";
import {
  FulfilmentError,
  cancelReadyTaskForVersionInTx,
  claimTask,
  getFulfilmentAssetIds,
  handoverTask,
  releaseTaskInTx,
} from "@/lib/access/fulfilment-server";
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
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
