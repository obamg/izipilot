import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import { filterRecipientsByPref } from "@/lib/notification-prefs";
import { watDateOnly, watDayStartUtc, toDateKey } from "@/lib/standup";
import { pendingStandupTargets, type SprintRoster } from "@/lib/daily-report";
import DailyReportReminder from "@/emails/DailyReportReminder";

const logger = log.child("cron/daily-report-reminder");

const APP_URL = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "https://izipilote.com";

/**
 * GET /api/cron/daily-report-reminder
 * Fires every working day (Mon–Fri) at 09:00 WAT (08:00 UTC). Reminds every
 * member of an ACTIVE sprint (task assignees + capacity members) who has not
 * yet filed today's daily report (standup) to do so. Skips VIEWERs, users who
 * already reported everywhere, and anyone who opted out. Idempotent per WAT day
 * via the DAILY_REPORT_REMINDER notification. Secured by CRON_SECRET.
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

    let sent = 0;
    let skipped = 0;
    let failed = 0;

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
        // Idempotency — one reminder per user per WAT day.
        const already = await prisma.notification.findFirst({
          where: {
            userId: target.id,
            type: "DAILY_REPORT_REMINDER",
            createdAt: { gte: dayStart },
            isSent: true,
          },
          select: { id: true },
        });
        if (already) {
          skipped++;
          continue;
        }

        const first = target.sprints[0];
        const sprintCount = target.sprints.length;
        const href = `${APP_URL}/sprints/${first.sprintId}`;

        const result = await sendEmail({
          to: target.email,
          subject: `Rapport quotidien du ${dateLabel} — à remplir`,
          react: React.createElement(DailyReportReminder, {
            name: target.name,
            dateLabel,
            sprintName: first.sprintName,
            sprintCount,
            href,
          }),
        });

        await prisma.notification.create({
          data: {
            userId: target.id,
            channel: "EMAIL",
            type: "DAILY_REPORT_REMINDER",
            subject: `Rapport quotidien du ${dateLabel}`,
            body: `Rappel envoyé à ${target.email} — ${sprintCount} sprint(s) actif(s) en attente le ${dateKey}`,
            isSent: result.success,
            sentAt: result.success ? new Date() : null,
          },
        });

        if (result.success) {
          sent++;
        } else {
          failed++;
          logger.error("failed to send daily report reminder", {
            email: target.email,
            userId: target.id,
            reason: result.error,
          });
        }

        await sendPushToUser(target.id, {
          title: "Rapport quotidien",
          body:
            sprintCount > 1
              ? `${sprintCount} sprints actifs en attente de votre point du jour.`
              : `Pensez à remplir votre rapport quotidien.`,
          url: `/sprints/${first.sprintId}`,
          tag: `daily-report:${dateKey}`,
        });
      }
    }

    logger.info("run complete", { dateKey, sent, skipped, failed });
    return Response.json({ ok: true, date: dateKey, sent, skipped, failed });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
