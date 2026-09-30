// tests/unit/access-db/fulfilment-read-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { decideStage, submitRequest } from "@/lib/access/requests-server";
import { FulfilmentError } from "@/lib/access/fulfilment-server";
import { getFulfilmentNav, listFulfilmentTasks, type TaskListQuery } from "@/lib/access/fulfilment-read-server";
import {
  approvedReduction,
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  giveAccess,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

const open: TaskListQuery = { view: "mine", state: "open", page: 1, pageSize: 25 };

async function expectNotFound(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(FulfilmentError);
  await expect(p).rejects.toMatchObject({ code: "NOT_FOUND" });
}

describe("fulfilment-read-server — visibilité des tâches (D-6, D-14, A05)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("read");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("A05 : une demande en attente n'apparaît jamais chez le propriétaire, ni dans le total ; après approbation, oui", async () => {
    const emp = await newEmployee(fx, "A05");
    const pending = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "en attente",
    });
    const before = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, open);
    expect(before.rows.some((r) => r.beneficiaryId === emp)).toBe(false);
    const totalBefore = before.total;

    // Approbation : chef puis CISO (la version en attente devient autorisée).
    const afterHead = await decideStage(fx.orgId, fx.users.deptHead, pending.stages[0].id, "APPROVE", null);
    await decideStage(fx.orgId, fx.users.ciso, afterHead.stages[1].id, "APPROVE", null);

    const after = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, open);
    expect(after.total).toBe(totalBefore + 1);
    const row = after.rows.find((r) => r.beneficiaryId === emp)!;
    expect(row).toMatchObject({
      state: "READY",
      action: "GRANT",
      beneficiaryName: "A05",
      assetName: "Asset read",
      toLevelName: "Reader",
      fromLevelName: null,
      ownerReason: "en attente",
      viewerRole: "ASSET_OWNER",
      hasOwner: true,
      staleReason: null,
    });
    expect(row.departmentName).toBe("Dept read");
    expect(row.viewerCan).toEqual({ claim: true, complete: false, block: false, resume: false, handover: false, reconcile: false });
    // Résumé d'approbation : rôle, décision, date — jamais de motif interne.
    expect(row.approvalSummary.map((s) => [s.role, s.decision])).toEqual([["DEPARTMENT_HEAD", "APPROVE"], ["CISO", "APPROVE"]]);
    expect(Object.keys(row.approvalSummary[0]).sort()).toEqual(["decidedAt", "decision", "role"]);
    expect(row.reference).toMatch(/^EX-[A-Z0-9]{6}$/);
  });

  it("le suppléant voit la même tâche (rôle suppléant) ; un tiers → 404 ; un filtre d'actif hors périmètre → 404", async () => {
    const emp = await newEmployee(fx, "Backup");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    const backupView = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.backup }, open);
    expect(backupView.rows.find((r) => r.id === task.id)?.viewerRole).toBe("ASSET_OWNER_BACKUP");
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.stranger }, open));
    const other = await prisma.accessAsset.create({ data: { orgId: fx.orgId, name: "Autre appli" } });
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, { ...open, assetId: other.id }));
    await prisma.accessAsset.delete({ where: { id: other.id } });
  });

  it("supervision : CISO/COO voient tout en lecture seule, y compris « aucun propriétaire » ; le propriétaire n'y a pas accès", async () => {
    const orphan = await prisma.accessAsset.create({ data: { orgId: fx.orgId, name: "Sans propriétaire", requestsEnabled: true } });
    const orphanLevel = await prisma.accessLevel.create({ data: { assetId: orphan.id, name: "Base", priority: 1, isAdmin: false } });
    // Exception COO : autorisée d'emblée, sans étape.
    const coo = await submitRequest(fx.orgId, fx.users.coo, {
      beneficiaryId: fx.users.coo, assetId: orphan.id, targetLevelId: orphanLevel.id, justification: "COO",
    });
    expect(coo.state).toBe("READY_FOR_FULFILMENT");
    const oversight = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.ciso }, { ...open, view: "oversight" });
    const row = oversight.rows.find((r) => r.assetId === orphan.id)!;
    expect(row).toMatchObject({ hasOwner: false, viewerRole: null, approvalException: "COO_SELF_REQUEST" });
    expect(Object.values(row.viewerCan).every((v) => v === false)).toBe(true);
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, { ...open, view: "oversight" }));
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.ciso }, open));
  });

  it("Review Focus #3 — une tâche de retrait sur un actif ARCHIVÉ reste visible et réclamable par le propriétaire (FP:110)", async () => {
    const emp = await newEmployee(fx, "Archive");
    await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedReduction(fx, emp, null);
    const task = await taskForVersion(final.id);
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: new Date() } });
    const view = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, open);
    const row = view.rows.find((r) => r.id === task.id)!;
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: null } });
    expect(row).toMatchObject({ action: "REVOKE", assetArchived: true, staleReason: null });
    expect(row.viewerCan.claim).toBe(true);
  });

  it("getFulfilmentNav : propriétaire (à faire), CISO (supervision), tiers (rien)", async () => {
    expect(await getFulfilmentNav(fx.orgId, fx.users.owner)).toEqual({ hasMine: true, canOversee: false });
    expect(await getFulfilmentNav(fx.orgId, fx.users.ciso)).toEqual({ hasMine: false, canOversee: true });
    expect(await getFulfilmentNav(fx.orgId, fx.users.stranger)).toEqual({ hasMine: false, canOversee: false });
  });
});
