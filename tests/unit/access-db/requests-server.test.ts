import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { submitRequest, RequestError } from "@/lib/access/requests-server";

describe("requests-server — soumission", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let cooId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;
  let levelAdminId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Requests Org", slug: `test-requests-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso, coo] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `coo-${Date.now()}@example.com`, name: "Coo", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;
    cooId = coo.id;

    await Promise.all([
      prisma.accessProfile.create({ data: { orgId, userId: employeeId, lifecycle: "ACTIVE" } }),
      prisma.accessProfile.create({ data: { orgId, userId: deptHeadId, lifecycle: "ACTIVE" } }),
      prisma.accessProfile.create({ data: { orgId, userId: cisoId, lifecycle: "ACTIVE" } }),
      prisma.accessProfile.create({ data: { orgId, userId: cooId, lifecycle: "ACTIVE" } }),
    ]);

    const dept = await prisma.department.create({
      data: { orgId, code: "DR", name: "Dept Requests", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "COO", userId: cooId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Requests" } });
    assetId = asset.id;
    const levelReader = await prisma.accessLevel.create({
      data: { assetId, name: "Reader", priority: 1, isAdmin: false },
    });
    levelReaderId = levelReader.id;
    const levelAdmin = await prisma.accessLevel.create({
      data: { assetId, name: "Admin", priority: 10, isAdmin: true },
    });
    levelAdminId = levelAdmin.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("un employé ordinaire demandant un niveau non-admin : route chef de département → CISO", async () => {
    const version = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelReaderId,
      justification: "besoin métier",
    });
    expect(version.kind).toBe("GRANT");
    expect(version.state).toBe("PENDING_APPROVAL");
    expect(version.stages.map((s) => s.role)).toEqual(["DEPARTMENT_HEAD", "CISO"]);
    expect(version.stages.every((s) => s.decision === null)).toBe(true);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: version.id } });
    await prisma.accessRequestVersion.delete({ where: { id: version.id } });
    await prisma.accessRequest.delete({ where: { id: version.requestId } });
  });

  it("un employé ordinaire demandant un niveau admin : route chef de département → CISO → COO", async () => {
    const version = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelAdminId,
      justification: "besoin admin",
    });
    expect(version.stages.map((s) => s.role)).toEqual(["DEPARTMENT_HEAD", "CISO", "COO"]);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: version.id } });
    await prisma.accessRequestVersion.delete({ where: { id: version.id } });
    await prisma.accessRequest.delete({ where: { id: version.requestId } });
  });

  it("le titulaire COO demandant son propre accès : aucune étape, exceptionReason renseigné", async () => {
    const version = await submitRequest(orgId, cooId, {
      beneficiaryId: cooId,
      assetId,
      targetLevelId: levelAdminId,
      justification: "besoin COO",
    });
    expect(version.stages).toHaveLength(0);
    expect(version.exceptionReason).toBe("COO_SELF_REQUEST");
    expect(version.state).toBe("READY_FOR_FULFILMENT");

    await prisma.accessRequestVersion.delete({ where: { id: version.id } });
    await prisma.accessRequest.delete({ where: { id: version.requestId } });
  });

  it("une deuxième demande non terminale sur le même couple employé/actif est rejetée", async () => {
    const first = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelReaderId,
      justification: "première demande",
    });

    await expect(
      submitRequest(orgId, employeeId, {
        beneficiaryId: employeeId,
        assetId,
        targetLevelId: levelAdminId,
        justification: "deuxième demande",
      })
    ).rejects.toThrow(RequestError);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: first.id } });
    await prisma.accessRequestVersion.delete({ where: { id: first.id } });
    await prisma.accessRequest.delete({ where: { id: first.requestId } });
  });

  it("une demande dupliquée (même niveau, même période que l'existant) est rejetée avant toute écriture", async () => {
    await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });

    await expect(
      submitRequest(orgId, employeeId, {
        beneficiaryId: employeeId,
        assetId,
        targetLevelId: levelReaderId,
        justification: "doublon",
        periodEnd: null,
      })
    ).rejects.toThrow();

    const requestCount = await prisma.accessRequest.count({ where: { orgId, beneficiaryId: employeeId, assetId } });
    expect(requestCount).toBe(0);

    await prisma.accessAssignment.deleteMany({ where: { orgId, userId: employeeId, assetId } });
  });

  it("un employé DEPARTED ne peut pas soumettre de demande de GRANT", async () => {
    const departed = await prisma.user.create({
      data: { orgId, email: `departed-${Date.now()}@example.com`, name: "Departed", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: departed.id, lifecycle: "DEPARTED" } });

    await expect(
      submitRequest(orgId, departed.id, {
        beneficiaryId: departed.id,
        assetId,
        targetLevelId: levelReaderId,
        justification: "test",
      })
    ).rejects.toThrow(RequestError);

    await prisma.accessProfile.deleteMany({ where: { userId: departed.id } });
    await prisma.user.delete({ where: { id: departed.id } });
  });
});
