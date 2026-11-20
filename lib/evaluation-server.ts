/**
 * Évaluations — accès aux données (DB). La logique de calcul pure vit dans
 * lib/evaluation.ts.
 */

import type { UserRole } from "@prisma/client";
import { prisma } from "./prisma";
import {
  computeDelivery,
  expectedStandupDays,
  monthRange,
  type DeliveryStats,
} from "./evaluation";
import { watDateOnly } from "./standup";

export interface Evaluator {
  id: string;
  role: UserRole;
}

/**
 * Ids des collègues qu'un évaluateur peut noter (hors lui-même).
 * "ALL" = tout le monde (CEO / MANAGEMENT). Sinon : membres des départements
 * qu'il dirige + personnes assignées sur les tâches de ses produits.
 */
export async function evaluableSubjectIds(
  orgId: string,
  ev: Evaluator
): Promise<"ALL" | string[]> {
  if (ev.role === "CEO" || ev.role === "MANAGEMENT") return "ALL";

  const [depts, prods] = await Promise.all([
    prisma.department.findMany({ where: { orgId, ownerId: ev.id }, select: { id: true } }),
    prisma.product.findMany({ where: { orgId, ownerId: ev.id }, select: { id: true } }),
  ]);
  const deptIds = depts.map((d) => d.id);
  const prodIds = prods.map((p) => p.id);

  const ids = new Set<string>();
  if (deptIds.length) {
    const members = await prisma.departmentMember.findMany({
      where: { departmentId: { in: deptIds } },
      select: { userId: true },
    });
    members.forEach((m) => ids.add(m.userId));
  }
  if (prodIds.length) {
    const assignees = await prisma.sprintTask.findMany({
      where: { orgId, productId: { in: prodIds }, assigneeId: { not: null } },
      select: { assigneeId: true },
      distinct: ["assigneeId"],
    });
    assignees.forEach((a) => a.assigneeId && ids.add(a.assigneeId));
  }
  ids.delete(ev.id);
  return [...ids];
}

export function canEvaluate(
  allowed: "ALL" | string[],
  subjectId: string,
  evaluatorId: string
): boolean {
  if (subjectId === evaluatorId) return false;
  return allowed === "ALL" || allowed.includes(subjectId);
}

/**
 * Livraison par personne pour un mois : basée sur les sprints ACTIVE/COMPLETED
 * qui se terminent dans le mois. deliveredPoints (tâches TERMINÉES) ÷ capacité
 * engagée (repli : points assignés).
 */
export async function monthDeliveryByUser(
  orgId: string,
  year: number,
  month: number,
  userIds: string[]
): Promise<Map<string, DeliveryStats>> {
  const result = new Map<string, DeliveryStats>();
  if (userIds.length === 0) return result;

  const { start, end } = monthRange(year, month);
  const sprints = await prisma.sprint.findMany({
    where: { orgId, endDate: { gte: start, lt: end }, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { id: true },
  });
  const sprintIds = sprints.map((s) => s.id);

  if (sprintIds.length === 0) {
    // No sprint concluded this month → no delivery data (manual-only scoring).
    for (const uid of userIds) {
      result.set(uid, computeDelivery([], 0));
    }
    return result;
  }

  const [tasks, caps] = await Promise.all([
    prisma.sprintTask.findMany({
      where: { orgId, sprintId: { in: sprintIds }, assigneeId: { in: userIds } },
      select: { assigneeId: true, status: true, storyPoints: true, completedAt: true, dueDate: true },
    }),
    prisma.sprintCapacity.findMany({
      where: { sprintId: { in: sprintIds }, userId: { in: userIds } },
      select: { userId: true, capacityPoints: true },
    }),
  ]);

  const capByUser = new Map<string, number>();
  for (const c of caps) capByUser.set(c.userId, (capByUser.get(c.userId) ?? 0) + c.capacityPoints);

  const tasksByUser = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    const arr = tasksByUser.get(t.assigneeId) ?? [];
    arr.push(t);
    tasksByUser.set(t.assigneeId, arr);
  }

  for (const uid of userIds) {
    result.set(uid, computeDelivery(tasksByUser.get(uid) ?? [], capByUser.get(uid) ?? 0));
  }
  return result;
}

export interface StandupStats {
  filed: number; // jours attendus effectivement remplis
  expected: number; // jours ouvrés où la personne était dans un sprint
}

/**
 * Point du jour par personne pour un mois. Un jour est attendu s'il est ouvré
 * et couvert par un sprint ACTIVE/COMPLETED auquel la personne participe
 * (tâche non annulée ou capacité — même périmètre que le blocage de
 * member-compliance-server). Aujourd'hui ne compte que s'il est déjà rempli :
 * on ne reproche pas un jour qui n'est pas fini.
 */
export async function monthStandupByUser(
  orgId: string,
  year: number,
  month: number,
  userIds: string[],
  now: Date = new Date()
): Promise<Map<string, StandupStats>> {
  const result = new Map<string, StandupStats>();
  if (userIds.length === 0) return result;

  const { start, end } = monthRange(year, month);
  const sprints = await prisma.sprint.findMany({
    where: {
      orgId,
      startDate: { lt: end },
      endDate: { gte: start },
      status: { in: ["ACTIVE", "COMPLETED"] },
    },
    select: { id: true, startDate: true, endDate: true },
  });
  const sprintIds = sprints.map((s) => s.id);
  const rangeBySprint = new Map(
    sprints.map((s) => [s.id, { start: watDateOnly(s.startDate), end: watDateOnly(s.endDate) }])
  );

  const [tasks, caps, entries] = sprintIds.length
    ? await Promise.all([
        prisma.sprintTask.findMany({
          where: {
            orgId,
            sprintId: { in: sprintIds },
            assigneeId: { in: userIds },
            status: { not: "CANCELLED" },
          },
          select: { sprintId: true, assigneeId: true },
          distinct: ["sprintId", "assigneeId"],
        }),
        prisma.sprintCapacity.findMany({
          where: { orgId, sprintId: { in: sprintIds }, userId: { in: userIds } },
          select: { sprintId: true, userId: true },
        }),
        prisma.standupEntry.findMany({
          where: { orgId, userId: { in: userIds }, date: { gte: start, lt: end } },
          select: { userId: true, date: true },
        }),
      ])
    : [[], [], []];

  const sprintsByUser = new Map<string, Set<string>>();
  const join = (userId: string | null, sprintId: string | null) => {
    if (!userId || !sprintId) return;
    const set = sprintsByUser.get(userId) ?? new Set<string>();
    set.add(sprintId);
    sprintsByUser.set(userId, set);
  };
  tasks.forEach((t) => join(t.assigneeId, t.sprintId));
  caps.forEach((c) => join(c.userId, c.sprintId));

  const filedByUser = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = filedByUser.get(e.userId) ?? new Set<string>();
    set.add(e.date.toISOString().slice(0, 10));
    filedByUser.set(e.userId, set);
  }

  const today = watDateOnly(now);
  const todayKey = today.toISOString().slice(0, 10);
  for (const uid of userIds) {
    const ranges = [...(sprintsByUser.get(uid) ?? [])].map((id) => rangeBySprint.get(id)!);
    const expected = expectedStandupDays(ranges, year, month, today);
    const filedDays = filedByUser.get(uid) ?? new Set<string>();
    if (!filedDays.has(todayKey)) expected.delete(todayKey);
    let filed = 0;
    for (const day of expected) if (filedDays.has(day)) filed++;
    result.set(uid, { filed, expected: expected.size });
  }
  return result;
}
