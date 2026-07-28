import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  sprintTaskVisibilityWhere,
  departmentVisibilityWhere,
  krVisibilityWhere,
} from "@/lib/visibility";
import { computeSprintStats, computeVelocity, averageVelocity, daysRemaining } from "@/lib/sprint";
import { canManageRecurring } from "@/lib/recurring-task";
import {
  recurringTaskInclude,
  serializeRecurringTask,
} from "@/lib/sprint-serialize";
import { PageHeader } from "@/components/layout/PageHeader";
import { SprintStatusBadge } from "@/components/sprints/SprintStatusBadge";
import { NewSprintButton } from "@/components/sprints/NewSprintButton";
import { RecurringTasksButton } from "@/components/sprints/RecurringTasksButton";
import { VelocityChart } from "@/components/sprints/VelocityChart";

function fmt(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export default async function SprintsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const role = session.user.role;
  const isManagement = role === "CEO" || role === "MANAGEMENT";

  const sprints = await prisma.sprint.findMany({
    where: { orgId },
    include: {
      tasks: {
        where: { ...sprintTaskVisibilityWhere(role) },
        select: { status: true, storyPoints: true, completedAt: true, assigneeId: true },
      },
    },
    orderBy: { number: "desc" },
  });

  const withStats = sprints.map((s) => ({
    id: s.id,
    number: s.number,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    stats: computeSprintStats(s.tasks),
  }));

  const active = withStats.find((s) => s.status === "ACTIVE") ?? null;

  // Recurring-task management surface — only loaded for roles that can manage it
  // (CEO / MANAGEMENT / PO), with the reference lists its form needs.
  const canManage = canManageRecurring(role);
  let recurringData:
    | Awaited<ReturnType<typeof loadRecurringData>>
    | null = null;
  async function loadRecurringData() {
    const [templates, users, products, departments, krs] = await Promise.all([
      prisma.recurringTask.findMany({
        where: { orgId },
        include: recurringTaskInclude,
        orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }],
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
    return {
      templates: templates.map(serializeRecurringTask),
      users,
      products,
      departments,
      krs: krs.map((kr) => ({
        id: kr.id,
        title: kr.title,
        entityCode: kr.objective.product?.code ?? kr.objective.department?.code ?? "",
        entityName: kr.objective.product?.name ?? kr.objective.department?.name ?? "",
      })),
    };
  }
  if (canManage) recurringData = await loadRecurringData();

  const headerActions =
    canManage && recurringData ? (
      <div className="flex items-center gap-2">
        <RecurringTasksButton
          initialTemplates={recurringData.templates}
          users={recurringData.users}
          products={recurringData.products}
          departments={recurringData.departments}
          krs={recurringData.krs}
          currentUserId={session.user.id}
          currentUserRole={role}
        />
        {isManagement && <NewSprintButton />}
      </div>
    ) : isManagement ? (
      <NewSprintButton />
    ) : undefined;

  // Velocity over completed sprints, oldest → newest.
  const completed = [...sprints]
    .filter((s) => s.status === "COMPLETED")
    .sort((a, b) => a.number - b.number);
  const velocity = computeVelocity(
    completed.map((s) => ({ name: `S${s.number}`, tasks: s.tasks }))
  );
  const avgVelocity = averageVelocity(velocity);

  return (
    <div>
      <PageHeader
        title="Sprints"
        subtitle="Exécution time-boxée — tableau, backlog, burndown et capacité"
        actions={headerActions}
      />

      {withStats.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center">
          <p className="text-[14px] text-dark font-medium mb-1">Aucun sprint pour le moment</p>
          <p className="text-[12px] text-izi-gray">
            {isManagement
              ? "Créez votre premier sprint pour planifier l'exécution."
              : "Les sprints apparaîtront ici une fois créés par le management."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Active sprint + velocity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-[12px] border border-border-soft bg-white p-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray mb-2">
                Sprint en cours
              </h2>
              {active ? (
                <Link href={`/sprints/${active.id}`} className="block group no-underline">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[11px] font-semibold text-teal bg-teal-lt px-1.5 py-0.5 rounded">
                      #{active.number}
                    </span>
                    <span className="font-serif text-[17px] text-dark group-hover:text-teal transition-colors">
                      {active.name}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-izi-gray mb-3">
                    {fmt(active.startDate)} → {fmt(active.endDate)} ·{" "}
                    {daysRemaining(active.endDate)} j restants
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-izi-gray mb-1">
                    <span>
                      {active.stats.donePoints}/{active.stats.totalPoints} pts
                    </span>
                    <span className="font-mono font-semibold text-dark">
                      {active.stats.percentComplete}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-izi-gray-lt overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal"
                      style={{ width: `${active.stats.percentComplete}%` }}
                    />
                  </div>
                </Link>
              ) : (
                <p className="text-[13px] text-izi-gray py-4">Aucun sprint actif.</p>
              )}
            </div>

            <div className="rounded-[12px] border border-border-soft bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray">
                  Vélocité
                </h2>
                {velocity.length > 0 && (
                  <span className="text-[11px] text-izi-gray">
                    moy. <span className="font-mono font-semibold text-dark">{avgVelocity}</span> pts
                  </span>
                )}
              </div>
              <VelocityChart data={velocity} />
            </div>
          </div>

          {/* All sprints */}
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray mb-2">
              Tous les sprints
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {withStats.map((s) => (
                <Link
                  key={s.id}
                  href={`/sprints/${s.id}`}
                  className="block rounded-[10px] border border-border-soft bg-white p-3.5 hover:border-teal-md hover:shadow-sm transition-all no-underline group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[10px] font-semibold text-teal bg-teal-lt px-1.5 py-0.5 rounded">
                      #{s.number}
                    </span>
                    <SprintStatusBadge status={s.status} />
                  </div>
                  <h3 className="text-[14px] font-medium text-dark group-hover:text-teal transition-colors mb-1 line-clamp-1">
                    {s.name}
                  </h3>
                  <p className="font-mono text-[10px] text-izi-gray mb-2.5">
                    {fmt(s.startDate)} → {fmt(s.endDate)}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-izi-gray mb-1">
                    <span>
                      {s.stats.doneTasks}/{s.stats.totalTasks} tâches
                    </span>
                    <span className="font-mono font-semibold text-dark">
                      {s.stats.percentComplete}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-izi-gray-lt overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal"
                      style={{ width: `${s.stats.percentComplete}%` }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
