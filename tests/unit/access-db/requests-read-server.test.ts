import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { submitRequest, decideStage } from "@/lib/access/requests-server";
import { setDepartmentHeadBackup } from "@/lib/access/roles-server";
import { listMyRequests, listMyApprovals, listDepartmentReducibleAccess } from "@/lib/access/requests-read-server";

describe("requests-read-server", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Read Org", slug: `test-read-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-r-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-r-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    await Promise.all(
      [employeeId, deptHeadId].map((userId) => prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } }))
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DRD", name: "Dept Read", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Read" } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("listMyRequests renvoie les demandes de l'utilisateur avec les noms résolus", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test lecture",
    });
    const mine = await listMyRequests(orgId, employeeId);
    expect(mine).toHaveLength(1);
    expect(mine[0].assetName).toBe("Asset Read");
    expect(mine[0].targetLevelName).toBe("Reader");
    expect(mine[0].beneficiaryName).toBe("Employee");
    expect(mine[0].pendingClarificationStageId).toBeNull();

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyRequests renvoie l'id de l'étape en attente de clarification", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test clarif",
    });
    await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez");
    const mine = await listMyRequests(orgId, employeeId);
    expect(mine[0].pendingClarificationStageId).toBe(v.stages[0].id);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyApprovals ne renvoie que les étapes non décidées où l'utilisateur est effectivement éligible", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test approbation",
    });
    const pending = await listMyApprovals(orgId, deptHeadId);
    expect(pending).toHaveLength(1);
    expect(pending[0].stageRole).toBe("DEPARTMENT_HEAD");

    const decided = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    const afterDecision = await listMyApprovals(orgId, deptHeadId);
    expect(afterDecision).toHaveLength(0);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: decided.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: decided.id } });
    await prisma.accessRequest.deleteMany({ where: { id: decided.requestId } });
  });

  it("listDepartmentReducibleAccess renvoie les accès actifs des employés du département", async () => {
    const assignment = await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });
    const reducible = await listDepartmentReducibleAccess(orgId, departmentId);
    expect(reducible).toHaveLength(1);
    expect(reducible[0].userName).toBe("Employee");
    expect(reducible[0].levelName).toBe("Reader");

    // Nettoyage : les tests suivants soumettent des demandes pour ce même
    // (employeeId, assetId) et s'attendent à un état sans affectation
    // active — sans ce nettoyage, `submitRequest` les classerait en doublon
    // (même niveau, même période) au lieu de GRANT.
    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
  });

  it("chef de département indisponible sans suppléant : personne n'est éligible ; configurer un suppléant le débloque (Review Focus #5)", async () => {
    const backup = await prisma.user.create({
      data: { orgId, email: `backup-r-${Date.now()}@example.com`, name: "Backup", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: backup.id, lifecycle: "ACTIVE" } });

    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test indisponibilité",
    });
    const deptStageId = v.stages[0].id;

    // Baseline : le chef de département voit l'étape en attente.
    expect(await listMyApprovals(orgId, deptHeadId)).toHaveLength(1);

    // Il devient indisponible, sans suppléant configuré : plus personne n'est éligible —
    // ni lui, ni personne d'autre. La demande reste PENDING_APPROVAL, visible mais bloquée,
    // jamais sautée ni auto-approuvée.
    await setDepartmentHeadBackup(orgId, departmentId, backup.id, deptHeadId); // crée la ligne AccessRoleAssignment
    const assignment = await prisma.accessRoleAssignment.findFirstOrThrow({
      where: { orgId, role: "DEPARTMENT_HEAD", departmentId },
    });
    await prisma.accessRoleAssignment.update({ where: { id: assignment.id }, data: { primaryUnavailable: true } });
    // Pour un DEPARTMENT_HEAD, getEffectiveRoleHolders exige à la fois
    // primaryUnavailable=true ET l'indisponibilité réelle du titulaire
    // (isActive/lifecycle) pour que le suppléant prenne le relais — double
    // condition documentée et testée dans roles-server.test.ts ("DEPARTMENT_HEAD :
    // le suppléant agit si le titulaire est marqué indisponible via
    // l'affectation dédiée"). Le propriétaire (Department.ownerId) n'est
    // JAMAIS écarté par le seul flag primaryUnavailable — seule sa propre
    // disponibilité (isActive) le retire de la liste des chefs effectifs.
    await prisma.user.update({ where: { id: deptHeadId }, data: { isActive: false } });

    expect(await listMyApprovals(orgId, deptHeadId)).toHaveLength(0);

    // Le suppléant devient l'acteur effectif : il voit l'étape et peut la décider.
    const backupApprovals = await listMyApprovals(orgId, backup.id);
    expect(backupApprovals).toHaveLength(1);
    expect(backupApprovals[0].stageId).toBe(deptStageId);

    // Nettoyage : rendre le titulaire disponible à nouveau et retirer le suppléant pour ne
    // pas affecter les autres tests de ce describe.
    await prisma.user.update({ where: { id: deptHeadId }, data: { isActive: true } });
    await prisma.accessRoleAssignment.update({ where: { id: assignment.id }, data: { primaryUnavailable: false } });
    await setDepartmentHeadBackup(orgId, departmentId, null, deptHeadId);
    await prisma.accessProfile.deleteMany({ where: { userId: backup.id } });
    await prisma.user.delete({ where: { id: backup.id } });
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyApprovals scope les étapes DEPARTMENT_HEAD au département du bénéficiaire — le chef d'un AUTRE département ne les voit pas", async () => {
    // Second département, avec son propre chef, indépendant de `departmentId`/`deptHeadId`.
    const otherDeptHead = await prisma.user.create({
      data: { orgId, email: `dh2-r-${Date.now()}@example.com`, name: "DeptHead2", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: otherDeptHead.id, lifecycle: "ACTIVE" } });
    const otherDept = await prisma.department.create({
      data: { orgId, code: "DRD2", name: "Dept Read 2", color: "#111111", ownerId: otherDeptHead.id },
    });

    // Demande pour un bénéficiaire du PREMIER département (employeeId, membre de departmentId).
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test scoping département",
    });

    // Le chef du SECOND département ne doit voir aucune étape en attente pour cette demande.
    const otherApprovals = await listMyApprovals(orgId, otherDeptHead.id);
    expect(otherApprovals.find((a) => a.stageId === v.stages[0].id)).toBeUndefined();

    // Le chef du PREMIER département (le bon) la voit bien.
    const ownApprovals = await listMyApprovals(orgId, deptHeadId);
    expect(ownApprovals.find((a) => a.stageId === v.stages[0].id)).toBeDefined();

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
    await prisma.department.deleteMany({ where: { id: otherDept.id } });
    await prisma.accessProfile.deleteMany({ where: { userId: otherDeptHead.id } });
    await prisma.user.delete({ where: { id: otherDeptHead.id } });
  });
});
