import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

describe("contraintes en base — gestion des accès", () => {
  let orgId: string;
  let userId: string;
  let assetId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Access Org", slug: `test-access-${Date.now()}` },
    });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-access-${Date.now()}@example.com`,
        name: "Test User",
        role: "PO",
      },
    });
    userId = user.id;
    const asset = await prisma.accessAsset.create({
      data: { orgId, name: "Asset Test" },
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    await prisma.accessTaskEvent.deleteMany({ where: { orgId } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("rejette une deuxième affectation courante pour le même employé et le même actif", async () => {
    await prisma.accessAssignment.create({
      data: { orgId, userId, assetId, status: "ACTIVE", source: "LEGACY_IMPORT" },
    });

    await expect(
      prisma.accessAssignment.create({
        data: { orgId, userId, assetId, status: "ACTIVE", source: "LEGACY_IMPORT" },
      })
    ).rejects.toThrow();
  });

  it("rejette un deuxième titulaire CISO dans la même organisation", async () => {
    const secondUser = await prisma.user.create({
      data: {
        orgId,
        email: `test-ciso-2-${Date.now()}@example.com`,
        name: "Second CISO",
        role: "PO",
      },
    });

    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "CISO", userId },
    });

    await expect(
      prisma.accessRoleAssignment.create({
        data: { orgId, role: "CISO", userId: secondUser.id },
      })
    ).rejects.toThrow();
  });

  it("rejette un suppléant identique au titulaire", async () => {
    await expect(
      prisma.accessRoleAssignment.create({
        data: { orgId, role: "HR", userId, backupUserId: userId },
      })
    ).rejects.toThrow();
  });

  it("rejette une priorité de niveau dupliquée parmi les niveaux activés d'un même actif", async () => {
    await prisma.accessLevel.create({
      data: { assetId, name: "Lecture", priority: 1, isAdmin: false },
    });

    await expect(
      prisma.accessLevel.create({
        data: { assetId, name: "Lecture avancée", priority: 1, isAdmin: false },
      })
    ).rejects.toThrow();
  });

  // ── Phase 3b ────────────────────────────────────────────────────────────
  async function openVersion(requestId: string, versionNumber = 1) {
    return prisma.accessRequestVersion.create({
      data: {
        requestId,
        versionNumber,
        kind: "GRANT",
        initiatorId: userId,
        justification: "test contrainte",
        periodStart: new Date(),
        departmentSnapshot: "",
        assignmentVersion: 0,
        catalogueVersion: 1,
        state: "READY_FOR_FULFILMENT",
      },
    });
  }

  it("une seule demande OUVERTE par couple employé/actif ; une demande fermée libère le couple (index partiel)", async () => {
    const first = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    await expect(
      prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } })
    ).rejects.toThrow();
    await prisma.accessRequest.update({ where: { id: first.id }, data: { closedAt: new Date() } });
    const second = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    expect(second.closedAt).toBeNull();
    await prisma.accessRequest.update({ where: { id: second.id }, data: { closedAt: new Date() } });
  });

  it("une seule tâche ouverte par version de demande ; une tâche fermée n'empêche pas une nouvelle", async () => {
    const request = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    const version = await openVersion(request.id);
    const base = { orgId, assetId, beneficiaryId: userId, action: "GRANT" as const, requestVersionId: version.id, expectedAssignmentVersion: 0 };
    const t1 = await prisma.accessFulfilmentTask.create({ data: { ...base, idempotencyKey: `T1:${version.id}` } });
    await expect(
      prisma.accessFulfilmentTask.create({ data: { ...base, idempotencyKey: `T2:${version.id}` } })
    ).rejects.toThrow();
    await prisma.accessFulfilmentTask.update({ where: { id: t1.id }, data: { state: "CANCELLED" } });
    const t2 = await prisma.accessFulfilmentTask.create({ data: { ...base, idempotencyKey: `T2:${version.id}` } });
    expect(t2.state).toBe("READY");
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });

  it("une version référencée par une tâche ne peut pas être supprimée (FK Restrict : l'historique d'exécution survit)", async () => {
    const request = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    const version = await openVersion(request.id);
    await prisma.accessFulfilmentTask.create({
      data: { orgId, assetId, beneficiaryId: userId, action: "GRANT", requestVersionId: version.id, expectedAssignmentVersion: 0, idempotencyKey: `REQ:${version.id}` },
    });
    await expect(prisma.accessRequestVersion.delete({ where: { id: version.id } })).rejects.toThrow();
    await expect(prisma.accessRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });
});
