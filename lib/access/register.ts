// lib/access/register.ts
// Vues de lecture du registre (phase 2b) — logique pure, sans accès base.
// Toute requête du registre passe par buildAssignmentQuery : la clause de
// portée est toujours un terme d'un AND, les filtres utilisateur ne peuvent
// donc qu'affiner (FEATURE-PROMPT §3 : filtrer par portée avant pagination,
// totaux, recherche et sérialisation).
import type { Prisma } from "@prisma/client";
import type { ReadScope } from "./scope";

export const CURRENT_ASSIGNMENT_STATUSES = ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] as const;

export type RegisterView =
  | { kind: "SELF" }
  | { kind: "DEPARTMENT"; departmentId: string } // "ALL" = tous départements
  | { kind: "ASSET"; assetId?: string };

export interface RegisterFilters {
  assetId?: string;
  levelId?: string;
  q?: string;
}

export function scopeToAssignmentWhere(
  orgId: string,
  scope: ReadScope
): Prisma.AccessAssignmentWhereInput {
  switch (scope.kind) {
    case "SELF":
      return { orgId, userId: scope.userId };
    case "DEPARTMENT":
      return { orgId, user: { accessProfile: { primaryDepartmentId: scope.departmentId } } };
    case "OWNED_ASSETS":
      return { orgId, assetId: { in: scope.assetIds } };
    case "ALL":
      return { orgId };
    case "AUDIT":
    case "NONE":
      // AUDIT donne le journal d'audit, pas le registre.
      return { orgId, id: { in: [] } };
  }
}

/**
 * Portée effective à appliquer pour la vue demandée, ou null si aucune des
 * portées du lecteur ne la couvre. Un département précis est couvert par sa
 * propre portée DEPARTMENT ou par ALL ; « Toutes » exige ALL ; la vue actifs
 * exige OWNED_ASSETS (ALL ne la donne pas — elle est propre aux propriétaires).
 */
export function authorizeView(view: RegisterView, scopes: ReadScope[]): ReadScope | null {
  switch (view.kind) {
    case "SELF":
      return scopes.find((s) => s.kind === "SELF") ?? null;
    case "DEPARTMENT": {
      const hasAll = scopes.some((s) => s.kind === "ALL");
      if (view.departmentId === "ALL") return hasAll ? { kind: "ALL" } : null;
      const own = scopes.find(
        (s) => s.kind === "DEPARTMENT" && s.departmentId === view.departmentId
      );
      if (own) return own;
      return hasAll ? { kind: "DEPARTMENT", departmentId: view.departmentId } : null;
    }
    case "ASSET": {
      const owned = scopes.find(
        (s): s is Extract<ReadScope, { kind: "OWNED_ASSETS" }> => s.kind === "OWNED_ASSETS"
      );
      if (!owned) return null;
      if (!view.assetId) return owned;
      return owned.assetIds.includes(view.assetId)
        ? { kind: "OWNED_ASSETS", assetIds: [view.assetId] }
        : null;
    }
  }
}

export function buildAssignmentQuery(
  orgId: string,
  scope: ReadScope,
  filters: RegisterFilters
): Prisma.AccessAssignmentWhereInput {
  const and: Prisma.AccessAssignmentWhereInput[] = [
    scopeToAssignmentWhere(orgId, scope),
    { status: { in: [...CURRENT_ASSIGNMENT_STATUSES] } },
  ];
  if (filters.assetId) and.push({ assetId: filters.assetId });
  if (filters.levelId) and.push({ levelId: filters.levelId });
  const q = filters.q?.trim();
  if (q) and.push({ user: { name: { contains: q, mode: "insensitive" } } });
  return { orgId, AND: and };
}

export function orderByForView(
  view: RegisterView
): Prisma.AccessAssignmentOrderByWithRelationInput[] {
  if (view.kind === "DEPARTMENT" && view.departmentId === "ALL") {
    // Tri via relations optionnelles (LEFT JOIN) : PostgreSQL place les
    // employés sans département principal en dernier en tri ascendant.
    return [
      { user: { accessProfile: { primaryDepartment: { name: "asc" } } } },
      { user: { name: "asc" } },
      { asset: { name: "asc" } },
      { id: "asc" },
    ];
  }
  if (view.kind === "DEPARTMENT") {
    return [{ user: { name: "asc" } }, { asset: { name: "asc" } }, { id: "asc" }];
  }
  return [{ asset: { name: "asc" } }, { user: { name: "asc" } }, { id: "asc" }];
}

export function registerNavFlags(scopes: ReadScope[]): {
  hasDepartmentView: boolean;
  hasOwnedAssetsView: boolean;
  canSeeAll: boolean;
} {
  const canSeeAll = scopes.some((s) => s.kind === "ALL");
  return {
    hasDepartmentView: canSeeAll || scopes.some((s) => s.kind === "DEPARTMENT"),
    hasOwnedAssetsView: scopes.some((s) => s.kind === "OWNED_ASSETS"),
    canSeeAll,
  };
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}

export function formatPeriod(periodStart: string | null, periodEnd: string | null): string {
  if (periodStart && periodEnd) return `${formatDay(periodStart)} → ${formatDay(periodEnd)}`;
  if (periodStart) return `Depuis le ${formatDay(periodStart)} · en cours`;
  if (periodEnd) return `Jusqu'au ${formatDay(periodEnd)}`;
  return "Non renseignée";
}
