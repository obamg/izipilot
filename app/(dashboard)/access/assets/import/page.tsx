import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listImportBatches } from "@/lib/access/import-server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ImportSeedPanel } from "@/components/access/ImportSeedPanel";
import { ImportBaselinePanel } from "@/components/access/ImportBaselinePanel";
import { ImportHistoryList } from "@/components/access/ImportHistoryList";

export default async function AccessImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAssetAdmin = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!isAssetAdmin) redirect("/dashboard");

  const batches = await listImportBatches(orgId);
  const serializedBatches = batches.map((b) => ({
    ...b,
    committedAt: b.committedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Import du catalogue et des accès"
        subtitle="Amorcer le registre à partir de données existantes"
      />
      <div className="space-y-6 mt-4">
        <ImportSeedPanel />
        <ImportBaselinePanel />
        <ImportHistoryList batches={serializedBatches} />
      </div>
    </div>
  );
}
