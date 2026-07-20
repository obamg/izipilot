/**
 * Task-request ("Demande") logic — pure helpers, no Prisma access, so the
 * routing / permission rules stay unit-testable.
 *
 * A request is raised from a SprintTask and directed at EITHER one teammate OR
 * one team (department / product). The target résout / refuse it (two-sided);
 * the requester may annuler while it is still OPEN.
 */

import type { RequestKind, RequestStatus, UserRole } from "@prisma/client";

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  INPUT: "Contribution",
  REVIEW: "Relecture",
  APPROVAL: "Approbation",
  DATA: "Données",
  OTHER: "Autre",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  OPEN: "En attente",
  RESOLVED: "Résolue",
  DECLINED: "Refusée",
  CANCELLED: "Annulée",
};

const PRIVILEGED: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT"];

/** The viewer's identity + team memberships used to route requests. */
export interface ViewerTeams {
  userId: string;
  role: UserRole;
  departmentIds: string[]; // departments the user is a member of
  productIds: string[]; // products the user owns
}

/** Minimal request shape the routing / permission helpers reason over. */
export interface RequestLike {
  requestedById: string;
  status: RequestStatus;
  targetUserId: string | null;
  targetDepartmentId: string | null;
  targetProductId: string | null;
}

/** True when the request is aimed at the viewer (as person or via their team). */
export function isTargetedAt(req: RequestLike, v: ViewerTeams): boolean {
  if (req.targetUserId && req.targetUserId === v.userId) return true;
  if (req.targetDepartmentId && v.departmentIds.includes(req.targetDepartmentId))
    return true;
  if (req.targetProductId && v.productIds.includes(req.targetProductId))
    return true;
  return false;
}

/**
 * Who may raise a request from a task: CEO / MANAGEMENT / PO on any visible
 * task, a CONTRIBUTOR only on their own assigned task, VIEWER never.
 */
export function canRaiseRequest(
  task: { assigneeId: string | null },
  viewer: { userId: string; role: UserRole }
): boolean {
  if (viewer.role === "VIEWER") return false;
  if (
    viewer.role === "CEO" ||
    viewer.role === "MANAGEMENT" ||
    viewer.role === "PO"
  )
    return true;
  return task.assigneeId === viewer.userId; // CONTRIBUTOR
}

/** Only the target (person / team member) or a privileged role may résoudre/refuser — and only while OPEN. */
export function canResolveRequest(req: RequestLike, v: ViewerTeams): boolean {
  if (req.status !== "OPEN") return false;
  if (PRIVILEGED.includes(v.role)) return true;
  return isTargetedAt(req, v);
}

/** The requester may annuler their own request while it is still OPEN. */
export function canCancelRequest(
  req: RequestLike,
  viewer: { userId: string }
): boolean {
  return req.status === "OPEN" && req.requestedById === viewer.userId;
}

/**
 * Split requests into the viewer's inbox: `sent` (they raised, any status) and
 * `received` (OPEN, aimed at them, not their own). A request is never in both.
 */
export function partitionInbox<T extends RequestLike>(
  requests: T[],
  v: ViewerTeams
): { received: T[]; sent: T[] } {
  const received: T[] = [];
  const sent: T[] = [];
  for (const r of requests) {
    if (r.requestedById === v.userId) sent.push(r);
    else if (r.status === "OPEN" && isTargetedAt(r, v)) received.push(r);
  }
  return { received, sent };
}

/** Human label for a request target, from included relation names. */
export function describeTarget(req: {
  targetUser?: { name: string } | null;
  targetDepartment?: { code: string; name: string } | null;
  targetProduct?: { code: string; name: string } | null;
}): string {
  if (req.targetUser) return req.targetUser.name;
  if (req.targetDepartment)
    return `${req.targetDepartment.name} (${req.targetDepartment.code})`;
  if (req.targetProduct)
    return `${req.targetProduct.name} (${req.targetProduct.code})`;
  return "—";
}

/** How many targets are set — must be exactly 1 (validation refinement). */
export function targetCount(input: {
  targetUserId?: string | null;
  targetDepartmentId?: string | null;
  targetProductId?: string | null;
}): number {
  return [input.targetUserId, input.targetDepartmentId, input.targetProductId].filter(
    Boolean
  ).length;
}
