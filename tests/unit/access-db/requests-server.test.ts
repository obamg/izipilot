import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  submitRequest,
  decideStage,
  respondToClarification,
  reviseRequest,
  cancelRequest,
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

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "COO", userId: cooId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Decide" } });
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
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Clarify" } });
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
