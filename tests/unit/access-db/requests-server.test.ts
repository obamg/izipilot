import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  submitRequest,
  decideStage,
  respondToClarification,
  reviseRequest,
  cancelRequest,
  decideBatch,
  RequestError,
} from "@/lib/access/requests-server";

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
    await prisma.accessProfile.update({ where: { userId: employeeId }, data: { primaryDepartmentId: departmentId } });

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "COO", userId: cooId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Requests", requestsEnabled: true } });
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

describe("requests-server — décision d'étape", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let cooId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Decide Org", slug: `test-decide-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso, coo] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-d-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-d-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-d-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `coo-d-${Date.now()}@example.com`, name: "Coo", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;
    cooId = coo.id;

    await Promise.all(
      [employeeId, deptHeadId, cisoId, cooId].map((userId) =>
        prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } })
      )
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DD", name: "Dept Decide", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });
    await prisma.accessProfile.update({ where: { userId: employeeId }, data: { primaryDepartmentId: departmentId } });

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "COO", userId: cooId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Decide", requestsEnabled: true } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
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

  async function freshRequest() {
    return submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelReaderId,
      justification: "test décision",
    });
  }

  async function cleanup(version: { id: string; requestId: string }) {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: version.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: version.id } });
    await prisma.accessRequest.deleteMany({ where: { id: version.requestId } });
  }

  it("le chef de département approuve : passe à l'étape CISO, reste PENDING_APPROVAL", async () => {
    const v = await freshRequest();
    const deptStage = v.stages[0];
    const updated = await decideStage(orgId, deptHeadId, deptStage.id, "APPROVE", null);
    expect(updated.state).toBe("PENDING_APPROVAL");
    expect(updated.stages[0].decision).toBe("APPROVE");
    expect(updated.stages[0].actorId).toBe(deptHeadId);
    await cleanup(updated);
  });

  it("le CISO approuve la dernière étape : la demande devient READY_FOR_FULFILMENT", async () => {
    const v = await freshRequest();
    let updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    updated = await decideStage(orgId, cisoId, updated.stages[1].id, "APPROVE", null);
    expect(updated.state).toBe("READY_FOR_FULFILMENT");
    await cleanup(updated);
  });

  it("le bénéficiaire ne peut jamais décider une étape de sa propre demande", async () => {
    const v = await freshRequest();
    await expect(decideStage(orgId, employeeId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await cleanup(v);
  });

  it("un acteur ne peut pas décider deux étapes différentes de la même version", async () => {
    // deptHeadId est aussi promu CISO temporairement pour ce test précis.
    //
    // ⚠️ Écart volontaire par rapport au brief : créer un second titulaire
    // CISO via accessRoleAssignment.create (userId: deptHeadId) viole
    // l'index unique partiel `access_role_assignments_org_ciso_unique`
    // (Tâche 2 — un seul titulaire CISO par org). On obtient le même effet
    // (deptHeadId devient effectivement éligible CISO, cf. getEffectiveRoleHolders)
    // en le déclarant suppléant du titulaire CISO existant et en marquant ce
    // titulaire indisponible — ce qui respecte la contrainte tout en
    // continuant à prouver que le garde-fou "double signature" bloque même
    // un acteur par ailleurs éligible pour le second rôle.
    const existingCiso = await prisma.accessRoleAssignment.findFirst({ where: { orgId, role: "CISO" } });
    await prisma.accessRoleAssignment.update({
      where: { id: existingCiso!.id },
      data: { backupUserId: deptHeadId, primaryUnavailable: true },
    });
    const v = await freshRequest();
    const afterFirst = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    await expect(decideStage(orgId, deptHeadId, afterFirst.stages[1].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await prisma.accessRoleAssignment.update({
      where: { id: existingCiso!.id },
      data: { backupUserId: null, primaryUnavailable: false },
    });
    await cleanup(afterFirst);
  });

  it("REJECT à n'importe quelle étape termine la demande, AccessRequest supprimé", async () => {
    const v = await freshRequest();
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "REJECT", "motif de rejet");
    expect(updated.state).toBe("REJECTED");
    const requestStillExists = await prisma.accessRequest.findUnique({ where: { id: v.requestId } });
    expect(requestStillExists).toBeNull();
    // La version reste en base pour l'historique même si AccessRequest est supprimé —
    // mais la contrainte de cascade sur AccessRequestVersion.requestId la supprime aussi.
    // Rien à nettoyer de plus ici.
  });

  it("CLARIFY laisse l'étape courante, la version passe à CLARIFICATION_REQUIRED", async () => {
    const v = await freshRequest();
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez le besoin");
    expect(updated.state).toBe("CLARIFICATION_REQUIRED");
    expect(updated.stages[0].reason).toBe("précisez le besoin");
    expect(updated.stages[0].decision).toBeNull();
    await cleanup(updated);
  });

  it("RETURN passe à REVISION_REQUIRED, motif obligatoire", async () => {
    const v = await freshRequest();
    await expect(decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", null)).rejects.toThrow(RequestError);
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir la période");
    expect(updated.state).toBe("REVISION_REQUIRED");
    await cleanup(updated);
  });

  it("REJECT sans motif est refusé", async () => {
    const v = await freshRequest();
    await expect(decideStage(orgId, deptHeadId, v.stages[0].id, "REJECT", null)).rejects.toThrow(RequestError);
    await cleanup(v);
  });

  it("escalade CISO→COO ajoute une étape COO après l'approbation CISO", async () => {
    const v = await freshRequest();
    let updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    updated = await decideStage(orgId, cisoId, updated.stages[1].id, "APPROVE", "escalade motivée", true);
    expect(updated.state).toBe("PENDING_APPROVAL");
    expect(updated.stages).toHaveLength(3);
    expect(updated.stages[2].role).toBe("COO");
    expect(updated.stages[2].decision).toBeNull();
    updated = await decideStage(orgId, cooId, updated.stages[2].id, "APPROVE", null);
    expect(updated.state).toBe("READY_FOR_FULFILMENT");
    await cleanup(updated);
  });

  it("revalidation : un niveau archivé entre soumission et décision bloque la décision", async () => {
    const v = await freshRequest();
    await prisma.accessLevel.update({ where: { id: levelReaderId }, data: { archivedAt: new Date() } });
    await expect(decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await prisma.accessLevel.update({ where: { id: levelReaderId }, data: { archivedAt: null } });
    await cleanup(v);
  });

  it("escalade CISO→COO sur une RÉDUCTION ajoute COO ensuite, sans recalculer toute la route (spec §10)", async () => {
    // Une réduction routée par computeReductionRoute part avec CISO seul (jamais COO
    // automatique, même vers un niveau admin — Review Focus #4). L'escalade doit
    // ajouter une étape COO à la suite, pas remplacer/recalculer la route existante.
    await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });
    const reduction = await submitRequest(orgId, deptHeadId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: null,
      justification: "réduction à escalader",
    });
    expect(reduction.kind).toBe("REVOKE");
    expect(reduction.stages.map((s) => s.role)).toEqual(["CISO"]);

    const escalated = await decideStage(orgId, cisoId, reduction.stages[0].id, "APPROVE", "escalade motivée", true);
    expect(escalated.stages.map((s) => s.role)).toEqual(["CISO", "COO"]);
    expect(escalated.state).toBe("PENDING_APPROVAL");

    const final = await decideStage(orgId, cooId, escalated.stages[1].id, "APPROVE", null);
    expect(final.state).toBe("READY_FOR_FULFILMENT");

    await prisma.accessAssignment.deleteMany({ where: { orgId, userId: employeeId, assetId } });
    await cleanup(final);
  });

  it("une étape ne peut pas être décidée avant les étapes précédentes (ordre des séquences)", async () => {
    const v = await freshRequest();
    // v.stages[1] est CISO (séquence 2) ; le chef de département (séquence 1)
    // n'a pas encore approuvé — décider CISO en premier doit être refusé.
    await expect(decideStage(orgId, cisoId, v.stages[1].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await cleanup(v);
  });

  it("l'escalade CISO→COO exige un motif", async () => {
    const v = await freshRequest();
    const afterDeptHead = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    await expect(
      decideStage(orgId, cisoId, afterDeptHead.stages[1].id, "APPROVE", null, true)
    ).rejects.toThrow(RequestError);
    await cleanup(afterDeptHead);
  });

  it("le chef d'un AUTRE département ne peut pas décider l'étape DEPARTMENT_HEAD du bénéficiaire", async () => {
    const otherHead = await prisma.user.create({
      data: { orgId, email: `dh2-d-${Date.now()}@example.com`, name: "OtherDeptHead", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: otherHead.id, lifecycle: "ACTIVE" } });
    const otherDept = await prisma.department.create({
      data: { orgId, code: "DE", name: "Dept Autre", color: "#111111", ownerId: otherHead.id },
    });

    const v = await freshRequest();
    await expect(decideStage(orgId, otherHead.id, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    expect(updated.stages[0].decision).toBe("APPROVE");
    expect(updated.stages[0].actorId).toBe(deptHeadId);

    await cleanup(updated);
    await prisma.department.delete({ where: { id: otherDept.id } });
    await prisma.accessProfile.deleteMany({ where: { userId: otherHead.id } });
    await prisma.user.delete({ where: { id: otherHead.id } });
  });
});

describe("requests-server — clarification, révision, annulation", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;
  let levelAdminId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Clarify Org", slug: `test-clarify-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-c-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-c-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-c-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;

    await Promise.all(
      [employeeId, deptHeadId, cisoId].map((userId) =>
        prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } })
      )
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DC", name: "Dept Clarify", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });
    await prisma.accessProfile.update({ where: { userId: employeeId }, data: { primaryDepartmentId: departmentId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Clarify", requestsEnabled: true } });
    assetId = asset.id;
    const levelReader = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = levelReader.id;
    const levelAdmin = await prisma.accessLevel.create({ data: { assetId, name: "Admin", priority: 10, isAdmin: true } });
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

  async function cleanup(requestId: string) {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { requestId } } });
    await prisma.accessRequestVersion.deleteMany({ where: { requestId } });
    await prisma.accessRequest.deleteMany({ where: { id: requestId } });
  }

  it("répondre à une clarification remet la même étape à décider", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test",
    });
    const clarified = await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez");
    expect(clarified.state).toBe("CLARIFICATION_REQUIRED");
    const responded = await respondToClarification(orgId, employeeId, v.stages[0].id, "voici la précision");
    expect(responded.state).toBe("PENDING_APPROVAL");
    expect(responded.stages[0].decision).toBeNull();
    expect(responded.stages[0].clarificationResponse).toBe("voici la précision");
    await cleanup(v.requestId);
  });

  it("seul l'initiateur peut répondre à une clarification", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test",
    });
    await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez");
    await expect(respondToClarification(orgId, deptHeadId, v.stages[0].id, "réponse")).rejects.toThrow(RequestError);
    await cleanup(v.requestId);
  });

  it("une révision crée une nouvelle version, recalcule la route, invalide l'ancienne", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "initial",
    });
    const returned = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir le niveau");
    const revised = await reviseRequest(orgId, employeeId, returned.id, { targetLevelId: levelAdminId });
    expect(revised.versionNumber).toBe(2);
    expect(revised.state).toBe("PENDING_APPROVAL");
    // Le niveau cible étant admin, la route recalculée inclut COO :
    expect(revised.stages.some((s) => s.role === "COO")).toBe(true);
    const oldVersionStillExists = await prisma.accessRequestVersion.findUnique({ where: { id: returned.id } });
    expect(oldVersionStillExists?.state).toBe("REVISION_REQUIRED");
    await cleanup(v.requestId);
  });

  it("seul l'initiateur peut réviser", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "initial",
    });
    const returned = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir");
    await expect(reviseRequest(orgId, deptHeadId, returned.id, { justification: "x" })).rejects.toThrow(RequestError);
    await cleanup(v.requestId);
  });

  it("l'initiateur peut annuler tant que la demande n'est pas terminale", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "à annuler",
    });
    await cancelRequest(orgId, employeeId, v.requestId);
    const stillExists = await prisma.accessRequest.findUnique({ where: { id: v.requestId } });
    expect(stillExists).toBeNull();
  });

  it("seul l'initiateur peut annuler", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test",
    });
    await expect(cancelRequest(orgId, deptHeadId, v.requestId)).rejects.toThrow(RequestError);
    await cleanup(v.requestId);
  });
});

