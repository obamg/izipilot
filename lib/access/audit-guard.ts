// lib/access/audit-guard.ts
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "./roles-server";

export class AuditAccessDeniedError extends Error {}

export async function requireAuditViewer(): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user) throw new AuditAccessDeniedError("Non authentifié");

  const effectiveRoles = await getEffectiveRoleHolders(session.user.orgId, session.user.id);
  const hasAudit = effectiveRoles.some((r) => r.role === "AUDIT_VIEWER");
  if (!hasAudit) throw new AuditAccessDeniedError("Accès au journal d'audit non autorisé");

  return { userId: session.user.id, orgId: session.user.orgId };
}
