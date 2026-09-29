// lib/access/register-server.ts
// Service de lecture du registre (phase 2b). Les portées sont recalculées
// depuis la base à chaque appel — jamais reçues du client. Toute vue non
// couverte lève RegisterNotFoundError (404 côté API, notFound() côté page).
import type {
  AccessAssignmentSource,
  AccessAssignmentStatus,
  AccessLifecycle,
  AccessVerification,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "./roles-server";
import { resolveReadScopes, type ReadScope } from "./scope";
import {
  authorizeView,
  buildAssignmentQuery,
  orderByForView,
  registerNavFlags,
  type RegisterFilters,
  type RegisterView,
} from "./register";

export class RegisterNotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "RegisterNotFoundError";
  }
}

export interface AssignmentRowDTO {
  id: string;
  userId: string;
  userName: string;
  departmentName: string | null;
  lifecycle: AccessLifecycle | null;
  assetId: string;
  assetName: string;
  assetArchived: boolean;
  levelName: string | null;
  status: AccessAssignmentStatus;
  verification: AccessVerification | null;
  source: AccessAssignmentSource;
  periodStart: string | null;
  periodEnd: string | null;
}

export async function getOwnedAssetIds(orgId: string, userId: string): Promise<string[]> {
  const assets = await prisma.accessAsset.findMany({
    where: { orgId, archivedAt: null, OR: [{ ownerId: userId }, { backupOwnerId: userId }] },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return assets.map((a) => a.id);
}

export async function getViewerScopes(orgId: string, userId: string): Promise<ReadScope[]> {
  const [roles, ownedAssetIds] = await Promise.all([
    getEffectiveRoleHolders(orgId, userId),
    getOwnedAssetIds(orgId, userId),
  ]);
  return resolveReadScopes(userId, roles, ownedAssetIds);
}

export async function listAssignments(input: {
  viewer: { userId: string; orgId: string };
  view: RegisterView;
  filters: RegisterFilters;
  pagination: { page: number; pageSize: number };
}): Promise<{ rows: AssignmentRowDTO[]; total: number }> {
  const { viewer, view, filters, pagination } = input;

  const scopes = await getViewerScopes(viewer.orgId, viewer.userId);
  const scope = authorizeView(view, scopes);
  if (!scope) throw new RegisterNotFoundError();

  // ALL couvre « n'importe quel département » : sans cette vérification, un
  // departmentId d'une autre organisation renverrait une liste vide en 200
  // au lieu d'une 404 (spec §6).
  if (view.kind === "DEPARTMENT" && view.departmentId !== "ALL") {
    const dept = await prisma.department.findFirst({
      where: { id: view.departmentId, orgId: viewer.orgId },
      select: { id: true },
    });
    if (!dept) throw new RegisterNotFoundError();
  }

  const where = buildAssignmentQuery(viewer.orgId, scope, filters);
  const [total, rows] = await prisma.$transaction([
    prisma.accessAssignment.count({ where }),
    prisma.accessAssignment.findMany({
      where,
      orderBy: orderByForView(view),
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        status: true,
        verification: true,
        source: true,
        periodStart: true,
        periodEnd: true,
        user: {
          select: {
            id: true,
            name: true,
            accessProfile: {
              select: { lifecycle: true, primaryDepartment: { select: { name: true } } },
            },
          },
        },
        asset: { select: { id: true, name: true, archivedAt: true } },
        level: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.name,
      departmentName: r.user.accessProfile?.primaryDepartment?.name ?? null,
      lifecycle: r.user.accessProfile?.lifecycle ?? null,
      assetId: r.asset.id,
      assetName: r.asset.name,
      assetArchived: r.asset.archivedAt !== null,
      levelName: r.level?.name ?? null,
      status: r.status,
      verification: r.verification,
      source: r.source,
      periodStart: r.periodStart?.toISOString() ?? null,
      periodEnd: r.periodEnd?.toISOString() ?? null,
    })),
  };
}

export interface RegisterNav {
  hasDepartmentView: boolean;
  hasOwnedAssetsView: boolean;
  canSeeAll: boolean;
  /** Département affiché par défaut : le sien d'abord, sinon « Toutes ». */
  defaultDepartmentId: string | null;
  departments: { id: string; name: string }[];
  ownedAssets: { id: string; name: string; levels: { id: string; name: string }[] }[];
}

export async function getRegisterNav(orgId: string, userId: string): Promise<RegisterNav> {
  const scopes = await getViewerScopes(orgId, userId);
  const flags = registerNavFlags(scopes);
  const ownDepartmentIds = scopes.flatMap((s) => (s.kind === "DEPARTMENT" ? [s.departmentId] : []));
  const ownedAssetIds = scopes.flatMap((s) => (s.kind === "OWNED_ASSETS" ? s.assetIds : []));

  const [departments, ownedAssets] = await Promise.all([
    flags.hasDepartmentView
      ? prisma.department.findMany({
          where: { orgId, ...(flags.canSeeAll ? {} : { id: { in: ownDepartmentIds } }) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    ownedAssetIds.length
      ? prisma.accessAsset.findMany({
          where: { orgId, id: { in: ownedAssetIds } },
          select: {
            id: true,
            name: true,
            levels: {
              where: { archivedAt: null },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return {
    ...flags,
    defaultDepartmentId: ownDepartmentIds[0] ?? (flags.canSeeAll ? "ALL" : null),
    departments,
    ownedAssets,
  };
}

/** Options du filtre « application » de la vue département (catalogue non archivé). */
export async function listAssetOptions(orgId: string): Promise<{ id: string; name: string }[]> {
  return prisma.accessAsset.findMany({
    where: { orgId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
