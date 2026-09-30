// tests/unit/access-db/fulfilment-fixtures.ts
// Jeu de données partagé par les tests base réelle de la phase 3b
// (fulfilment-server, access-processor, routes). Pas un fichier *.test.ts :
// vitest ne l'exécute pas seul.
import { prisma } from "@/lib/prisma";
import { submitRequest, decideStage, type RequestVersionDTO } from "@/lib/access/requests-server";

export interface FulfilmentFixture {
  orgId: string;
  departmentId: string;
  assetId: string;
  levels: { reader: string; editor: string };
  users: {
    owner: string;
    backup: string;
    stranger: string;
    employee: string;
    deptHead: string;
    ciso: string;
    coo: string;
  };
  stamp: string;
}

export async function createFulfilmentFixture(tag: string): Promise<FulfilmentFixture> {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const org = await prisma.organization.create({ data: { name: `Test Exécution ${tag}`, slug: `test-fulfil-${stamp}` } });
  const orgId = org.id;
  const mk = async (label: string) =>
    (await prisma.user.create({ data: { orgId, email: `${label.toLowerCase()}-${stamp}@example.com`, name: label, role: "PO" } })).id;
  const users = {
    owner: await mk("Owner"),
    backup: await mk("Backup"),
    stranger: await mk("Stranger"),
    employee: await mk("Employee"),
    deptHead: await mk("DeptHead"),
    ciso: await mk("Ciso"),
    coo: await mk("Coo"),
  };
  const dept = await prisma.department.create({
    data: { orgId, code: "DF", name: `Dept ${tag}`, color: "#000000", ownerId: users.deptHead },
  });
  await prisma.accessProfile.createMany({
    data: Object.values(users).map((userId) => ({
      orgId,
      userId,
      lifecycle: "ACTIVE" as const,
      primaryDepartmentId: userId === users.employee ? dept.id : null,
    })),
  });
  await prisma.accessRoleAssignment.createMany({
    data: [
      { orgId, role: "CISO", userId: users.ciso },
      { orgId, role: "COO", userId: users.coo },
    ],
  });
  const asset = await prisma.accessAsset.create({
    data: { orgId, name: `Asset ${tag}`, requestsEnabled: true, ownerId: users.owner, backupOwnerId: users.backup },
  });
  const reader = await prisma.accessLevel.create({ data: { assetId: asset.id, name: "Reader", priority: 1, isAdmin: false } });
  const editor = await prisma.accessLevel.create({ data: { assetId: asset.id, name: "Editor", priority: 5, isAdmin: false } });
  return {
    orgId,
    departmentId: dept.id,
    assetId: asset.id,
    levels: { reader: reader.id, editor: editor.id },
    users,
    stamp,
  };
}

/** Nouvel employé ACTIF du département de la fixture (un couple employé/actif libre). */
export async function newEmployee(fx: FulfilmentFixture, label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { orgId: fx.orgId, email: `${label.toLowerCase()}-${fx.stamp}-${Math.random().toString(36).slice(2, 7)}@example.com`, name: label, role: "PO" },
  });
  await prisma.accessProfile.create({
    data: { orgId: fx.orgId, userId: user.id, lifecycle: "ACTIVE", primaryDepartmentId: fx.departmentId },
  });
  return user.id;
}

export function giveAccess(
  fx: FulfilmentFixture,
  userId: string,
  levelId: string,
  opts: { periodEnd?: Date | null; assetId?: string } = {}
) {
  return prisma.accessAssignment.create({
    data: {
      orgId: fx.orgId,
      userId,
      assetId: opts.assetId ?? fx.assetId,
      levelId,
      status: "ACTIVE",
      periodStart: new Date(Date.now() - 30 * 86_400_000),
      periodEnd: opts.periodEnd ?? null,
    },
  });
}

/** Octroi/montée/renouvellement soumis par le bénéficiaire, approuvé chef → CISO. */
export async function approvedSelfRequest(
  fx: FulfilmentFixture,
  beneficiaryId: string,
  levelId: string,
  opts: { periodEnd?: Date | null; periodStart?: Date } = {}
): Promise<RequestVersionDTO> {
  const v = await submitRequest(fx.orgId, beneficiaryId, {
    beneficiaryId,
    assetId: fx.assetId,
    targetLevelId: levelId,
    justification: "besoin métier",
    periodEnd: opts.periodEnd ?? null,
    ...(opts.periodStart ? { periodStart: opts.periodStart } : {}),
  });
  const afterHead = await decideStage(fx.orgId, fx.users.deptHead, v.stages[0].id, "APPROVE", null);
  return decideStage(fx.orgId, fx.users.ciso, afterHead.stages[1].id, "APPROVE", null);
}

/** Réduction/révocation initiée par le chef de département, approuvée par le CISO. */
export async function approvedReduction(
  fx: FulfilmentFixture,
  beneficiaryId: string,
  targetLevelId: string | null
): Promise<RequestVersionDTO> {
  const v = await submitRequest(fx.orgId, fx.users.deptHead, {
    beneficiaryId,
    assetId: fx.assetId,
    targetLevelId,
    justification: "réduction décidée",
  });
  return decideStage(fx.orgId, fx.users.ciso, v.stages[0].id, "APPROVE", null);
}

export function taskForVersion(versionId: string) {
  return prisma.accessFulfilmentTask.findFirstOrThrow({ where: { requestVersionId: versionId } });
}

export function currentAssignment(fx: FulfilmentFixture, userId: string, assetId = fx.assetId) {
  return prisma.accessAssignment.findFirst({ where: { orgId: fx.orgId, userId, assetId } });
}

export async function cleanupFulfilmentFixture(orgId: string): Promise<void> {
  await prisma.accessTaskEvent.deleteMany({ where: { orgId } });
  await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });
  await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
  await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
  await prisma.accessRequest.deleteMany({ where: { orgId } });
  await prisma.accessAssignmentEvent.deleteMany({ where: { orgId } });
  await prisma.accessAssignment.deleteMany({ where: { orgId } });
  await prisma.accessAuditEvent.deleteMany({ where: { orgId } });
  await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
  await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
  await prisma.accessAsset.deleteMany({ where: { orgId } });
  await prisma.accessProfile.deleteMany({ where: { orgId } });
  await prisma.department.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}
