import type { AccessModuleRole } from "./types";

export type ReadScope =
  | { kind: "ALL" }
  | { kind: "SELF"; userId: string }
  | { kind: "DEPARTMENT"; departmentId: string }
  | { kind: "OWNED_ASSETS"; assetIds: string[] }
  | { kind: "AUDIT" }
  | { kind: "NONE" };

export interface EffectiveRole {
  role: AccessModuleRole;
  actsAsPrimary: boolean;
  departmentId: string | null;
}

/**
 * Portées de lecture cumulées pour un utilisateur. SELF est toujours présent :
 * la spec garantit à chacun la visibilité de ses propres accès et demandes
 * (§3, invariant 8). L'ordre — SELF, puis DEPARTMENT, puis OWNED_ASSETS, puis
 * ALL/AUDIT — est stable pour des tests déterministes ; les appelants ne
 * doivent pas s'appuyer sur l'ordre pour le comportement métier.
 *
 * OWNED_ASSETS découle de la possession d'actifs (propriétaire ou suppléant,
 * `ownedAssetIds` calculé côté serveur), pas du rôle ASSET_ADMINISTRATOR : la
 * spec (§2) donne à l'administrateur le catalogue, pas les affectations
 * d'autrui (phase 2b, décision du 2026-09-29).
 */
export function resolveReadScopes(
  userId: string,
  effectiveRoles: EffectiveRole[],
  ownedAssetIds: string[]
): ReadScope[] {
  const departments: ReadScope[] = [];
  const global: ReadScope[] = [];

  for (const r of effectiveRoles) {
    if (r.role === "DEPARTMENT_HEAD" && r.departmentId) {
      departments.push({ kind: "DEPARTMENT", departmentId: r.departmentId });
    }
    if (r.role === "CISO" || r.role === "COO") {
      global.push({ kind: "ALL" });
    }
    if (r.role === "AUDIT_VIEWER") {
      global.push({ kind: "AUDIT" });
    }
  }

  return [
    { kind: "SELF", userId },
    ...departments,
    ...(ownedAssetIds.length > 0 ? [{ kind: "OWNED_ASSETS" as const, assetIds: ownedAssetIds }] : []),
    ...global,
  ];
}
