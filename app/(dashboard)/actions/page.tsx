import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ActionsList } from "./ActionsList";

export default async function ActionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const [actions, orgUsers] = await Promise.all([
    prisma.action.findMany({
      where: { orgId },
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
                product: { select: { code: true, name: true } },
                department: { select: { code: true, name: true } },
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
  ]);

  const actionsData = actions.map((a) => ({
    id: a.id,
    krId: a.krId,
    krTitle: a.keyResult.title,
    entityCode: a.keyResult.objective.product?.code ?? a.keyResult.objective.department?.code ?? "",
    entityName: a.keyResult.objective.product?.name ?? a.keyResult.objective.department?.name ?? "",
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

      <ActionsList actions={actionsData} users={orgUsers} />
    </div>
  );
}
