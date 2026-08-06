import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import { evaluableSubjectIds } from "@/lib/evaluation-server";
import { MONTH_LABELS_FR } from "@/lib/evaluation";
import EvalReminder from "@/emails/EvalReminder";

const logger = log.child("cron/monthly-eval-reminder");

/**
 * GET /api/cron/monthly-eval-reminder
 * Fires on the 1st of each month (07:00 WAT / 06:00 UTC). Reminds every
 * evaluator (CEO/MANAGEMENT + department/product owners) to evaluate their
 * team for the PREVIOUS month — the one that just ended, so delivery data is
 * complete. Skips evaluators who have already rated everyone. Idempotent per
 * calendar month via the EVAL_REMINDER notification. Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Previous month. getUTCMonth() is the 0-based current month, which equals
  // the 1-based previous month — except January (0), which wraps to December.
  let targetMonth = now.getUTCMonth();
  let targetYear = now.getUTCFullYear();
  if (targetMonth === 0) {
    targetMonth = 12;
    targetYear -= 1;
  }
  const monthLabel = MONTH_LABELS_FR[targetMonth - 1];

  // Dedup window: any EVAL_REMINDER already sent since the start of the current
  // calendar month means we've reminded this evaluator this cycle.
  const cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const org of orgs) {
      const users = await prisma.user.findMany({
        where: { orgId: org.id, isActive: true },
        select: { id: true, name: true, email: true, role: true },
      });
      const allIds = users.map((u) => u.id);

      const [deptOwners, prodOwners] = await Promise.all([
        prisma.department.findMany({ where: { orgId: org.id }, select: { ownerId: true } }),
        prisma.product.findMany({ where: { orgId: org.id }, select: { ownerId: true } }),
      ]);
      const ownerIds = new Set<string>([
        ...deptOwners.map((d) => d.ownerId),
        ...prodOwners.map((p) => p.ownerId),
      ]);

      const evaluators = users.filter(
        (u) => u.role === "CEO" || u.role === "MANAGEMENT" || ownerIds.has(u.id)
      );

      for (const ev of evaluators) {
        const allowed = await evaluableSubjectIds(org.id, { id: ev.id, role: ev.role });
        const subjectIds = allowed === "ALL" ? allIds.filter((id) => id !== ev.id) : allowed;
        if (subjectIds.length === 0) {
          skipped++;
          continue;
        }

        const doneCount = await prisma.evaluation.count({
          where: {
            evaluatorId: ev.id,
            periodMonth: targetMonth,
            periodYear: targetYear,
            subjectId: { in: subjectIds },
          },
        });
        const remaining = subjectIds.length - doneCount;
        if (remaining <= 0) {
          skipped++;
          continue;
        }

        // Idempotency — don't double-remind within the same month.
        const already = await prisma.notification.findFirst({
          where: {
            userId: ev.id,
            type: "EVAL_REMINDER",
            createdAt: { gte: cycleStart },
            isSent: true,
          },
          select: { id: true },
        });
        if (already) {
          skipped++;
          continue;
        }

        const result = await sendEmail({
          to: ev.email,
          subject: `Évaluations ${monthLabel} ${targetYear} — ${remaining} collègue(s) à noter`,
          react: React.createElement(EvalReminder, {
            name: ev.name,
            monthLabel,
            year: targetYear,
            remaining,
            total: subjectIds.length,
          }),
        });

        await prisma.notification.create({
          data: {
            userId: ev.id,
            channel: "EMAIL",
            type: "EVAL_REMINDER",
            subject: `Évaluations ${monthLabel} ${targetYear}`,
            body: `Rappel envoyé à ${ev.email} — ${remaining}/${subjectIds.length} à évaluer pour ${monthLabel} ${targetYear}`,
            isSent: result.success,
            sentAt: result.success ? new Date() : null,
          },
        });

        if (result.success) {
          sent++;
        } else {
          failed++;
          logger.error("failed to send eval reminder", {
            email: ev.email,
            userId: ev.id,
            reason: result.error,
          });
        }

        await sendPushToUser(ev.id, {
          title: `Évaluations ${monthLabel} ${targetYear}`,
          body: `${remaining} collègue(s) à évaluer.`,
          url: "/evaluations",
          tag: `eval-reminder:${targetYear}-${targetMonth}`,
        });
      }
    }

    logger.info("run complete", { targetMonth, targetYear, sent, skipped, failed });
    return Response.json({ ok: true, targetMonth, targetYear, sent, skipped, failed });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
