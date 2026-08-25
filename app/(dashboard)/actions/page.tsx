import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ActionsList } from "./ActionsList";
import { actionVisibilityWhere } from "@/lib/visibility";
import { loadWorkflows, loadTeamWorkflowMap } from "@/lib/board-column-server";

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ assignee?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const params = await searchParams;
  // ?assignee=me preselects the current user in the assignee filter (used by
  // the "Mes actions" sidebar shortcut). Any other value is ignored so the
  // dropdown stays fully user-controlled.
  const defaultAssigneeId = params.assignee === "me" ? session.user.id : null;

  const [actions, orgUsers, workflows, teamWorkflows] = await Promise.all([
    prisma.action.findMany({
      where: { orgId, ...actionVisibilityWhere(session.user.role) },
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        keyResult: {
          select: {
            id: true,
            title: true,
            objective: {
              select: {
                title: true,
                product: { select: { id: true, code: true, name: true } },
                department: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
        _count: { select: { comments: true } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Flux de colonnes : le kanban affiche celui de l'entité filtrée.
    loadWorkflows(orgId),
    loadTeamWorkflowMap(orgId),
  ]);

  const actionsData = actions.map((a) => ({
    id: a.id,
    krId: a.krId,
    krTitle: a.keyResult.title,
    entityCode: a.keyResult.objective.product?.code ?? a.keyResult.objective.department?.code ?? "",
    entityName: a.keyResult.objective.product?.name ?? a.keyResult.objective.department?.name ?? "",
    // Clé d'équipe du KR porteur — le produit prime, comme partout ailleurs.
    entityKey: a.keyResult.objective.product
      ? `P:${a.keyResult.objective.product.id}`
      : a.keyResult.objective.department
      ? `D:${a.keyResult.objective.department.id}`
      : null,
    columnId: a.columnId,
    title: a.title,
    description: a.description,
    assigneeId: a.assignee.id,
    assigneeName: a.assignee.name,
    createdByName: a.createdBy.name,
    status: a.status,
    priority: a.priority,
    dueDate: a.dueDate?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    weekCreated: a.weekCreated,
    createdAt: a.createdAt.toISOString(),
    commentCount: a._count.comments,
  }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="font-serif text-[20px] text-dark">Actions</h1>
          <p className="text-[11px] text-izi-gray mt-0.5">
            Suivi des actions par Key Result &middot; {actionsData.length} action{actionsData.length > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <ActionsList
        key={defaultAssigneeId ?? "all"}
        actions={actionsData}
        users={orgUsers}
        currentUserRole={session.user.role}
        defaultAssigneeId={defaultAssigneeId}
        workflows={workflows}
        teamWorkflows={teamWorkflows}
      />
    </div>
  );
}
