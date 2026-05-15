import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getISOWeek, getISOWeekStart } from "@/lib/date";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import WeeklyReminder from "@/emails/WeeklyReminder";

const logger = log.child("cron/weekly-reminder");

/**
 * GET /api/cron/weekly-reminder
 * Triggered every Sunday at 20:00 WAT (19:00 UTC).
 * Sends a weekly-review reminder to all active POs ~4h before the
 * Sunday 23:59 submission deadline. Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Compute current ISO week ──────────────────────────────────────────────
  const now = new Date();
  const { weekNumber, year } = getISOWeek(now);
  // Used to dedup: any WEEKLY_REMINDER notification created on or after the
  // Monday of this ISO week means we already reminded this user this week.
  const weekStart = getISOWeekStart(year, weekNumber);

  try {
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const org of organizations) {
      const pos = await prisma.user.findMany({
        where: { orgId: org.id, role: "PO", isActive: true },
        select: { id: true, name: true, email: true },
      });

      for (const po of pos) {
        // Idempotency: if a WEEKLY_REMINDER notification already exists for
        // this PO this ISO week, skip — the cron is being re-run after a
        // partial success, a manual trigger, or a retry.
        const alreadySent = await prisma.notification.findFirst({
          where: {
            userId: po.id,
            type: "WEEKLY_REMINDER",
            createdAt: { gte: weekStart },
            isSent: true,
          },
          select: { id: true },
        });
        if (alreadySent) {
          totalSkipped++;
          continue;
        }

        const result = await sendEmail({
          to: po.email,
          subject: `Rappel OKR — Soumettez votre revue avant dimanche 23h59 (Semaine ${weekNumber})`,
          react: React.createElement(WeeklyReminder, {
            name: po.name,
            weekNumber,
            year,
          }),
        });

        await prisma.notification.create({
          data: {
            userId: po.id,
            channel: "EMAIL",
            type: "WEEKLY_REMINDER",
            subject: `Rappel OKR — Semaine ${weekNumber}`,
            body: `Rappel envoyé à ${po.email} pour la semaine ${weekNumber}/${year}`,
            isSent: result.success,
            sentAt: result.success ? new Date() : null,
          },
        });

        if (result.success) {
          totalSent++;
        } else {
          totalFailed++;
          logger.error("failed to send reminder", {
            email: po.email,
            userId: po.id,
            weekNumber,
            year,
            reason: result.error,
          });
        }
      }
    }

    logger.info("run complete", {
      weekNumber,
      year,
      sent: totalSent,
      skipped: totalSkipped,
      failed: totalFailed,
    });

    return Response.json({
      ok: true,
      weekNumber,
      year,
      sent: totalSent,
      skipped: totalSkipped,
      failed: totalFailed,
    });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

