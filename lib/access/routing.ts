// lib/access/routing.ts

export type ApprovalStageRole = "DEPARTMENT_HEAD" | "CISO" | "COO";

export interface RouteResult {
  stages: ApprovalStageRole[];
  exceptionReason: string | null;
}

export interface RequesterRole {
  role: "COO" | "CISO" | "DEPARTMENT_HEAD";
  actsAsPrimary: boolean;
}

/**
 * Route de demande pour GRANT/UPGRADE/RENEW (spec §5, tableau des routes
 * personnelles). Un suppléant agissant comme COO/CISO/chef de département
 * (actsAsPrimary: false) n'hérite JAMAIS des exemptions personnelles —
 * seul le titulaire réel en bénéficie.
 */
export function computeGrantRoute(requesterRoles: RequesterRole[], targetLevelIsAdmin: boolean): RouteResult {
  const isPrimary = (role: RequesterRole["role"]) =>
    requesterRoles.some((r) => r.role === role && r.actsAsPrimary);

  if (isPrimary("COO")) {
    return { stages: [], exceptionReason: "COO_SELF_REQUEST" };
  }
  if (isPrimary("CISO")) {
    return { stages: ["COO"], exceptionReason: null };
  }
  if (isPrimary("DEPARTMENT_HEAD")) {
    return { stages: targetLevelIsAdmin ? ["CISO", "COO"] : ["CISO"], exceptionReason: null };
  }
  return {
    stages: targetLevelIsAdmin ? ["DEPARTMENT_HEAD", "CISO", "COO"] : ["DEPARTMENT_HEAD", "CISO"],
    exceptionReason: null,
  };
}

export type ReductionInitiatorRole = "DEPARTMENT_HEAD" | "IT_ACCESS_OPERATOR" | "CISO";

/**
 * Route de demande pour REDUCE/REVOKE (spec §5, "Ordinary reductions/
 * removals"). Ne prend jamais targetLevelIsAdmin en compte : retirer un
 * accès administrateur n'ajoute jamais automatiquement COO — seule une
 * escalade CISO explicite le fait (gérée à la décision, pas ici).
 */
export function computeReductionRoute(
  initiatorRole: ReductionInitiatorRole,
  beneficiaryIsPrimaryCiso: boolean
): ApprovalStageRole[] {
  if (initiatorRole === "CISO" || beneficiaryIsPrimaryCiso) {
    return ["COO"];
  }
  return ["CISO"];
}

export type RequestKind = "GRANT" | "UPGRADE" | "RENEW" | "REDUCE" | "REVOKE";

export class InvalidRequestError extends Error {}

export interface CurrentAccessSnapshot {
  levelId: string | null;
  status: "ACTIVE" | "EXPIRED_REMOVAL_PENDING" | "REVOKED";
  priority: number | null;
  periodEnd: Date | null;
}

/**
 * Dérive le type de demande depuis l'affectation actuelle et le niveau
 * cible (spec §5, tableau "Existing state / desired action"). Une
 * affectation non ACTIVE (EXPIRED_REMOVAL_PENDING, REVOKED) est traitée
 * comme "aucune affectation actuelle".
 */
export function classifyRequest(
  current: CurrentAccessSnapshot | null,
  targetLevelId: string | null,
  targetPriority: number | null,
  targetPeriodEnd: Date | null
): RequestKind {
  const hasActiveCurrent = current !== null && current.status === "ACTIVE" && current.levelId !== null;

  if (!hasActiveCurrent) {
    if (targetLevelId === null) {
      throw new InvalidRequestError("Aucun accès actuel à réduire ou révoquer");
    }
    return "GRANT";
  }

  if (targetLevelId === null) {
    return "REVOKE";
  }

  if (current!.levelId === targetLevelId) {
    if (samePeriod(current!.periodEnd, targetPeriodEnd)) {
      throw new InvalidRequestError("Demande identique à l'accès actuel — doublon invalide");
    }
    return "RENEW";
  }

  if (targetPriority === null || current!.priority === null) {
    throw new InvalidRequestError("Priorité de niveau inconnue — impossible de déterminer upgrade/reduce");
  }
  return targetPriority > current!.priority ? "UPGRADE" : "REDUCE";
}

function samePeriod(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}
