// lib/access/asset-admin-guard.ts
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "./roles-server";

export class AssetAdminAccessDeniedError extends Error {}

export async function requireAssetAdministrator(): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user) throw new AssetAdminAccessDeniedError("Non authentifié");

  const effectiveRoles = await getEffectiveRoleHolders(session.user.orgId, session.user.id);
  const hasRole = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!hasRole) throw new AssetAdminAccessDeniedError("Administration des actifs non autorisée");

  return { userId: session.user.id, orgId: session.user.orgId };
}
