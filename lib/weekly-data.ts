import { prisma } from "./prisma";
import { getSubmissionWindow } from "./weekly-entry";
import { krVisibilityWhere } from "./visibility";
import { getISOWeek } from "./date";
import type { UserRole } from "@prisma/client";

// Shared assembly of the weekly-entry payload — one source of truth for the
// web page (app/(dashboard)/weekly/page.tsx) and the mobile bootstrap API.

export interface WeeklySessionUser {
  id: string;
  orgId: string;
  role: UserRole;
}

export async function getWeeklyKrData(
  user: WeeklySessionUser,
  weekNumber: number,
  year: number,
) {
  const { id: userId, orgId, role } = user;
  const { weekNumber: currentWeek, year: currentYear } = getISOWeek(new Date());
  const isHistorical = weekNumber !== currentWeek || year !== currentYear;

  // A PO viewing the just-ended week stays editable through the 24h Monday
  // grace window — ISO week rolls Monday 00:00, so "the week the PO is
  // catching up on" is historical from the calendar's perspective.
  // Past that grace cutoff, historical weeks are read-only for everyone.
  const { deadline, graceCutoff } = getSubmissionWindow(year, weekNumber);
  const nowMs = Date.now();
  const isInGraceWindow = nowMs > deadline && nowMs <= graceCutoff;
  const isPoGrace =
    (role === "PO" || role === "CONTRIBUTOR") && isHistorical && nowMs <= graceCutoff;
  const isReadOnly = isHistorical && !isPoGrace;

  // CONTRIBUTOR: fetch KRs for their department(s) via DepartmentMember.
  // PO/others: fetch KRs they own directly.
  const memberDeptIds =
    role === "CONTRIBUTOR"
      ? (
          await prisma.departmentMember.findMany({
            where: { userId, department: { orgId } },
            select: { departmentId: true },
          })
        ).map((m) => m.departmentId)
      : [];

  const keyResults = await prisma.keyResult.findMany({
    where: {
      orgId,
      isActive: true,
      deletedAt: null,
      ...(role === "CONTRIBUTOR"
        ? { objective: { departmentId: { in: memberDeptIds } } }
        : { ownerId: userId }),
      ...krVisibilityWhere(role),
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

  const orgUsers = await prisma.user.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const departmentMembers = await prisma.departmentMember.findMany({
    where: { department: { orgId } },
    select: { departmentId: true, userId: true, user: { select: { id: true, name: true } } },
  });

  // Fetch existing entries for the requested week.
  // Scope by orgId + (krId in PO's KR set) — never by submittedBy: another user
  // (CEO/Management saving on behalf, or a co-PO) would otherwise hide the row
  // and the form would silently overwrite their input on next save.
  const krIds = keyResults.map((kr) => kr.id);
  const existingEntries = await prisma.weeklyEntry.findMany({
    where: { orgId, krId: { in: krIds }, weekNumber, year },
    include: { submitter: { select: { id: true, name: true } } },
  });
  const entryMap = new Map(existingEntries.map((e) => [e.krId, e]));

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
      submittedByOther:
        existing && existing.submitter.id !== userId ? existing.submitter.name : null,
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

  const entityNames = new Set<string>();
  for (const kr of keyResults) {
    const entity = kr.objective.product || kr.objective.department;
    if (entity) entityNames.add(`${entity.code} ${entity.name}`);
  }

  return {
    krData,
    orgUsers,
    isReadOnly,
    isHistorical,
    isPoGrace,
    isInGraceWindow,
    deadline,
    graceCutoff,
    entityNames: Array.from(entityNames),
    submittedCount: existingEntries.length,
  };
}

export type WeeklyKrData = Awaited<ReturnType<typeof getWeeklyKrData>>["krData"][number];
