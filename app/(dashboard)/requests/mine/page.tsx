// app/(dashboard)/requests/mine/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMyRequests } from "@/lib/access/requests-read-server";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { PageHeader } from "@/components/layout/PageHeader";
import { SubmitRequestForm } from "@/components/access/SubmitRequestForm";
import { MyRequestActions } from "@/components/access/MyRequestActions";
import { DepartmentReductionPanel } from "@/components/access/DepartmentReductionPanel";

export default async function MyRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const [myRequests, assets, effectiveRoles] = await Promise.all([
    listMyRequests(orgId, session.user.id),
    prisma.accessAsset.findMany({
      where: { orgId, archivedAt: null, requestsEnabled: true },
      select: {
        id: true,
        name: true,
        levels: { where: { archivedAt: null, enabled: true }, select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
    getEffectiveRoleHolders(orgId, session.user.id),
  ]);

  const serializedRequests = myRequests.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd ? r.periodEnd.toISOString() : null,
  }));

  const headedDepartmentIds = effectiveRoles
    .filter((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId !== null)
    .map((r) => r.departmentId as string);

  return (
    <div>
      <PageHeader title="Mes demandes" subtitle="Soumettre et suivre vos demandes d'accès" />
      {headedDepartmentIds.map((id) => (
        <DepartmentReductionPanel key={id} departmentId={id} />
      ))}
      <SubmitRequestForm assets={assets} currentUserId={session.user.id} />
      <div className="mt-6">
        <h2 className="font-serif text-[16px] text-dark mb-3">Historique</h2>
        {serializedRequests.length === 0 ? (
          <p className="text-[12px] text-izi-gray">Aucune demande pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-izi-gray text-left">
                <th className="py-1 font-medium">Actif</th>
                <th className="py-1 font-medium">Niveau visé</th>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 font-medium">Statut</th>
                <th className="py-1 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {serializedRequests.map((r) => (
                <tr key={r.versionId} className="border-t border-border-soft">
                  <td className="py-1" title={r.justification}>
                    {r.assetName}
                    {/* Visible en plus du title : le title seul est inutile
                       au doigt sur mobile, où les POs saisissent (CLAUDE.md). */}
                    <p className="text-[11px] text-izi-gray mt-0.5">{r.justification}</p>
                  </td>
                  <td className="py-1">{r.targetLevelName ?? "—"}</td>
                  <td className="py-1">{r.kind}</td>
                  <td className="py-1">
                    {r.state}
                    {r.currentStageReason && (
                      <p className="text-[11px] text-dark-md mt-0.5 rounded-[6px] bg-gold-lt px-1.5 py-0.5">
                        {r.currentStageReason}
                      </p>
                    )}
                  </td>
                  <td className="py-1">
                    <MyRequestActions
                      row={{
                        requestId: r.requestId,
                        versionId: r.versionId,
                        state: r.state,
                        stageIdIfClarification: r.pendingClarificationStageId,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
