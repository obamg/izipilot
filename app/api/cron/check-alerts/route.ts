import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkMissingEntries, checkEscalation48h } from "@/lib/alerts";
import { getISOWeek, getPreviousISOWeek } from "@/lib/date";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";

const logger = log.child("cron/check-alerts");

/**
 * GET /api/cron/check-alerts
 * Triggered daily at 10:00 AM by Vercel Cron.
 * - Detects missing weekly entries and creates ENTRY_MISSING alerts.
 * - Detects KR_BLOCKED alerts older than 48h and creates ESCALATION_48H alerts.
 *
 * Email notifications are intentionally NOT sent here: only manual alerts
 * (POST /api/alerts) trigger emails to Management/CEO. Automatic alerts
 * remain visible in the alerts dashboard.
 *
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Missing-entry alerts target the most-recently-completed ISO week (i.e.
  // the one whose Sunday 23:59 deadline has already passed). The current ISO
  // week's deadline is always upcoming, so flagging it would produce a flood
  // of false positives every Monday morning.
  const current = getISOWeek(now);
  const { weekNumber, year } = getPreviousISOWeek(
    current.year,
    current.weekNumber
  );

  const summary = {
    orgsProcessed: 0,
    missingEntries: 0,
    escalations: 0,
    errors: 0,
  };

  try {
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const org of organizations) {
      summary.orgsProcessed++;

      try {
        const missingCount = await checkMissingEntries(
          org.id,
          weekNumber,
          year
        );
        summary.missingEntries += missingCount;

        const escalationCount = await checkEscalation48h(org.id);
        summary.escalations += escalationCount;
      } catch (orgErr) {
        summary.errors++;
        logger.error("org processing failed", { orgId: org.id }, orgErr);
      }
    }

    logger.info("run complete", { weekNumber, year, ...summary });
    return Response.json({ ok: true, weekNumber, year, ...summary });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
