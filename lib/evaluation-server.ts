/**
 * Évaluations — accès aux données (DB). La logique de calcul pure vit dans
 * lib/evaluation.ts.
 */

import type { UserRole } from "@prisma/client";
import { prisma } from "./prisma";
import { computeDelivery, monthRange, type DeliveryStats } from "./evaluation";

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
