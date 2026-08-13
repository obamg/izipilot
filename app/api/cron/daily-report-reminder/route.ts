import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import { filterRecipientsByPref } from "@/lib/notification-prefs";
import { watDateOnly, watDayStartUtc, toDateKey } from "@/lib/standup";
import { pendingStandupTargets, type SprintRoster } from "@/lib/daily-report";

const logger = log.child("cron/daily-report-reminder");

/**
 * GET /api/cron/daily-report-reminder
 * Fires every working day (Mon–Fri) at 09:00 WAT (08:00 UTC). Reminds every
 * member of an ACTIVE sprint (task assignees + capacity members) who has not
 * yet filed today's daily report (standup) to do so. Skips VIEWERs, users who
 * already reported everywhere, and anyone who opted out.
 *
 * Delivery is WEB PUSH ONLY — no email, by design (daily email volume is
 * costly). Users who haven't enabled browser notifications simply aren't
 * reached; the in-app nudge drives adoption. Idempotent per WAT day via a
 * DAILY_REPORT_REMINDER notification row (dedup/audit marker, not user-facing).
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const standupDate = watDateOnly(now); // UTC-midnight of the WAT day (pairs with @db.Date)
  const dayStart = watDayStartUtc(now); // real UTC instant of WAT 00:00 — dedup threshold
  const dateKey = toDateKey(standupDate);
  const dateLabel = standupDate.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let notified = 0; // reminder recorded for this user
    let pushed = 0; // push reached at least one device
    let skipped = 0; // already reminded today (dedup)

    for (const org of orgs) {
      const sprints = await prisma.sprint.findMany({
        where: { orgId: org.id, status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          tasks: { select: { assigneeId: true } },
          capacities: { select: { userId: true } },
          standups: { where: { date: standupDate }, select: { userId: true } },
        },
      });
      if (sprints.length === 0) continue;

      const rosters: SprintRoster[] = sprints.map((s) => {
        const memberIds = new Set<string>();
        for (const t of s.tasks) if (t.assigneeId) memberIds.add(t.assigneeId);
        for (const c of s.capacities) memberIds.add(c.userId);
        return {
          sprintId: s.id,
          sprintName: s.name,
          memberIds: [...memberIds],
          submittedIds: s.standups.map((e) => e.userId),
        };
      });

      // Eligible = active, non-VIEWER members of this org (VIEWER is read-only).
      const users = await prisma.user.findMany({
        where: { orgId: org.id, isActive: true },
        select: { id: true, name: true, email: true, role: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));
      const eligibleIds = new Set(
        users.filter((u) => u.role !== "VIEWER").map((u) => u.id)
      );

      const targets = pendingStandupTargets(rosters, eligibleIds);
      if (targets.length === 0) continue;

      // Respect each user's opt-out for the daily reminder.
      const targetUsers = targets
        .map((t) => {
          const u = userMap.get(t.userId);
          return u ? { ...u, sprints: t.sprints } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const opted = await filterRecipientsByPref(targetUsers, "dailyReportReminder");

      for (const target of opted) {
        // Idempotency — one reminder per user per WAT day (regardless of
        // whether the push reached a device, so re-runs don't re-notify).
        const already = await prisma.notification.findFirst({
          where: {
            userId: target.id,
            type: "DAILY_REPORT_REMINDER",
            createdAt: { gte: dayStart },
          },
          select: { id: true },
        });
        if (already) {
          skipped++;
          continue;
        }

        const first = target.sprints[0];
        const sprintCount = target.sprints.length;

        const push = await sendPushToUser(target.id, {
          title: "Rapport quotidien",
          body:
            sprintCount > 1
              ? `${sprintCount} sprints actifs en attente de votre point du jour.`
              : `Pensez à remplir votre rapport quotidien.`,
          url: `/sprints/${first.sprintId}`,
          tag: `daily-report:${dateKey}`,
        });

        // Per-day dedup marker + audit log (push-only; not user-facing).
        await prisma.notification.create({
          data: {
            userId: target.id,
            channel: "IN_APP",
            type: "DAILY_REPORT_REMINDER",
            subject: `Rapport quotidien du ${dateLabel}`,
            body: `Push à ${target.name} — ${sprintCount} sprint(s) actif(s) le ${dateKey} (${push.sent} device(s))`,
            isSent: push.sent > 0,
            sentAt: push.sent > 0 ? new Date() : null,
          },
        });

        notified++;
        if (push.sent > 0) pushed++;
        if (push.failed > 0) {
          logger.warn("push had failures", { userId: target.id, failed: push.failed });
        }
      }
    }

    logger.info("run complete", { dateKey, notified, pushed, skipped });
    return Response.json({ ok: true, date: dateKey, notified, pushed, skipped });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