describe("requests-server — décisions en lot", () => {
  let orgId: string;
  let employeeAId: string;
  let employeeBId: string;
  let deptHeadId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Batch Org", slug: `test-batch-decide-${Date.now()}` },
    });
    orgId = org.id;

    const [employeeA, employeeB, deptHead] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `empa-${Date.now()}@example.com`, name: "EmployeeA", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `empb-${Date.now()}@example.com`, name: "EmployeeB", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-b-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
    ]);
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    deptHeadId = deptHead.id;

    await Promise.all(
      [employeeAId, employeeBId, deptHeadId].map((userId) =>
        prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } })
      )
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DB", name: "Dept Batch", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.createMany({
      data: [{ departmentId, userId: employeeAId }, { departmentId, userId: employeeBId }],
    });
    await prisma.accessProfile.updateMany({
      where: { userId: { in: [employeeAId, employeeBId] } },
      data: { primaryDepartmentId: departmentId },
    });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Batch", requestsEnabled: true } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("chaque item du lot a un résultat indépendant — un échec n'empêche pas les autres", async () => {
    const vA = await submitRequest(orgId, employeeAId, {
      beneficiaryId: employeeAId, assetId, targetLevelId: levelReaderId, justification: "A",
    });
    const vB = await submitRequest(orgId, employeeBId, {
      beneficiaryId: employeeBId, assetId, targetLevelId: levelReaderId, justification: "B",
    });

    const results = await decideBatch(orgId, deptHeadId, [
      { stageId: vA.stages[0].id, decision: "APPROVE", reason: null },
      { stageId: "id-inexistant", decision: "APPROVE", reason: null },
      { stageId: vB.stages[0].id, decision: "APPROVE", reason: null },
    ]);

    expect(results[0]).toEqual({ stageId: vA.stages[0].id, ok: true, error: null });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ stageId: vB.stages[0].id, ok: true, error: null });

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: { in: [vA.id, vB.id] } } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: { in: [vA.id, vB.id] } } });
    await prisma.accessRequest.deleteMany({ where: { id: { in: [vA.requestId, vB.requestId] } } });
  });
});

