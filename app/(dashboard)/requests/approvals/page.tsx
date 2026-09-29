// app/(dashboard)/requests/approvals/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listMyApprovals } from "@/lib/access/requests-read-server";
import { PageHeader } from "@/components/layout/PageHeader";
import { PendingApprovalsList } from "@/components/access/PendingApprovalsList";

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const canApprove = effectiveRoles.some(
    (r) => r.role === "DEPARTMENT_HEAD" || r.role === "CISO" || r.role === "COO"
  );
  if (!canApprove) redirect("/dashboard");

  const pending = await listMyApprovals(orgId, session.user.id);
  const serialized = pending.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd ? p.periodEnd.toISOString() : null,
  }));

  return (
    <div>
      <PageHeader title="Mes approbations" subtitle="Étapes de demandes d'accès en attente de votre décision" />
      <PendingApprovalsList items={serialized} />
    </div>
  );
}
