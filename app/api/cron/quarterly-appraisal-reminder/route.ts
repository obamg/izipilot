import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendPushToUser } from "@/lib/push";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import { evaluableSubjectIds } from "@/lib/appraisal-server";
import {
  quarterOfMonth,
  previousQuarter,
  totalAppraisalTasks,
  quarterLabel,
  type AppraisalTaskCounts,
} from "@/lib/appraisal";
import AppraisalReminder from "@/emails/AppraisalReminder";

const logger = log.child("cron/quarterly-appraisal-reminder");

/**
 * GET /api/cron/quarterly-appraisal-reminder
 * Fires the 5th of each quarter's first month (Jan/Apr/Jul/Oct, 07:00 WAT),
 * targeting the quarter that just ended (all its monthly evaluations exist).
 * One reminder per person summarising their pending appraisal actions:
 *   - manager: bilans to open for their team + bilans awaiting their assessment,
 *   - colleague: self-assessment to fill + shared bilan to sign.
 * Idempotent per quarter via an APPRAISAL_REMINDER notification. CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const curQuarter = quarterOfMonth(now.getUTCMonth() + 1);
  const { quarter: targetQuarter, year: targetYear } = previousQuarter(
    curQuarter,
    now.getUTCFullYear()
  );
  const label = quarterLabel(targetQuarter, targetYear);
  // Dedup window: any APPRAISAL_REMINDER since the start of the firing month.
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

      const [deptOwners, prodOwners, appraisals] = await Promise.all([
        prisma.department.findMany({ where: { orgId: org.id }, select: { ownerId: true } }),
        prisma.product.findMany({ where: { orgId: org.id }, select: { ownerId: true } }),
        prisma.appraisal.findMany({
          where: { orgId: org.id, quarter: targetQuarter, year: targetYear },
          select: { subjectId: true, managerId: true, status: true },
        }),
      ]);
      const ownerIds = new Set<string>([
        ...deptOwners.map((d) => d.ownerId),
        ...prodOwners.map((p) => p.ownerId),
      ]);

      // Index the quarter's appraisals.
      const statusBySubject = new Map<string, string>(); // unique per subject×quarter×year
      const subjectsWithAppraisal = new Set<string>();
      const toCompleteByManager = new Map<string, number>();
      for (const a of appraisals) {
        statusBySubject.set(a.subjectId, a.status);
        subjectsWithAppraisal.add(a.subjectId);
        if (a.status === "MANAGER_ASSESSMENT") {
          toCompleteByManager.set(a.managerId, (toCompleteByManager.get(a.managerId) ?? 0) + 1);
        }
      }

      // "To open" only for owners over their real team (not CEO/MANAGEMENT,
      // whose evaluable set is everyone — a useless 50-person nudge).
      const toOpenByOwner = new Map<string, number>();
      const owners = users.filter(
        (u) => u.role !== "CEO" && u.role !== "MANAGEMENT" && ownerIds.has(u.id)
      );
      for (const owner of owners) {
        const allowed = await evaluableSubjectIds(org.id, { id: owner.id, role: owner.role });
        if (allowed === "ALL") continue;
        const open = allowed.filter((sid) => !subjectsWithAppraisal.has(sid)).length;
        if (open > 0) toOpenByOwner.set(owner.id, open);
      }

      for (const u of users) {
        const subjStatus = statusBySubject.get(u.id);
        const counts: AppraisalTaskCounts = {
          toOpen: toOpenByOwner.get(u.id) ?? 0,
          toComplete: toCompleteByManager.get(u.id) ?? 0,
          selfPending: subjStatus === "SELF_ASSESSMENT" ? 1 : 0,
          signPending: subjStatus === "SHARED" ? 1 : 0,
        };
        if (totalAppraisalTasks(counts) === 0) {
          skipped++;
          continue;
        }

        // Idempotency — one reminder per person per quarter cycle.
        const already = await prisma.notification.findFirst({
          where: {
            userId: u.id,
            type: "APPRAISAL_REMINDER",
            createdAt: { gte: cycleStart },
            isSent: true,
          },
          select: { id: true },
        });
        if (already) {
          skipped++;
          continue;
        }

        const managerTasks = counts.toOpen + counts.toComplete;
        const href = managerTasks > 0 ? "/appraisals" : "/my-appraisals";

        const result = await sendEmail({
          to: u.email,
          subject: `Bilans ${label} — actions en attente`,
          react: React.createElement(AppraisalReminder, {
            name: u.name,
            quarter: targetQuarter,
            year: targetYear,
            counts,
            href,
          }),
        });

        await prisma.notification.create({
          data: {
            userId: u.id,
            channel: "EMAIL",
            type: "APPRAISAL_REMINDER",
            subject: `Bilans ${label}`,
            body: `Rappel envoyé à ${u.email} — ${totalAppraisalTasks(counts)} action(s) en attente pour ${label}`,
            isSent: result.success,
            sentAt: result.success ? new Date() : null,
          },
        });

        if (result.success) {
          sent++;
        } else {
          failed++;
          logger.error("failed to send appraisal reminder", {
            email: u.email,
            userId: u.id,
            reason: result.error,
          });
        }

        await sendPushToUser(u.id, {
          title: `Bilans ${label}`,
          body: `${totalAppraisalTasks(counts)} action(s) en attente sur vos bilans.`,
          url: href,
          tag: `appraisal-reminder:${targetYear}-${targetQuarter}`,
        });
      }
    }

    logger.info("run complete", { targetQuarter, targetYear, sent, skipped, failed });
    return Response.json({ ok: true, quarter: targetQuarter, year: targetYear, sent, skipped, failed });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