describe("requests-server — correctifs revue finale (révision, périmètre de réduction, département, suppléance)", () => {
  let orgId: string;
  let empAId: string;
  let empBId: string;
  let headAId: string;
  let headBId: string;
  let cisoId: string;
  let cooId: string;
  let itOpId: string;
  let multiDeptId: string;
  let noPrimaryId: string;
  let deptAId: string;
  let deptBId: string;
  let assetId: string;
  let levelReaderId: string;
  let levelAdminId: string;
  let levelDisabledId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Fix Wave Org", slug: `test-fixwave-${Date.now()}` },
    });
    orgId = org.id;

    const stamp = Date.now();
    const mk = (tag: string, name: string) =>
      prisma.user.create({ data: { orgId, email: `${tag}-fw-${stamp}@example.com`, name, role: "PO" } });
    const [empA, empB, headA, headB, ciso, coo, itOp, multi, noPrimary] = await Promise.all([
      mk("empa", "EmpA"),
      mk("empb", "EmpB"),
      mk("heada", "HeadA"),
      mk("headb", "HeadB"),
      mk("ciso", "Ciso"),
      mk("coo", "Coo"),
      mk("itop", "ItOp"),
      mk("multi", "Multi"),
      mk("noprim", "NoPrimary"),
    ]);
    empAId = empA.id;
    empBId = empB.id;
    headAId = headA.id;
    headBId = headB.id;
    cisoId = ciso.id;
    cooId = coo.id;
    itOpId = itOp.id;
    multiDeptId = multi.id;
    noPrimaryId = noPrimary.id;

    const deptA = await prisma.department.create({
      data: { orgId, code: "FWA", name: "Dept FW A", color: "#000000", ownerId: headAId },
    });
    const deptB = await prisma.department.create({
      data: { orgId, code: "FWB", name: "Dept FW B", color: "#111111", ownerId: headBId },
    });
    deptAId = deptA.id;
    deptBId = deptB.id;

    await prisma.departmentMember.createMany({
      data: [
        { departmentId: deptAId, userId: empAId },
        { departmentId: deptBId, userId: empBId },
        { departmentId: deptAId, userId: cisoId },
        // Membre des DEUX départements : A en premier, mais département
        // principal B — la résolution doit suivre primaryDepartmentId.
        { departmentId: deptAId, userId: multiDeptId },
        { departmentId: deptBId, userId: multiDeptId },
        // Membre des deux, département principal non arbitré (null).
        { departmentId: deptAId, userId: noPrimaryId },
        { departmentId: deptBId, userId: noPrimaryId },
      ],
    });

    const primaryByUser: Record<string, string | null> = {
      [empAId]: deptAId,
      [empBId]: deptBId,
      [headAId]: deptAId,
      [headBId]: deptBId,
      [cisoId]: deptAId,
      [cooId]: null,
      [itOpId]: null,
      [multiDeptId]: deptBId,
      [noPrimaryId]: null,
    };
    await prisma.accessProfile.createMany({
      data: Object.entries(primaryByUser).map(([userId, primaryDepartmentId]) => ({
        orgId,
        userId,
        primaryDepartmentId,
        lifecycle: "ACTIVE" as const,
      })),
    });

    await prisma.accessRoleAssignment.createMany({
      data: [
        { orgId, role: "CISO", userId: cisoId },
        { orgId, role: "COO", userId: cooId },
        { orgId, role: "IT_ACCESS_OPERATOR", userId: itOpId },
      ],
    });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset FW", requestsEnabled: true } });
    assetId = asset.id;
    levelReaderId = (await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } })).id;
    levelAdminId = (await prisma.accessLevel.create({ data: { assetId, name: "Admin", priority: 10, isAdmin: true } })).id;
    levelDisabledId = (
      await prisma.accessLevel.create({ data: { assetId, name: "Disabled", priority: 5, isAdmin: false, enabled: false } })
    ).id;
  });

  afterEach(async () => {
    // AccessRequest → versions → étapes : suppression en cascade.
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId, role: "DEPARTMENT_HEAD" } });
    await prisma.accessAsset.update({ where: { id: assetId }, data: { requestsEnabled: true } });
  });

  afterAll(async () => {
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  function giveAccess(userId: string, levelId: string) {
    return prisma.accessAssignment.create({ data: { orgId, userId, assetId, levelId, status: "ACTIVE" } });
  }

  // ── Fix 1 : reviseRequest reclassifie, re-route et revalide ──────────────

  it("révision d'une REVOKE vers un niveau admin : change de famille (réduction → octroi) → refusée, aucune nouvelle version", async () => {
    await giveAccess(empAId, levelReaderId);
    const revoke = await submitRequest(orgId, headAId, {
      beneficiaryId: empAId, assetId, targetLevelId: null, justification: "retrait",
    });
    expect(revoke.kind).toBe("REVOKE");
    expect(revoke.stages.map((s) => s.role)).toEqual(["CISO"]);
    const returned = await decideStage(orgId, cisoId, revoke.stages[0].id, "RETURN", "revoir");

    await expect(
      reviseRequest(orgId, headAId, returned.id, { targetLevelId: levelAdminId })
    ).rejects.toThrow(/nature de la demande/);
    expect(await prisma.accessRequestVersion.count({ where: { requestId: revoke.requestId } })).toBe(1);
  });

  it("révision d'une REVOKE vers un niveau inférieur : reclassifiée REDUCE (même famille), route recalculée", async () => {
    await giveAccess(empAId, levelAdminId);
    const revoke = await submitRequest(orgId, headAId, {
      beneficiaryId: empAId, assetId, targetLevelId: null, justification: "retrait",
    });
    expect(revoke.kind).toBe("REVOKE");
    const returned = await decideStage(orgId, cisoId, revoke.stages[0].id, "RETURN", "réduire plutôt que retirer");

    const revised = await reviseRequest(orgId, headAId, returned.id, { targetLevelId: levelReaderId });
    expect(revised.versionNumber).toBe(2);
    expect(revised.kind).toBe("REDUCE");
    expect(revised.stages.map((s) => s.role)).toEqual(["CISO"]);
  });

  it("révision d'une réduction visant le CISO titulaire : re-routée vers COO, jamais vers le CISO bénéficiaire", async () => {
    await giveAccess(cisoId, levelReaderId);
    const revoke = await submitRequest(orgId, headAId, {
      beneficiaryId: cisoId, assetId, targetLevelId: null, justification: "retrait CISO",
    });
    expect(revoke.stages.map((s) => s.role)).toEqual(["COO"]);
    const returned = await decideStage(orgId, cooId, revoke.stages[0].id, "RETURN", "motiver davantage");

    const revised = await reviseRequest(orgId, headAId, returned.id, { justification: "retrait CISO, motivé" });
    expect(revised.kind).toBe("REVOKE");
    expect(revised.stages.map((s) => s.role)).toEqual(["COO"]);
  });

  it("révision vers un niveau désactivé : refusée (contrôles catalogue réappliqués)", async () => {
    const v = await submitRequest(orgId, empAId, {
      beneficiaryId: empAId, assetId, targetLevelId: levelReaderId, justification: "besoin",
    });
    const returned = await decideStage(orgId, headAId, v.stages[0].id, "RETURN", "revoir");
    await expect(
      reviseRequest(orgId, empAId, returned.id, { targetLevelId: levelDisabledId })
    ).rejects.toThrow(/archivé ou désactivé/);
  });

  it("révision d'un octroi sur un actif fermé aux demandes entre-temps : refusée", async () => {
    const v = await submitRequest(orgId, empAId, {
      beneficiaryId: empAId, assetId, targetLevelId: levelReaderId, justification: "besoin",
    });
    const returned = await decideStage(orgId, headAId, v.stages[0].id, "RETURN", "revoir");
    await prisma.accessAsset.update({ where: { id: assetId }, data: { requestsEnabled: false } });
    await expect(
      reviseRequest(orgId, empAId, returned.id, { justification: "besoin précisé" })
    ).rejects.toThrow(/pas ouvert aux demandes/);
  });

  // ── Fix 2 : réduction scopée au département du bénéficiaire ──────────────

  it("un chef du département A ne peut PAS initier une réduction pour un employé du département B", async () => {
    await giveAccess(empBId, levelReaderId);
    await expect(
      submitRequest(orgId, headAId, { beneficiaryId: empBId, assetId, targetLevelId: null, justification: "hors périmètre" })
    ).rejects.toThrow(/propre département/);
    expect(await prisma.accessRequest.count({ where: { orgId } })).toBe(0);
  });

  it("un chef du département A PEUT initier une réduction pour un employé du département A", async () => {
    await giveAccess(empAId, levelReaderId);
    const v = await submitRequest(orgId, headAId, {
      beneficiaryId: empAId, assetId, targetLevelId: null, justification: "dans le périmètre",
    });
    expect(v.kind).toBe("REVOKE");
    expect(v.stages.map((s) => s.role)).toEqual(["CISO"]);
  });

  it("le CISO et l'opérateur IT peuvent initier une réduction pour un employé de n'importe quel département", async () => {
    await giveAccess(empBId, levelReaderId);
    const byCiso = await submitRequest(orgId, cisoId, {
      beneficiaryId: empBId, assetId, targetLevelId: null, justification: "CISO",
    });
    expect(byCiso.stages.map((s) => s.role)).toEqual(["COO"]);
    await prisma.accessRequest.deleteMany({ where: { orgId } });

    const byIt = await submitRequest(orgId, itOpId, {
      beneficiaryId: empBId, assetId, targetLevelId: null, justification: "IT",
    });
    expect(byIt.stages.map((s) => s.role)).toEqual(["CISO"]);
  });

  // ── Fix 3 : departmentSnapshot = AccessProfile.primaryDepartmentId ───────

  it("un employé membre de plusieurs départements est routé vers son département PRINCIPAL", async () => {
    const v = await submitRequest(orgId, multiDeptId, {
      beneficiaryId: multiDeptId, assetId, targetLevelId: levelReaderId, justification: "multi",
    });
    const row = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.departmentSnapshot).toBe(deptBId);
    await expect(decideStage(orgId, headAId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    const decided = await decideStage(orgId, headBId, v.stages[0].id, "APPROVE", null);
    expect(decided.stages[0].actorId).toBe(headBId);
  });

  it("département principal non arbitré : snapshot vide, aucun chef éligible (problème de routage visible)", async () => {
    const v = await submitRequest(orgId, noPrimaryId, {
      beneficiaryId: noPrimaryId, assetId, targetLevelId: levelReaderId, justification: "non arbitré",
    });
    const row = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.departmentSnapshot).toBe("");
    await expect(decideStage(orgId, headAId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await expect(decideStage(orgId, headBId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
  });

  // ── Fix 4 : actedAsPrimary scopé au département dans decideStage ─────────

  it("un chef titulaire de A agissant comme suppléant de B (chef B marqué indisponible, compte actif) décide avec actedAsPrimary=false", async () => {
    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "DEPARTMENT_HEAD", departmentId: deptBId, backupUserId: headAId, primaryUnavailable: true },
    });
    const v = await submitRequest(orgId, empBId, {
      beneficiaryId: empBId, assetId, targetLevelId: levelReaderId, justification: "suppléance",
    });
    // Le titulaire B, marqué indisponible, n'est plus éligible.
    await expect(decideStage(orgId, headBId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);

    const decided = await decideStage(orgId, headAId, v.stages[0].id, "APPROVE", null);
    expect(decided.stages[0].actorId).toBe(headAId);
    const stageRow = await prisma.accessApprovalStage.findUniqueOrThrow({ where: { id: v.stages[0].id } });
    expect(stageRow.actedAsPrimary).toBe(false);
  });
});
