// lib/access/fulfilment-read-server.ts
// Lecture des tâches d'exécution (phase 3b, D-6, D-14, D-15). Portée
// recalculée en base à chaque appel, filtrée AVANT pagination et totaux
// (FP:98). Hors portée → FulfilmentError NOT_FOUND (404), jamais une liste
// vide qui laisserait deviner l'existence de tâches.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAvailable } from "./roles";
import { getEffectiveRoleHolders } from "./roles-server";
import { getOwnedAssetIds } from "./register-server";
import { resolveReadScopes } from "./scope";
import {
  CLOSED_TASK_STATES,
  EXPIRY_OWNER_REASON,
  OPEN_TASK_STATES,
  fulfilmentNavFlags,
  ownerRoleFor,
  readOldRemovedAt,
  shortTaskReference,
  type OwnerRole,
  type TaskAction,
  type TaskState,
} from "./fulfilment";
import { FulfilmentError, getFulfilmentAssetIds, revalidateTask } from "./fulfilment-server";

export interface TaskEventDTO {
  type: string;
  actorName: string | null;
  actingAs: string | null;
  toUserName: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface ApprovalSummaryItem {
  role: string;
  decision: string;
  decidedAt: string | null;
}

export interface ViewerActions {
  claim: boolean;
  complete: boolean;
  block: boolean;
  resume: boolean;
  handover: boolean;
  reconcile: boolean;
}

/**
 * DTO propriétaire (D-6, D-16) : uniquement du travail AUTORISÉ, jamais une
 * version en attente/rejetée ni un compte de celles-ci (A05, FP:255). Aucun
 * motif interne d'approbation (résumé = rôle, décision, date), aucun fait
 * interne de blocage (seul le motif). `ownerReason` est le seul texte de
 * justification exposé. Dates en chaîne ISO (frontière Server → Client).
 */
export interface FulfilmentTaskDTO {
  id: string;
  reference: string;
  revision: number;
  state: TaskState;
  action: TaskAction;
  assetId: string;
  assetName: string;
  assetArchived: boolean;
  hasOwner: boolean;
  beneficiaryId: string;
  beneficiaryName: string;
  departmentName: string | null;
  fromLevelName: string | null;
  toLevelName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  releasedAt: string;
  approvalSummary: ApprovalSummaryItem[];
  approvalException: string | null;
  ownerReason: string;
  claimantId: string | null;
  claimantName: string | null;
  blockedReason: string | null;
  oldRemovedAt: string | null;
  cancelRequested: boolean;
  staleReason: string | null;
  completedAt: string | null;
  completionReference: string | null;
  completionNote: string | null;
  completionMethod: string | null;
  outcome: string | null;
  events: TaskEventDTO[];
  viewerRole: OwnerRole | null;
  viewerCan: ViewerActions;
  handoverCandidates: { id: string; name: string }[];
}

export interface FulfilmentNav {
  hasMine: boolean;
  canOversee: boolean;
}

export async function getFulfilmentNav(orgId: string, userId: string): Promise<FulfilmentNav> {
  const [roles, ownedAssetIds, fulfilmentAssetIds] = await Promise.all([
    getEffectiveRoleHolders(orgId, userId),
    getOwnedAssetIds(orgId, userId),
    getFulfilmentAssetIds(prisma, orgId, userId),
  ]);
  const flags = fulfilmentNavFlags(resolveReadScopes(userId, roles, ownedAssetIds), fulfilmentAssetIds);
  return { hasMine: flags.hasMineView, canOversee: flags.canOversee };
}

export interface TaskListQuery {
  view: "mine" | "oversight";
  state: "open" | "history";
  assetId?: string;
  page: number;
  pageSize: number;
}

const LIST_INCLUDE = {
  asset: {
    select: { id: true, name: true, ownerId: true, backupOwnerId: true, archivedAt: true, catalogueVersion: true },
  },
  requestVersion: { include: { stages: { orderBy: { sequence: "asc" } } } },
  events: { orderBy: { occurredAt: "asc" } },
} satisfies Prisma.AccessFulfilmentTaskInclude;

const NO_ACTIONS: ViewerActions = {
  claim: false,
  complete: false,
  block: false,
  resume: false,
  handover: false,
  reconcile: false,
};

const NOT_FOUND = () => new FulfilmentError("NOT_FOUND", "Introuvable");

export async function listFulfilmentTasks(
  viewer: { orgId: string; userId: string },
  query: TaskListQuery,
  now: Date = new Date()
): Promise<{ rows: FulfilmentTaskDTO[]; total: number }> {
  const { orgId, userId } = viewer;

  let scope: Prisma.AccessFulfilmentTaskWhereInput;
  if (query.view === "mine") {
    const assetIds = await getFulfilmentAssetIds(prisma, orgId, userId);
    if (assetIds.length === 0) throw NOT_FOUND();
    if (query.assetId && !assetIds.includes(query.assetId)) throw NOT_FOUND();
    scope = { assetId: { in: query.assetId ? [query.assetId] : assetIds } };
  } else {
    const roles = await getEffectiveRoleHolders(orgId, userId);
    if (!resolveReadScopes(userId, roles, []).some((s) => s.kind === "ALL")) throw NOT_FOUND();
    scope = query.assetId ? { assetId: query.assetId } : {};
  }

  const states = query.state === "open" ? [...OPEN_TASK_STATES] : [...CLOSED_TASK_STATES];
  const where: Prisma.AccessFulfilmentTaskWhereInput = { orgId, AND: [scope, { state: { in: states } }] };
  const orderBy: Prisma.AccessFulfilmentTaskOrderByWithRelationInput[] =
    query.state === "open" ? [{ releasedAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }];

  const [total, tasks] = await prisma.$transaction([
    prisma.accessFulfilmentTask.count({ where }),
    prisma.accessFulfilmentTask.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: LIST_INCLUDE,
    }),
  ]);

  const userIds = new Set<string>();
  const levelIds = new Set<string>();
  for (const t of tasks) {
    userIds.add(t.beneficiaryId);
    for (const id of [t.claimantId, t.asset.ownerId, t.asset.backupOwnerId]) if (id) userIds.add(id);
    for (const e of t.events) {
      if (e.actorId) userIds.add(e.actorId);
      if (e.toUserId) userIds.add(e.toUserId);
    }
    for (const id of [t.fromLevelId, t.toLevelId]) if (id) levelIds.add(id);
  }
  const [users, levels] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, id: { in: [...userIds] } },
      select: {
        id: true,
        name: true,
        isActive: true,
        accessProfile: { select: { lifecycle: true, primaryDepartment: { select: { name: true } } } },
      },
    }),
    prisma.accessLevel.findMany({ where: { id: { in: [...levelIds] } }, select: { id: true, name: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const levelNameById = new Map(levels.map((l) => [l.id, l.name]));
  const nameOf = (id: string | null) => (id ? userById.get(id)?.name ?? null : null);
  const available = (id: string) => {
    const u = userById.get(id);
    return !!u && isAvailable({ userId: id, isActive: u.isActive, lifecycle: u.accessProfile?.lifecycle ?? null });
  };

  const rows = await Promise.all(
    tasks.map(async (t): Promise<FulfilmentTaskDTO> => {
      const open = t.state === "READY" || t.state === "CLAIMED" || t.state === "BLOCKED";
      const staleReason = open ? await revalidateTask(prisma, t, now) : null;
      const oldRemovedAt = readOldRemovedAt(t.progress);
      const cancelRequested = t.requestVersion?.cancelRequestedAt != null;
      const viewerRole = query.view === "mine" ? ownerRoleFor(t.asset, userId) : null;
      const handoverCandidates = [t.asset.ownerId, t.asset.backupOwnerId]
        .filter((id): id is string => id !== null && id !== t.claimantId && available(id))
        .map((id) => ({ id, name: nameOf(id) ?? "?" }));
      const isClaimant = t.claimantId === userId;
      // Confort d'affichage seulement : chaque service revérifie tout.
      const viewerCan: ViewerActions = viewerRole
        ? {
            claim: t.state === "READY" && staleReason === null,
            complete: t.state === "CLAIMED" && isClaimant,
            block: t.state === "CLAIMED" && isClaimant,
            resume: t.state === "BLOCKED",
            handover: (t.state === "CLAIMED" || t.state === "BLOCKED") && handoverCandidates.length > 0,
            reconcile:
              (t.state === "CLAIMED" || t.state === "BLOCKED") &&
              isClaimant &&
              (cancelRequested || staleReason !== null),
          }
        : NO_ACTIONS;
      const beneficiary = userById.get(t.beneficiaryId);
      return {
        id: t.id,
        reference: shortTaskReference(t.id),
        revision: t.revision,
        state: t.state,
        action: t.action,
        assetId: t.assetId,
        assetName: t.asset.name,
        assetArchived: t.asset.archivedAt !== null,
        hasOwner: t.asset.ownerId !== null || t.asset.backupOwnerId !== null,
        beneficiaryId: t.beneficiaryId,
        beneficiaryName: beneficiary?.name ?? "?",
        departmentName: beneficiary?.accessProfile?.primaryDepartment?.name ?? null,
        fromLevelName: t.fromLevelId ? levelNameById.get(t.fromLevelId) ?? "?" : null,
        toLevelName: t.toLevelId ? levelNameById.get(t.toLevelId) ?? "?" : null,
        periodStart: t.periodStart?.toISOString() ?? null,
        periodEnd: t.periodEnd?.toISOString() ?? null,
        releasedAt: t.releasedAt.toISOString(),
        approvalSummary: (t.requestVersion?.stages ?? [])
          .filter((s) => s.decision !== null)
          .map((s) => ({ role: s.role, decision: s.decision as string, decidedAt: s.decidedAt?.toISOString() ?? null })),
        approvalException: t.requestVersion?.exceptionReason ?? null,
        ownerReason: t.requestVersion ? t.requestVersion.justification : EXPIRY_OWNER_REASON,
        claimantId: t.claimantId,
        claimantName: nameOf(t.claimantId),
        blockedReason: t.blockedReason,
        oldRemovedAt,
        cancelRequested,
        staleReason,
        completedAt: t.completedAt?.toISOString() ?? null,
        completionReference: t.completionReference,
        completionNote: t.completionNote,
        completionMethod: t.completionMethod,
        outcome: t.outcome,
        events: t.events.map((e) => ({
          type: e.type,
          actorName: nameOf(e.actorId),
          actingAs: e.actingAs,
          toUserName: nameOf(e.toUserId),
          reason: e.reason,
          occurredAt: e.occurredAt.toISOString(),
        })),
        viewerRole,
        viewerCan,
        handoverCandidates,
      };
    })
  );

  return { rows, total };
}
