// tests/unit/access-db/access-processor.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { reviseRequest, submitRequest, decideStage } from "@/lib/access/requests-server";
import { claimTask, completeTask } from "@/lib/access/fulfilment-server";
import { listFulfilmentTasks } from "@/lib/access/fulfilment-read-server";
import { runAccessProcessor } from "@/lib/access/access-processor";
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("access-processor — processeur 5 minutes (D-11, FP:229/231, A19)", () => {
  let fx: FulfilmentFixture;
  const run = (now: Date) => runAccessProcessor(now, { orgIds: [fx.orgId] });

  beforeAll(async () => {
    fx = await createFulfilmentFixture("processor");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("1. libère une version AUTHORIZED_WAITING_START à periodStart (acteur SYSTEM), une seule fois", async () => {
    const emp = await newEmployee(fx, "Start");
    const periodStart = new Date(Date.now() + HOUR);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodStart });
    expect(final.state).toBe("AUTHORIZED_WAITING_START");

    expect((await run(new Date())).released).toBe(0);
    const later = new Date(Date.now() + 2 * HOUR);
    expect(await run(later)).toMatchObject({ released: 1, errors: 0 });
    expect(await run(later)).toMatchObject({ released: 0, repaired: 0 });

    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("READY_FOR_FULFILMENT");
    const task = await taskForVersion(final.id);
    expect(task.state).toBe("READY");
    expect(await prisma.accessTaskEvent.findFirst({ where: { taskId: task.id, type: "RELEASED" } })).toMatchObject({ actorId: null, actingAs: "SYSTEM" });
    expect(
      await prisma.accessAuditEvent.findFirst({ where: { orgId: fx.orgId, eventType: "REQUEST_RELEASED", objectId: final.id } })
    ).toMatchObject({ actorId: "SYSTEM" });
  });

  it("2. auto-réparation : une version READY sans tâche (antérieure à la phase 3b) reçoit sa tâche, une seule fois", async () => {
    const emp = await newEmployee(fx, "Repair");
    const request = await prisma.accessRequest.create({ data: { orgId: fx.orgId, beneficiaryId: emp, assetId: fx.assetId } });
    const version = await prisma.accessRequestVersion.create({
      data: {
        requestId: request.id, versionNumber: 1, kind: "GRANT", initiatorId: emp, targetLevelId: fx.levels.reader,
        justification: "prête avant 3b", periodStart: new Date(Date.now() - DAY), departmentSnapshot: fx.departmentId,
        assignmentVersion: 0, catalogueVersion: 1, state: "READY_FOR_FULFILMENT",
      },
    });
    expect((await run(new Date())).repaired).toBe(1);
    expect((await run(new Date())).repaired).toBe(0);
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: version.id } })).toBe(1);
  });

  it("3. expiration idempotente : 2 passages = 1 tâche de retrait ; niveau et version conservés ; rien n'est retiré", async () => {
    const emp = await newEmployee(fx, "Expire");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    const first = await run(new Date());
    const second = await run(new Date());
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);

    const after = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ status: "EXPIRED_REMOVAL_PENDING", levelId: fx.levels.reader, version: a.version });
    const tasks = await prisma.accessFulfilmentTask.findMany({ where: { sourceAssignmentId: a.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      action: "EXPIRY_REMOVAL", state: "READY", idempotencyKey: `EXP:${a.id}:${a.version}`, expectedAssignmentVersion: a.version,
    });
    expect(await prisma.accessAssignmentEvent.findFirst({ where: { assignmentId: a.id } })).toMatchObject({
      sourceType: "EXPIRY", actorId: null, beforeLevelId: fx.levels.reader, afterLevelId: fx.levels.reader,
    });
    const view = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, { view: "mine", state: "open", page: 1, pageSize: 100 });
    expect(view.rows.find((r) => r.id === tasks[0].id)).toMatchObject({
      action: "EXPIRY_REMOVAL", ownerReason: "Fin de période temporaire", approvalSummary: [],
    });
  });

  it("4. tâche READY à période échue → CANCELLED, version REVISION_REQUIRED, le demandeur peut réviser ; une tâche réclamée n'est pas touchée", async () => {
    const emp = await newEmployee(fx, "Overdue");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() + HOUR) });
    const empClaimed = await newEmployee(fx, "OverdueClaimed");
    const claimedFinal = await approvedSelfRequest(fx, empClaimed, fx.levels.reader, { periodEnd: new Date(Date.now() + HOUR) });
    await claimTask(fx.orgId, fx.users.owner, (await taskForVersion(claimedFinal.id)).id, 1);

    expect((await run(new Date(Date.now() + 2 * HOUR))).revisionRequired).toBe(1);
    const task = await taskForVersion(final.id);
    expect(task).toMatchObject({ state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT" });
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("REVISION_REQUIRED");
    expect((await taskForVersion(claimedFinal.id)).state).toBe("CLAIMED");

    const revised = await reviseRequest(fx.orgId, emp, final.id, { periodEnd: new Date(Date.now() + 30 * DAY) });
    expect(revised.state).toBe("PENDING_APPROVAL");
  });

  it("I3 — l'auto-réparation ne crée pas de tâche sur une version qui n'est plus READY (annulation survenue après la lecture des candidats)", async () => {
    const emp = await newEmployee(fx, "RepairCancelled");
    const request = await prisma.accessRequest.create({
      data: { orgId: fx.orgId, beneficiaryId: emp, assetId: fx.assetId, closedAt: new Date() },
    });
    const version = await prisma.accessRequestVersion.create({
      data: {
        requestId: request.id, versionNumber: 1, kind: "GRANT", initiatorId: emp, targetLevelId: fx.levels.reader,
        justification: "annulée entre-temps", periodStart: new Date(Date.now() - DAY), departmentSnapshot: fx.departmentId,
        assignmentVersion: 0, catalogueVersion: 1, state: "CANCELLED",
      },
    });
    // Simule la course : la lecture des candidats (hors transaction) voyait encore la version READY.
    const original = prisma.accessRequestVersion.findMany.bind(prisma.accessRequestVersion);
    const spy = vi.spyOn(prisma.accessRequestVersion, "findMany").mockImplementation(((args: { where?: { fulfilmentTasks?: unknown } }) =>
      args?.where?.fulfilmentTasks
        ? Promise.resolve([{ ...version, state: "READY_FOR_FULFILMENT", request }])
        : original(args as never)) as never);
    try {
      expect((await run(new Date())).repaired).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: version.id } })).toBe(0);
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: version.id } })).revision).toBe(version.revision);
  });

  it("I4 — une tâche de réduction READY dont la version a une période échue n'est pas renvoyée en révision et reste réclamable", async () => {
    const emp = await newEmployee(fx, "ReduceOverdue");
    await giveAccess(fx, emp, fx.levels.editor);
    const final = await approvedReduction(fx, emp, fx.levels.reader);
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { periodEnd: new Date(Date.now() - HOUR) } });
    const task = await taskForVersion(final.id);
    expect(task).toMatchObject({ action: "CHANGE_LEVEL", state: "READY" });
    await prisma.accessFulfilmentTask.update({ where: { id: task.id }, data: { periodEnd: new Date(Date.now() - HOUR) } });
    expect((await run(new Date())).revisionRequired).toBe(0);
    expect((await taskForVersion(final.id)).state).toBe("READY");
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("READY_FOR_FULFILMENT");
    await expect(claimTask(fx.orgId, fx.users.owner, task.id, 1)).resolves.toBeDefined();
  });

  it("A19 — accès temporaire expiré puis renouvelé (octroi, D-23) : l'expiration non réclamée est supplantée", async () => {
    const emp = await newEmployee(fx, "Renewed");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    await run(new Date());
    const expiry = await prisma.accessFulfilmentTask.findFirstOrThrow({ where: { sourceAssignmentId: a.id } });

    const newEnd = new Date(Date.now() + 60 * DAY);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: newEnd });
    expect(final.kind).toBe("GRANT");
    const taskId = (await taskForVersion(final.id)).id;
    await claimTask(fx.orgId, fx.users.owner, taskId, 1);
    await completeTask(fx.orgId, fx.users.owner, taskId, { completedAt: new Date(), reference: "RENEW-1", note: null, expectedRevision: 2 });

    const after = await currentAssignment(fx, emp);
    expect(after).toMatchObject({ status: "ACTIVE", levelId: fx.levels.reader, version: a.version + 1 });
    expect(after?.periodEnd?.getTime()).toBe(newEnd.getTime());
    expect(await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: expiry.id } })).toMatchObject({
      state: "CANCELLED", outcome: "SUPERSEDED",
    });
    // Le passage suivant ne recrée rien : la nouvelle période n'est pas échue.
    expect((await run(new Date())).expired).toBe(0);
  });

  it("A19 — expiration déjà RÉCLAMÉE : le renouvellement est refusé et doit être réconcilié", async () => {
    const emp = await newEmployee(fx, "RenewLate");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    await run(new Date());
    const expiry = await prisma.accessFulfilmentTask.findFirstOrThrow({ where: { sourceAssignmentId: a.id } });
    await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);

    const v = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "renouvellement",
      periodEnd: new Date(Date.now() + 60 * DAY),
    });
    const afterHead = await decideStage(fx.orgId, fx.users.deptHead, v.stages[0].id, "APPROVE", null);
    const final = await decideStage(fx.orgId, fx.users.ciso, afterHead.stages[1].id, "APPROVE", null);
    const taskId = (await taskForVersion(final.id)).id;
    await expect(claimTask(fx.orgId, fx.users.owner, taskId, 1)).rejects.toMatchObject({
      code: "STALE",
      message: "Un retrait est en cours — à réconcilier",
    });
  });

  it("F3b — balayage : une tâche d'expiration READY orpheline est annulée une seule fois (SYSTEM)", async () => {
    const emp = await newEmployee(fx, "Orphan");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    await run(new Date());
    const expiry = await prisma.accessFulfilmentTask.findFirstOrThrow({ where: { sourceAssignmentId: a.id, action: "EXPIRY_REMOVAL" } });
    // L'affectation a été retirée par un autre chemin : la tâche est orpheline.
    await prisma.accessAssignment.update({ where: { id: a.id }, data: { status: "REVOKED", levelId: null, version: { increment: 1 } } });
    const first = await run(new Date());
    const second = await run(new Date());
    expect(first.sweptExpiry).toBe(1);
    expect(second.sweptExpiry).toBe(0);
    expect(await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: expiry.id } })).toMatchObject({ state: "CANCELLED", outcome: "SUPERSEDED" });
    expect(await prisma.accessTaskEvent.findFirst({ where: { taskId: expiry.id, type: "CANCELLED" } })).toMatchObject({ actorId: null, actingAs: "SYSTEM" });
    expect(
      await prisma.accessAuditEvent.findFirst({ where: { orgId: fx.orgId, eventType: "TASK_CANCELLED", objectId: expiry.id } })
    ).toMatchObject({ actorId: "SYSTEM" });
  });
});
