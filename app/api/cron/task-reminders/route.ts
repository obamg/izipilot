import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import { filterRecipientsByPref } from "@/lib/notification-prefs";
import { watDateOnly, watDayStartUtc, toDateKey } from "@/lib/standup";
import { canSeeManagementOkrs, sprintTaskVisibilityWhere } from "@/lib/visibility";
import {
  nextWindowEnd,
  personalMessage,
  personalReminders,
  teamMessage,
  type ReminderTask,
} from "@/lib/task-reminders";
import type { NotificationType } from "@prisma/client";

const logger = log.child("cron/task-reminders");

type Stats = { personal: number; team: number; pushed: number; skipped: number };

/**
 * GET /api/cron/task-reminders
 * Jours ouvrés (lun–ven) 09h WAT = 08h UTC. Une seule notification par
 * personne : ses tâches en retard, à rendre aujourd'hui et au prochain jour
 * ouvré. Plus un résumé des tâches en retard de son équipe à chaque
 * responsable (propriétaire du département ou du produit, ou LEAD).
 * Push uniquement, préférence « Échéances et retards », une fois par jour WAT.
 * Mêmes règles de visibilité que le tableau (tâches D7 masquées hors direction).
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = watDateOnly(now);
  const dayStart = watDayStartUtc(now);
  const dateKey = toDateKey(today);
  const stats: Stats = { personal: 0, team: 0, pushed: 0, skipped: 0 };

  try {
    const orgs = await prisma.organization.findMany({ where: { isActive: true }, select: { id: true } });

    for (const org of orgs) {
      const open = {
        orgId: org.id,
        status: { notIn: ["DONE" as const, "CANCELLED" as const] },
        dueDate: { not: null, lt: nextWindowEnd(today) },
      };
      const [rows, restrictedVisible, users, departments, products] = await Promise.all([
        prisma.sprintTask.findMany({
          where: open,
          select: { id: true, title: true, dueDate: true, assigneeId: true, departmentId: true, productId: true },
        }),
        // Ce qu'un rôle hors direction a le droit de voir (D7 masqué).
        prisma.sprintTask.findMany({
          where: { ...open, ...sprintTaskVisibilityWhere("PO") },
          select: { id: true },
        }),
        prisma.user.findMany({
          where: { orgId: org.id, isActive: true, role: { not: "VIEWER" } },
          select: { id: true, role: true },
        }),
        prisma.department.findMany({
          where: { orgId: org.id },
          select: { id: true, name: true, ownerId: true, members: { where: { role: "LEAD" }, select: { userId: true } } },
        }),
        prisma.product.findMany({ where: { orgId: org.id }, select: { id: true, name: true, ownerId: true } }),
      ]);
      const tasks = rows.filter((t): t is typeof t & ReminderTask => t.dueDate !== null);
      if (tasks.length === 0) continue;

      const visibleToAll = new Set(restrictedVisible.map((t) => t.id));
      const roleOf = new Map(users.map((u) => [u.id, u.role]));
      const visibleFor = <T extends { id: string }>(userId: string, list: T[]) =>
        canSeeManagementOkrs(roleOf.get(userId)!) ? list : list.filter((t) => visibleToAll.has(t.id));

      // ── Rappel personnel ───────────────────────────────────────────────────
      const assignees = [...new Set(tasks.map((t) => t.assigneeId))].filter(
        (id): id is string => id !== null && roleOf.has(id),
      );
      const people = await filterRecipientsByPref(assignees.map((id) => ({ id })), "taskDue");
      for (const { id } of people) {
        const mine = personalReminders(visibleFor(id, tasks.filter((t) => t.assigneeId === id)), today).get(id);
        if (!mine) continue;
        await deliver(id, "TASK_DUE_REMINDER", personalMessage(mine, today), `task-due:${dateKey}`, dayStart, stats, "personal");
      }

      // ── Résumé des retards pour les responsables ──────────────────────────
      const overdue = tasks.filter((t) => t.dueDate < today);
      if (overdue.length === 0) continue;
      const teams = [
        ...departments.map((d) => ({
          name: d.name,
          leads: new Set([d.ownerId, ...d.members.map((m) => m.userId)]),
          tasks: overdue.filter((t) => t.departmentId === d.id),
        })),
        ...products.map((p) => ({
          name: p.name,
          leads: new Set([p.ownerId]),
          tasks: overdue.filter((t) => t.productId === p.id),
        })),
      ].filter((t) => t.tasks.length > 0);

      const leadIds = [...new Set(teams.flatMap((t) => [...t.leads]))].filter((id) => roleOf.has(id));
      const leads = await filterRecipientsByPref(leadIds.map((id) => ({ id })), "taskDue");
      for (const { id } of leads) {
        const mineTeams = teams
          .filter((t) => t.leads.has(id))
          .map((t) => ({ name: t.name, overdue: visibleFor(id, t.tasks).length }))
          .filter((t) => t.overdue > 0);
        if (mineTeams.length === 0) continue;
        await deliver(id, "TASK_OVERDUE_TEAM", teamMessage(mineTeams), `task-team:${dateKey}`, dayStart, stats, "team");
      }
    }

    logger.info("run complete", { dateKey, ...stats });
    return Response.json({ ok: true, date: dateKey, ...stats });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Envoie une fois par jour WAT et par type (marqueur en base = dédoublonnage). */
async function deliver(
  userId: string,
  type: NotificationType,
  msg: { title: string; body: string },
  tag: string,
  dayStart: Date,
  stats: Stats,
  kind: "personal" | "team",
) {
  const already = await prisma.notification.findFirst({
    where: { userId, type, createdAt: { gte: dayStart } },
    select: { id: true },
  });
  if (already) {
    stats.skipped++;
    return;
  }
  const push = await sendPushToUser(userId, { ...msg, url: "/sprints", tag });
  await prisma.notification.create({
    data: {
      userId,
      channel: "IN_APP",
      type,
      subject: msg.title,
      body: msg.body,
      isSent: push.sent > 0,
      sentAt: push.sent > 0 ? new Date() : null,
    },
  });
  stats[kind]++;
  if (push.sent > 0) stats.pushed++;
}
