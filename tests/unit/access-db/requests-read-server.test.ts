import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { submitRequest, decideStage, respondToClarification } from "@/lib/access/requests-server";
import { setDepartmentHeadBackup } from "@/lib/access/roles-server";
import { listMyRequests, listMyApprovals, listDepartmentReducibleAccess } from "@/lib/access/requests-read-server";
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

describe("requests-read-server", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Read Org", slug: `test-read-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-r-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-r-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-r-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;
    await Promise.all(
      [employeeId, deptHeadId, cisoId].map((userId) => prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } }))
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DRD", name: "Dept Read", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });
    await prisma.accessProfile.update({ where: { userId: employeeId }, data: { primaryDepartmentId: departmentId } });

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Read", requestsEnabled: true } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
  });

  afterAll(async () => {
    await prisma.accessTaskEvent.deleteMany({ where: { orgId } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
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
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test lecture", periodEnd,
    });
    const mine = await listMyRequests(orgId, employeeId);
    expect(mine).toHaveLength(1);
    expect(mine[0].assetName).toBe("Asset Read");
    expect(mine[0].targetLevelName).toBe("Reader");
    expect(mine[0].beneficiaryName).toBe("Employee");
    expect(mine[0].pendingClarificationStageId).toBeNull();
    // Gap 1 : justification/période exposées, aucun motif d'étape bloquante
    // tant que la demande est simplement PENDING_APPROVAL.
    expect(mine[0].justification).toBe("test lecture");
    expect(mine[0].periodStart).toBeInstanceOf(Date);
    expect(mine[0].periodEnd?.getTime()).toBe(periodEnd.getTime());
    expect(mine[0].currentStageReason).toBeNull();

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyRequests renvoie l'id de l'étape en attente de clarification et son motif (Gap 1 : currentStageReason)", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test clarif",
    });
    await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez le besoin");
    const mine = await listMyRequests(orgId, employeeId);
    expect(mine[0].pendingClarificationStageId).toBe(v.stages[0].id);
    expect(mine[0].currentStageReason).toBe("précisez le besoin");
    expect(mine[0].justification).toBe("test clarif");
    expect(mine[0].periodEnd).toBeNull();

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyRequests renvoie le motif de retour pour une demande REVISION_REQUIRED (Gap 1 : currentStageReason)", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test retour",
    });
    const returned = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir la période demandée");
    expect(returned.state).toBe("REVISION_REQUIRED");

    const mine = await listMyRequests(orgId, employeeId);
    expect(mine[0].state).toBe("REVISION_REQUIRED");
    expect(mine[0].currentStageReason).toBe("revoir la période demandée");
    expect(mine[0].pendingClarificationStageId).toBeNull();

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
    // Gap 1 : les mêmes champs justification/période sont exposés côté
    // approbateur ; aucun motif d'étape bloquante pour une étape PENDING_APPROVAL.
    expect(pending[0].justification).toBe("test approbation");
    expect(pending[0].periodStart).toBeInstanceOf(Date);
    expect(pending[0].currentStageReason).toBeNull();

    const decided = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    const afterDecision = await listMyApprovals(orgId, deptHeadId);
    expect(afterDecision).toHaveLength(0);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: decided.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: decided.id } });
    await prisma.accessRequest.deleteMany({ where: { id: decided.requestId } });
  });

  it("listMyApprovals (Gap 2 — ordre des étapes) : le CISO ne voit pas l'étape tant que le chef de département n'a pas approuvé, puis la voit ensuite", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test ordre des étapes",
    });
    expect(v.stages.map((s) => s.role)).toEqual(["DEPARTMENT_HEAD", "CISO"]);
    const cisoStageId = v.stages[1].id;

    // Avant l'approbation du chef de département : le CISO est éligible au
    // rôle mais l'étape n'est pas encore décidable (ordre des séquences) —
    // elle ne doit donc pas apparaître dans sa liste.
    const beforeApproval = await listMyApprovals(orgId, cisoId);
    expect(beforeApproval.find((a) => a.stageId === cisoStageId)).toBeUndefined();

    const afterDeptHeadApproval = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);

    // Après approbation du chef de département : l'étape CISO devient décidable.
    const afterApproval = await listMyApprovals(orgId, cisoId);
    const found = afterApproval.find((a) => a.stageId === cisoStageId);
    expect(found).toBeDefined();
    expect(found?.stageRole).toBe("CISO");

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: afterDeptHeadApproval.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: afterDeptHeadApproval.id } });
    await prisma.accessRequest.deleteMany({ where: { id: afterDeptHeadApproval.requestId } });
  });

  it("listMyApprovals (Gap 2 — indépendance) : un acteur ayant déjà décidé une étape de la version n'en voit pas une seconde (suppléance CISO)", async () => {
    // Même mécanisme que le test « double signature » de decideStage (Tâche 5) :
    // deptHeadId devient suppléant du titulaire CISO (le titulaire indisponible),
    // ce qui le rend effectivement éligible CISO SANS violer l'index unique
    // partiel sur le titulaire CISO par org.
    const existingCiso = await prisma.accessRoleAssignment.findFirstOrThrow({ where: { orgId, role: "CISO" } });
    await prisma.accessRoleAssignment.update({
      where: { id: existingCiso.id },
      data: { backupUserId: deptHeadId, primaryUnavailable: true },
    });

    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test indépendance suppléance",
    });
    expect(v.stages.map((s) => s.role)).toEqual(["DEPARTMENT_HEAD", "CISO"]);

    const afterFirst = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    const cisoStageId = afterFirst.stages[1].id;

    // deptHeadId est effectivement éligible CISO (suppléant du titulaire
    // indisponible) mais a déjà décidé la première étape de cette même
    // version : la seconde ne doit pas apparaître dans sa liste.
    const approvals = await listMyApprovals(orgId, deptHeadId);
    expect(approvals.find((a) => a.stageId === cisoStageId)).toBeUndefined();

    await prisma.accessRoleAssignment.update({
      where: { id: existingCiso.id },
      data: { backupUserId: null, primaryUnavailable: false },
    });
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: afterFirst.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: afterFirst.id } });
    await prisma.accessRequest.deleteMany({ where: { id: afterFirst.requestId } });
  });

  it("listMyApprovals (Gap 1 correctif) : expose la question et la réponse de clarification sur l'étape en cours de redécision, même revenue à PENDING_APPROVAL", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test clarif + redécision",
    });
    const deptStageId = v.stages[0].id;

    await decideStage(orgId, deptHeadId, deptStageId, "CLARIFY", "précisez le besoin exact");
    await respondToClarification(orgId, employeeId, deptStageId, "voici ma réponse détaillée");

    // La version est repassée à PENDING_APPROVAL (respondToClarification) —
    // `currentStageReason` (dérivé de l'état de la version) est donc `null`
    // ici, mais l'étape elle-même porte toujours sa question et sa réponse :
    // c'est justement le moment où l'approbateur qui redécide en a besoin.
    const approvals = await listMyApprovals(orgId, deptHeadId);
    const stage = approvals.find((a) => a.stageId === deptStageId);
    expect(stage).toBeDefined();
    expect(stage?.currentStageReason).toBeNull();
    expect(stage?.stageReason).toBe("précisez le besoin exact");
    expect(stage?.stageClarificationResponse).toBe("voici ma réponse détaillée");

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
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

  it("listDepartmentReducibleAccess (gap primaryDepartmentId) : un DepartmentMember du département dont le primaryDepartmentId pointe ailleurs n'apparaît pas", async () => {
    // Second département, distinct de `departmentId`, qui sera le
    // `primaryDepartmentId` AUTORITAIRE de l'employé multi-appartenance.
    const otherDeptHead = await prisma.user.create({
      data: { orgId, email: `dh3-r-${Date.now()}@example.com`, name: "DeptHead3", role: "PO" },
    });
    const otherDept = await prisma.department.create({
      data: { orgId, code: "DRD3", name: "Dept Read 3", color: "#222222", ownerId: otherDeptHead.id },
    });

    // Employé membre (DepartmentMember) de `departmentId` — le département
    // testé — mais dont le `primaryDepartmentId` (source AUTORITAIRE, celle
    // utilisée par `submitRequest`/`canInitiateDepartmentReduction`) pointe
    // vers `otherDept`. Reproduit exactement le cas d'appartenance multiple
    // non arbitrée décrit dans le gap : membre de A, mais rattaché à B.
    const multiMember = await prisma.user.create({
      data: { orgId, email: `multi-r-${Date.now()}@example.com`, name: "MultiMember", role: "PO" },
    });
    await prisma.accessProfile.create({
      data: { orgId, userId: multiMember.id, lifecycle: "ACTIVE", primaryDepartmentId: otherDept.id },
    });
    await prisma.departmentMember.create({ data: { departmentId, userId: multiMember.id } });

    const assignment = await prisma.accessAssignment.create({
      data: { orgId, userId: multiMember.id, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });

    // Avant le correctif, cette requête se basait sur `DepartmentMember` et
    // aurait listé `multiMember` ici — alors que `submitRequest` (branche
    // réduction) l'aurait rejeté car son `primaryDepartmentId` n'est pas
    // `departmentId`. Régression : ne doit plus apparaître.
    const reducibleForQueriedDept = await listDepartmentReducibleAccess(orgId, departmentId);
    expect(reducibleForQueriedDept.find((r) => r.userId === multiMember.id)).toBeUndefined();

    // Contrôle positif : il apparaît bien dans la liste de SON
    // `primaryDepartmentId` (otherDept), preuve que la résolution suit bien
    // `AccessProfile.primaryDepartmentId` et pas juste un filtre trop strict.
    const reducibleForPrimaryDept = await listDepartmentReducibleAccess(orgId, otherDept.id);
    expect(reducibleForPrimaryDept.find((r) => r.userId === multiMember.id)).toBeDefined();

    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
    await prisma.departmentMember.deleteMany({ where: { userId: multiMember.id } });
    await prisma.accessProfile.deleteMany({ where: { userId: multiMember.id } });
    await prisma.user.delete({ where: { id: multiMember.id } });
    await prisma.department.deleteMany({ where: { id: otherDept.id } });
    await prisma.user.delete({ where: { id: otherDeptHead.id } });
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
    // Depuis le correctif revue finale, primaryUnavailable=true suffit (OU
    // logique, comme pour les autres rôles) — voir le test suivant, qui
    // couvre le cas réel sans toucher au compte du titulaire. Ce test-ci
    // désactive EN PLUS le compte du titulaire : il reste vrai sous la
    // nouvelle règle (l'OU est un sur-ensemble de l'ancien ET).
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

  it("chef de département marqué indisponible (congé) avec compte ACTIF : le suppléant prend le relais, le titulaire ne voit plus l'étape", async () => {
    const backup = await prisma.user.create({
      data: { orgId, email: `backup-r2-${Date.now()}@example.com`, name: "Backup2", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: backup.id, lifecycle: "ACTIVE" } });

    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test congé",
    });
    const deptStageId = v.stages[0].id;
    expect(await listMyApprovals(orgId, deptHeadId)).toHaveLength(1);

    await setDepartmentHeadBackup(orgId, departmentId, backup.id, deptHeadId);
    const assignment = await prisma.accessRoleAssignment.findFirstOrThrow({
      where: { orgId, role: "DEPARTMENT_HEAD", departmentId },
    });
    await prisma.accessRoleAssignment.update({ where: { id: assignment.id }, data: { primaryUnavailable: true } });

    // Le compte du titulaire reste pleinement actif — seul le drapeau change.
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: deptHeadId } });
    expect(owner.isActive).toBe(true);

    expect(await listMyApprovals(orgId, deptHeadId)).toHaveLength(0);
    const backupApprovals = await listMyApprovals(orgId, backup.id);
    expect(backupApprovals).toHaveLength(1);
    expect(backupApprovals[0].stageId).toBe(deptStageId);
    expect(backupApprovals[0].actedAsPrimary).toBe(false);

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


