import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { scoreToPercent } from "@/lib/score";
import { getISOWeek } from "@/lib/date";
import WeeklyDigest from "@/emails/WeeklyDigest";
import type { DigestKr, DigestDecision } from "@/emails/WeeklyDigest";

/**
 * GET /api/cron/weekly-digest
 * Triggered every Monday at 10:00 by Vercel Cron (after PO deadline at 09:00).
 * Sends a weekly OKR digest to Management and CEO.
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { weekNumber, year } = getISOWeek(new Date());

  const summary = { orgsProcessed: 0, sent: 0, failed: 0 };

  try {
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const org of organizations) {
      summary.orgsProcessed++;

      try {
        // Fetch all active KRs with scores
        const krs = await prisma.keyResult.findMany({
          where: { orgId: org.id, isActive: true },
          include: {
            objective: {
              include: {
                product: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
        });

        const totalKrs = krs.length;
        let onTrackCount = 0;
        let atRiskCount = 0;
        let blockedCount = 0;
        const blockedKrs: DigestKr[] = [];

        for (const kr of krs) {
          const pct = scoreToPercent(kr.score);
          const entityName =
            kr.objective.product?.name ??
            kr.objective.department?.name ??
            "—";

          if (kr.status === "ON_TRACK") onTrackCount++;
          else if (kr.status === "AT_RISK") atRiskCount++;
          else if (kr.status === "BLOCKED") {
            blockedCount++;
            blockedKrs.push({
              title: kr.title,
              entityName,
              scorePercent: pct,
              status: "BLOCKED",
            });
          }
        }

        // Also include AT_RISK KRs in the digest list (top 5)
        const atRiskKrs: DigestKr[] = krs
          .filter((kr) => kr.status === "AT_RISK")
          .map((kr) => ({
            title: kr.title,
            entityName:
              kr.objective.product?.name ??
              kr.objective.department?.name ??
              "—",
            scorePercent: scoreToPercent(kr.score),
            status: "AT_RISK" as const,
          }))
          .slice(0, 5);

        const digestKrs = [...blockedKrs, ...atRiskKrs];

        // Fetch open decisions
        const decisions = await prisma.decision.findMany({
          where: { orgId: org.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
          include: { owner: { select: { name: true } } },
          take: 10,
          orderBy: { createdAt: "desc" },
        });

        const pendingDecisions: DigestDecision[] = decisions.map((d) => ({
          title: d.title,
          ownerName: d.owner.name,
          dueDate: d.dueDate?.toISOString(),
        }));

        // Send to Management and CEO
        const managers = await prisma.user.findMany({
          where: {
            orgId: org.id,
            role: { in: ["CEO", "MANAGEMENT"] },
            isActive: true,
          },
          select: { id: true, name: true, email: true },
        });

        for (const manager of managers) {
          const result = await sendEmail({
            to: manager.email,
            subject: `Digest OKR — Semaine ${weekNumber} · ${totalKrs > 0 ? Math.round((onTrackCount / totalKrs) * 100) : 0}% en bonne voie`,
            react: React.createElement(WeeklyDigest, {
              recipientName: manager.name,
              weekNumber,
              year,
              totalKrs,
              onTrackCount,
              atRiskCount,
              blockedCount,
              blockedKrs: digestKrs,
              pendingDecisions,
            }),
          });

          await prisma.notification.create({
            data: {
              userId: manager.id,
              channel: "EMAIL",
              type: "WEEKLY_DIGEST",
              subject: `Digest OKR — Semaine ${weekNumber}`,
              body: `Digest hebdomadaire envoyé à ${manager.email}`,
              isSent: result.success,
              sentAt: result.success ? new Date() : null,
            },
          });

          if (result.success) summary.sent++;
          else {
            summary.failed++;
            console.error(
              `[cron/weekly-digest] Failed to send to ${manager.email}:`,
              result.error
            );
          }
        }
      } catch (orgErr) {
        summary.failed++;
        console.error(
          `[cron/weekly-digest] Error processing org ${org.id}:`,
          orgErr
        );
      }
    }

    console.log("[cron/weekly-digest] Completed:", summary);
    return Response.json({ ok: true, weekNumber, year, ...summary });
  } catch (err) {
    console.error("[cron/weekly-digest] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
