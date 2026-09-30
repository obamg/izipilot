// tests/unit/access-db/fulfilment-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  cancelReadyTaskForVersionInTx,
  getFulfilmentAssetIds,
  releaseTaskInTx,
} from "@/lib/access/fulfilment-server";
import {
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  giveAccess,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

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
