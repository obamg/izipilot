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
 */
export function resolveReadScopes(
  userId: string,
  effectiveRoles: EffectiveRole[],
  ownedAssetIds: string[]
): ReadScope[] {
  const scopes: ReadScope[] = [{ kind: "SELF", userId }];

  for (const r of effectiveRoles) {
    if (r.role === "DEPARTMENT_HEAD" && r.departmentId) {
      scopes.push({ kind: "DEPARTMENT", departmentId: r.departmentId });
    }
    if (r.role === "ASSET_ADMINISTRATOR" && ownedAssetIds.length > 0) {
      scopes.push({ kind: "OWNED_ASSETS", assetIds: ownedAssetIds });
    }
    if (r.role === "CISO" || r.role === "COO") {
      scopes.push({ kind: "ALL" });
    }
    if (r.role === "AUDIT_VIEWER") {
      scopes.push({ kind: "AUDIT" });
    }
  }

  return scopes;
}