describe("requests-read-server — historique et suivi d'exécution (phase 3b)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("read3b");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("listMyRequests montre l'historique (rejetées comprises), plus récentes d'abord, sans les demandes initiées par d'autres", async () => {
    const emp = await newEmployee(fx, "Hist");
    const first = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "première",
    });
    await decideStage(fx.orgId, fx.users.deptHead, first.stages[0].id, "REJECT", "non");
    const second = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "seconde",
    });

    const mine = await listMyRequests(fx.orgId, emp);
    expect(mine.map((r) => r.versionId)).toEqual([second.id, first.id]);
    expect(mine[1]).toMatchObject({ state: "REJECTED", closed: true, taskState: null });
    expect(mine[0]).toMatchObject({ state: "PENDING_APPROVAL", closed: false });
    // Le chef de département n'a initié aucune de ces demandes.
    expect(await listMyRequests(fx.orgId, fx.users.deptHead)).toHaveLength(0);
  });

  it("une demande bloquée expose l'état de la tâche et le motif de blocage, jamais les faits internes", async () => {
    const emp = await newEmployee(fx, "Blocked");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { state: "BLOCKED" } });
    await prisma.accessFulfilmentTask.update({
      where: { id: task.id },
      data: { state: "BLOCKED", claimantId: fx.users.owner, blockedReason: "Compte fournisseur verrouillé" },
    });
    await prisma.accessTaskEvent.create({
      data: { orgId: fx.orgId, taskId: task.id, type: "BLOCKED", reason: "Compte fournisseur verrouillé", facts: { note: "mot de passe admin expiré" } },
    });

    const [row] = await listMyRequests(fx.orgId, emp);
    expect(row).toMatchObject({ state: "BLOCKED", taskState: "BLOCKED", taskReason: "Compte fournisseur verrouillé", closed: false });
    expect(JSON.stringify(row)).not.toContain("mot de passe admin expiré");
  });

  it("renvoi en révision par le processeur : le motif de la tâche annulée sert de motif de révision", async () => {
    const emp = await newEmployee(fx, "Overdue");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { state: "REVISION_REQUIRED" } });
    await prisma.accessFulfilmentTask.update({ where: { id: task.id }, data: { state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT" } });
    await prisma.accessTaskEvent.create({
      data: { orgId: fx.orgId, taskId: task.id, type: "CANCELLED", reason: "Fin de période dépassée avant exécution", actingAs: "SYSTEM" },
    });

    const [row] = await listMyRequests(fx.orgId, emp);
    expect(row).toMatchObject({
      state: "REVISION_REQUIRED",
      currentStageReason: "Fin de période dépassée avant exécution",
      taskState: "CANCELLED",
      closed: false,
    });
  });
});
