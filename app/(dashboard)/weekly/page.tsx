import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { WeeklyEntryForm } from "./WeeklyEntryForm";
import { WeeklyWeekSelector } from "./WeeklyWeekSelector";
import { getISOWeek } from "@/lib/date";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const userId = session.user.id;
  const { weekNumber: currentWeek, year: currentYear } = getISOWeek(new Date());

  const params = await searchParams;
  const weekNumber = params.week ? parseInt(params.week, 10) : currentWeek;
  const year = params.year ? parseInt(params.year, 10) : currentYear;
  const isHistorical = weekNumber !== currentWeek || year !== currentYear;

  // Fetch KRs owned by this user (with actions)
  const keyResults = await prisma.keyResult.findMany({
    where: {
      orgId,
      ownerId: userId,
      isActive: true,
    },
    include: {
      objective: {
        include: {
          product: { select: { code: true, name: true, color: true } },
          department: { select: { code: true, name: true, color: true } },
        },
      },
      actions: {
        where: { status: { not: "CANCELLED" } },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      },
    },
    orderBy: [{ objective: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });

  // Fetch org users for action assignee selector
  const orgUsers = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Fetch department members for filtering assignees by department
  const departmentMembers = await prisma.departmentMember.findMany({
    where: { department: { orgId } },
    select: { departmentId: true, userId: true, user: { select: { id: true, name: true } } },
  });

  // Fetch existing entries for the requested week
  const existingEntries = await prisma.weeklyEntry.findMany({
    where: {
      orgId,
      submittedBy: userId,
      weekNumber,
      year,
    },
  });

  const entryMap = new Map(existingEntries.map((e) => [e.krId, e]));

  // Get entity name for the header
  const entityNames = new Set<string>();
  for (const kr of keyResults) {
    const entity = kr.objective.product || kr.objective.department;
    if (entity) entityNames.add(`${("code" in entity ? entity.code : "")} ${entity.name}`);
  }

  // Build department members lookup
  const deptMembersMap = new Map<string, { id: string; name: string }[]>();
  for (const dm of departmentMembers) {
    const list = deptMembersMap.get(dm.departmentId) || [];
    list.push({ id: dm.user.id, name: dm.user.name });
    deptMembersMap.set(dm.departmentId, list);
  }

  const krData = keyResults.map((kr) => {
    const existing = entryMap.get(kr.id);
    const entity = kr.objective.product || kr.objective.department;
    const deptId = kr.objective.departmentId;
    return {
      id: kr.id,
      title: kr.title,
      target: kr.target,
      targetUnit: kr.targetUnit,
      currentValue: kr.currentValue,
      score: Math.round(Number(kr.score) * 100),
      status: kr.status,
      krType: kr.krType,
      objectiveTitle: kr.objective.title,
      entityCode: entity ? entity.code : "",
      entityName: entity ? entity.name : "",
      entityColor: entity ? entity.color : "var(--teal)",
      departmentId: deptId ?? null,
      departmentMembers: deptId ? (deptMembersMap.get(deptId) || []) : [],
      // Pre-fill from existing entry if any
      existingProgress: existing ? Math.round(existing.progress * 100) : undefined,
      existingStatus: existing?.status,
      existingBlocker: existing?.blocker ?? undefined,
      existingProposedSolution: existing?.proposedSolution ?? undefined,
      existingActionNeeded: existing?.actionNeeded ?? undefined,
      existingComment: existing?.comment ?? undefined,
      isSubmitted: !!existing,
      actions: kr.actions.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        status: a.status,
        priority: a.priority,
        assigneeId: a.assignee.id,
        assigneeName: a.assignee.name,
        dueDate: a.dueDate?.toISOString() ?? null,
      })),
    };
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-[20px] text-dark">
              Ma revue &mdash; S{String(weekNumber).padStart(2, "0")}
            </h1>
            <WeeklyWeekSelector
              weekNumber={weekNumber}
              year={year}
              currentWeek={currentWeek}
              currentYear={currentYear}
            />
          </div>
          <p className="text-[11px] text-izi-gray mt-0.5">
            {Array.from(entityNames).join(", ")}
            {isHistorical
              ? " \u00b7 Lecture seule"
              : " \u00b7 Deadline lundi 09h00"}
          </p>
        </div>
      </div>

      {keyResults.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">
            Aucun Key Result ne vous est assign&eacute;.
          </p>
          <p className="text-xs text-izi-gray mt-1">
            Contactez votre administrateur pour configurer vos OKRs.
          </p>
        </div>
      ) : isHistorical && existingEntries.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">
            Aucune revue soumise pour S{String(weekNumber).padStart(2, "0")} &middot; {year}.
          </p>
        </div>
      ) : (
        <WeeklyEntryForm
          keyResults={krData}
          weekNumber={weekNumber}
          year={year}
          orgUsers={orgUsers}
          currentUserId={userId}
          currentUserRole={session.user.role}
          isReadOnly={isHistorical}
        />
      )}
    </div>
  );
}
