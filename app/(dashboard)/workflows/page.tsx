import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/PageHeader";
import { WorkflowsManager } from "@/components/workflows/WorkflowsManager";
import {
  ensureDefaultWorkflow,
  ownedTeamKeys,
  teamKeysByWorkflow,
} from "@/lib/board-column-server";
import { sortColumns } from "@/lib/board-column";
import {
  canCreateWorkflow,
  canAssignTeam,
  canEditWorkflow,
  canDeleteWorkflow,
  canViewWorkflows,
  hasFullAccess,
  readOnlyReason,
  type WorkflowViewer,
} from "@/lib/workflow-access";

export const dynamic = "force-dynamic";

/**
 * Flux de tableau : les colonnes que chaque équipe voit sur son board.
 *
 * Ouvert au CEO, au management et aux PO. Un PO ne pilote que les flux de ses
 * propres équipes — les autres lui sont montrés en lecture seule, avec la
 * raison, pour qu'il puisse quand même y rattacher une équipe en connaissance
 * de cause.
 */
export default async function WorkflowsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewWorkflows(session.user.role)) redirect("/dashboard");

  const orgId = session.user.orgId;
  await ensureDefaultWorkflow(orgId);

  const viewer: WorkflowViewer = {
    id: session.user.id,
    role: session.user.role,
    ownedTeamKeys: await ownedTeamKeys(orgId, session.user.id),
  };

  const [workflows, products, departments, teamsByWorkflow] = await Promise.all([
    prisma.boardWorkflow.findMany({
      where: { orgId },
      include: {
        createdBy: { select: { id: true, name: true } },
        columns: {
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          include: { _count: { select: { tasks: true } } },
        },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.product.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true, color: true, workflowId: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true, color: true, workflowId: true },
      orderBy: { sortOrder: "asc" },
    }),
    teamKeysByWorkflow(orgId),
  ]);

  const serialized = workflows.map((w) => {
    const access = {
      isDefault: w.isDefault,
      createdById: w.createdById,
      teamKeys: teamsByWorkflow[w.id] ?? [],
    };
    return {
      id: w.id,
      name: w.name,
      description: w.description,
      isDefault: w.isDefault,
      createdByName: w.createdBy?.name ?? null,
      canEdit: canEditWorkflow(viewer, access),
      canDelete: canDeleteWorkflow(viewer, access),
      lockedReason: readOnlyReason(viewer, access),
      columns: sortColumns(w.columns).map((c) => ({
        id: c.id,
        label: c.label,
        color: c.color,
        category: c.category,
        sortOrder: c.sortOrder,
        wipLimit: c.wipLimit,
        taskCount: c._count.tasks,
      })),
    };
  });

  const allTeams = [
    ...products.map((p) => ({ ...p, key: `P:${p.id}`, kind: "Produit" as const })),
    ...departments.map((d) => ({
      ...d,
      key: `D:${d.id}`,
      kind: "Département" as const,
    })),
  ];

  // Un PO ne voit dans l'affectation que les équipes qu'il pilote : lui montrer
  // les autres en lecture seule n'apporterait rien d'actionnable.
  const teams = allTeams
    .filter((t) => hasFullAccess(viewer.role) || canAssignTeam(viewer, t.key))
    .map((t) => ({
      key: t.key,
      kind: t.kind,
      code: t.code,
      name: t.name,
      color: t.color,
      workflowId: t.workflowId,
    }));

  return (
    <div>
      <PageHeader
        title="Flux de tableau"
        subtitle={
          hasFullAccess(viewer.role)
            ? "Les colonnes que chaque équipe voit sur son sprint. Le libellé est libre ; la catégorie pilote les statistiques."
            : "Configurez les colonnes du tableau de vos équipes. Le libellé est libre ; la catégorie pilote les statistiques."
        }
      />
      <WorkflowsManager
        workflows={serialized}
        teams={teams}
        canCreate={canCreateWorkflow(viewer)}
        isFullAccess={hasFullAccess(viewer.role)}
      />
    </div>
  );
}
