/**
 * Côté base du suivi des membres. La règle vit dans `lib/member-compliance.ts`
 * (pure) ; ici on ne fait que rassembler les faits.
 *
 * Source unique pour les deux usages — la porte qui bloque un membre et le
 * tableau qui les liste tous — pour que le management ne puisse jamais voir
 * autre chose que ce que les intéressés vivent.
 */

import { prisma } from "@/lib/prisma";
import { watDateOnly } from "@/lib/standup";
import {
  evaluateMember,
  isStandupDue,
  type MemberCompliance,
} from "@/lib/member-compliance";

export interface MemberRow extends MemberCompliance {
  userId: string;
  userName: string;
  role: string;
  assignedCount: number;
  inProgressCount: number;
  hasStandupToday: boolean;
}

/** Le sprint actif de l'org, ou null. Sans lui, aucune règle ne s'applique. */
async function activeSprintId(orgId: string): Promise<string | null> {
  const s = await prisma.sprint.findFirst({
    where: { orgId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { number: "desc" },
  });
  return s?.id ?? null;
}

/**
 * L'état d'une seule personne — ce que lit la porte à chaque chargement de
 * page. Volontairement étroit : trois compteurs, pas de jointure large.
 */
export async function evaluateOneMember(
  orgId: string,
  userId: string,
  role: string,
  now: Date = new Date()
): Promise<MemberCompliance & { sprintId: string | null }> {
  if (role === "VIEWER") {
    return { issues: [], blocking: false, sprintId: null };
  }

  const sprintId = await activeSprintId(orgId);
  if (!sprintId) return { issues: [], blocking: false, sprintId: null };

  const [assignedCount, inProgressCount, startableCount, standupCount, participates] =
    await Promise.all([
      prisma.sprintTask.count({
        where: { orgId, sprintId, assigneeId: userId, status: { not: "CANCELLED" } },
      }),
      prisma.sprintTask.count({
        where: { orgId, sprintId, assigneeId: userId, status: "IN_PROGRESS" },
      }),
      // Ce que l'écran de blocage pourra réellement proposer de démarrer.
      prisma.sprintTask.count({
        where: {
          orgId,
          sprintId,
          assigneeId: userId,
          status: { in: ["TODO", "BLOCKED"] },
        },
      }),
      prisma.standupEntry.count({
        where: { orgId, userId, date: watDateOnly(now) },
      }),
      prisma.sprintCapacity.count({ where: { orgId, sprintId, userId } }),
    ]);

  // Hors du sprint : ni tâche, ni capacité. On ne demande rien à quelqu'un
  // qu'on n'a pas embarqué — même périmètre que le cron de rappel.
  if (assignedCount === 0 && participates === 0) {
    return { issues: [], blocking: false, sprintId };
  }

  return {
    ...evaluateMember({
      assignedCount,
      inProgressCount,
      startableCount,
      hasStandupToday: standupCount > 0,
      standupDue: isStandupDue(now),
    }),
    sprintId,
  };
}

/** Le tableau complet, pour le management. */
export async function evaluateAllMembers(
  orgId: string,
  now: Date = new Date()
): Promise<{ rows: MemberRow[]; sprintId: string | null; standupDue: boolean }> {
  const sprintId = await activeSprintId(orgId);
  const standupDue = isStandupDue(now);
  if (!sprintId) return { rows: [], sprintId: null, standupDue };

  const [users, tasks, capacities, standups] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, isActive: true, role: { not: "VIEWER" } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.sprintTask.findMany({
      where: { orgId, sprintId, assigneeId: { not: null }, status: { not: "CANCELLED" } },
      select: { assigneeId: true, status: true },
    }),
    prisma.sprintCapacity.findMany({
      where: { orgId, sprintId },
      select: { userId: true },
    }),
    prisma.standupEntry.findMany({
      where: { orgId, date: watDateOnly(now) },
      select: { userId: true },
    }),
  ]);

  const assigned = new Map<string, number>();
  const ongoing = new Map<string, number>();
  const startable = new Map<string, number>();
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    assigned.set(t.assigneeId, (assigned.get(t.assigneeId) ?? 0) + 1);
    if (t.status === "IN_PROGRESS") {
      ongoing.set(t.assigneeId, (ongoing.get(t.assigneeId) ?? 0) + 1);
    } else if (t.status === "TODO" || t.status === "BLOCKED") {
      startable.set(t.assigneeId, (startable.get(t.assigneeId) ?? 0) + 1);
    }
  }
  const inSprint = new Set<string>([
    ...assigned.keys(),
    ...capacities.map((c) => c.userId),
  ]);
  const filed = new Set(standups.map((s) => s.userId));

  const rows: MemberRow[] = users
    .filter((u) => inSprint.has(u.id))
    .map((u) => {
      const assignedCount = assigned.get(u.id) ?? 0;
      const inProgressCount = ongoing.get(u.id) ?? 0;
      const startableCount = startable.get(u.id) ?? 0;
      const hasStandupToday = filed.has(u.id);
      return {
        userId: u.id,
        userName: u.name,
        role: u.role,
        assignedCount,
        inProgressCount,
        hasStandupToday,
        ...evaluateMember({
          assignedCount,
          inProgressCount,
          startableCount,
          hasStandupToday,
          standupDue,
        }),
      };
    });

  // Les manquements d'abord — un tableau de contrôle se lit par ce qui cloche.
  rows.sort((a, b) => {
    if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
    return a.userName.localeCompare(b.userName, "fr");
  });

  return { rows, sprintId, standupDue };
}
