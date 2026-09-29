import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { queryAuditEvents } from "@/lib/access/audit-server";
import { AccessAuditTable } from "@/components/access/AccessAuditTable";

export default async function AccessAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAuditViewer = effectiveRoles.some((r) => r.role === "AUDIT_VIEWER");
  if (!isAuditViewer) redirect("/dashboard");

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 25;

  const { rows, total } = await queryAuditEvents(orgId, {}, { page, pageSize });

  // ⚠️ Correction post-revue (Tâche 18, même défaut que la Tâche 17) :
  // `AccessAuditEventDTO.occurredAt` est un `Date` côté serveur, mais
  // `AccessAuditTable` (client) l'attend en `string` — sérialiser en ISO
  // avant de passer les props, comme partout ailleurs dans le projet.
  const serializedRows = rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));

  return (
    <div>
      <AdminPageHeader
        title="Journal d'audit"
        subtitle={`${total} événement${total > 1 ? "s" : ""} enregistré${total > 1 ? "s" : ""}`}
      />
      <AccessAuditTable rows={serializedRows} page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
