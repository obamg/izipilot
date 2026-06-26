import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  sprintTaskVisibilityWhere,
  departmentVisibilityWhere,
  krVisibilityWhere,
} from "@/lib/visibility";
import {
  computeSprintStats,
  computeBurndown,
  computeCapacityUtilization,
  daysRemaining,
} from "@/lib/sprint";
import { sprintTaskInclude, serializeSprintTask } from "@/lib/sprint-serialize";
import { SprintDetail } from "@/components/sprints/SprintDetail";

export default async function SprintDetailPage({
  params,
}: {
  params: Promise<{ sprintId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const role = session.user.role;
  const { sprintId } = await params;

  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, orgId },
    include: {
      tasks: {
        where: { ...sprintTaskVisibilityWhere(role) },
        include: sprintTaskInclude,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      capacities: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!sprint) notFound();

  const [backlog, users, products, departments, krs] = await Promise.all([
    prisma.sprintTask.findMany({
      where: { orgId, sprintId: null, ...sprintTaskVisibilityWhere(role) },
      include: sprintTaskInclude,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true, ...departmentVisibilityWhere(role) },
      select: { id: true, code: true, name: true, color: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.keyResult.findMany({
      where: { orgId, isActive: true, deletedAt: null, ...krVisibilityWhere(role) },
      select: {
        id: true,
        title: true,
        objective: {
          select: {
            product: { select: { code: true, name: true } },
            department: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const nameMap = new Map(users.map((u) => [u.id, u.name]));
  const stats = computeSprintStats(sprint.tasks);
  const burndown = computeBurndown(sprint, sprint.tasks).map((p) => ({
    label: p.label,
    ideal: p.ideal,
    remaining: p.remaining,
  }));
  const capacityRows = computeCapacityUtilization(
    sprint.capacities.map((c) => ({ userId: c.userId, capacityPoints: c.capacityPoints })),
    sprint.tasks
  ).map((r) => ({ ...r, userName: nameMap.get(r.userId) ?? "—" }));

  const krOptions = krs.map((kr) => ({
    id: kr.id,
    title: kr.title,
    entityCode: kr.objective.product?.code ?? kr.objective.department?.code ?? "",
    entityName: kr.objective.product?.name ?? kr.objective.department?.name ?? "",
  }));

  return (
    <SprintDetail
      sprint={{
        id: sprint.id,
        number: sprint.number,
        name: sprint.name,
        goal: sprint.goal,
        status: sprint.status,
        startDate: sprint.startDate.toISOString(),
        endDate: sprint.endDate.toISOString(),
        completedAt: sprint.completedAt?.toISOString() ?? null,
        stats,
      }}
      tasks={sprint.tasks.map(serializeSprintTask)}
      backlogTasks={backlog.map(serializeSprintTask)}
      burndown={burndown}
      capacityRows={capacityRows}
      users={users}
      products={products}
      departments={departments}
      krs={krOptions}
      currentUserRole={role}
      currentUserId={session.user.id}
      daysRemaining={daysRemaining(sprint.endDate)}
    />
  );
}
