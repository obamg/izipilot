import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { checkMissingEntries, checkEscalation48h } from "@/lib/alerts";
import { scoreToPercent } from "@/lib/score";
import { getISOWeek } from "@/lib/date";
import AlertBlocked from "@/emails/AlertBlocked";
import Escalation48h from "@/emails/Escalation48h";

/**
 * GET /api/cron/check-alerts
 * Triggered daily at 10:00 AM by Vercel Cron.
 * - Detects missing weekly entries and creates ENTRY_MISSING alerts.
 * - Detects KR_BLOCKED alerts older than 48h and creates ESCALATION_48H alerts.
 * - Emails Management/CEO for new ESCALATION_48H alerts.
 * - Emails Management/CEO for new KR_BLOCKED alerts (unnotified ones).
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  // ── Auth: verify cron secret ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const { weekNumber, year } = getISOWeek(now);

  const summary = {
    orgsProcessed: 0,
    missingEntries: 0,
    escalations: 0,
    blockedEmailsSent: 0,
    escalationEmailsSent: 0,
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
        // ── 1. Check missing weekly entries ─────────────────────────────────
        const missingCount = await checkMissingEntries(
          org.id,
          weekNumber,
          year
        );
        summary.missingEntries += missingCount;

        // ── 2. Check and escalate 48h blocked alerts ────────────────────────
        const escalationCount = await checkEscalation48h(org.id);
        summary.escalations += escalationCount;

        // ── 3. Email Management/CEO for new ESCALATION_48H alerts ──────────
        const escalationAlerts = await prisma.alert.findMany({
          where: {
            orgId: org.id,
            type: "ESCALATION_48H",
            isResolved: false,
            // Find those created today (within the last 2 hours — cron window)
            createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
          include: {
            keyResult: {
              include: {
                objective: {
                  include: { product: true, department: true },
                },
              },
            },
          },
        });

        if (escalationAlerts.length > 0) {
          const managers = await getManagers(org.id);

          for (const alert of escalationAlerts) {
            const kr = alert.keyResult;
            const entityName =
              kr.objective.product?.name ??
              kr.objective.department?.name ??
              "Unknown";
            const scorePercent = scoreToPercent(kr.score);

            for (const manager of managers) {
              const result = await sendEmail({
                to: manager.email,
                subject: `ESCALADE: ${kr.title} bloqué depuis +48h`,
                react: React.createElement(Escalation48h, {
                  recipientName: manager.name,
                  krTitle: kr.title,
                  scorePercent,
                  entityName,
                  blockedSince: alert.createdAt.toISOString(),
                }),
              });

              await prisma.notification.create({
                data: {
                  userId: manager.id,
                  alertId: alert.id,
                  channel: "EMAIL",
                  type: "ESCALATION_48H",
                  subject: `ESCALADE: ${kr.title} bloqué depuis +48h`,
                  body: `Escalade 48h envoyée à ${manager.email} pour KR "${kr.title}"`,
                  isSent: result.success,
                  sentAt: result.success ? new Date() : null,
                },
              });

              if (result.success) {
                summary.escalationEmailsSent++;
              } else {
                summary.errors++;
                console.error(
                  `[cron/check-alerts] Failed escalation email to ${manager.email}:`,
                  result.error
                );
              }
            }
          }
        }

        // ── 4. Email Management/CEO for unnotified KR_BLOCKED alerts ────────
        const blockedAlerts = await getUnnotifiedBlockedAlerts(org.id);

        if (blockedAlerts.length > 0) {
          const managers = await getManagers(org.id);

          for (const alert of blockedAlerts) {
            const kr = alert.keyResult;
            const entityName =
              kr.objective.product?.name ??
              kr.objective.department?.name ??
              "Unknown";
            const scorePercent = scoreToPercent(kr.score);

            for (const manager of managers) {
              const result = await sendEmail({
                to: manager.email,
                subject: `KR BLOQUÉ: ${kr.title} (${scorePercent}%)`,
                react: React.createElement(AlertBlocked, {
                  recipientName: manager.name,
                  krTitle: kr.title,
                  scorePercent,
                  entityName,
                  alertMessage: alert.message,
                }),
              });

              await prisma.notification.create({
                data: {
                  userId: manager.id,
                  alertId: alert.id,
                  channel: "EMAIL",
                  type: "KR_BLOCKED_ALERT",
                  subject: `KR BLOQUÉ: ${kr.title}`,
                  body: `Alerte KR bloqué envoyée à ${manager.email} pour "${kr.title}"`,
                  isSent: result.success,
                  sentAt: result.success ? new Date() : null,
                },
              });

              if (result.success) {
                summary.blockedEmailsSent++;
              } else {
                summary.errors++;
                console.error(
                  `[cron/check-alerts] Failed blocked email to ${manager.email}:`,
                  result.error
                );
              }
            }
          }
        }
      } catch (orgErr) {
        summary.errors++;
        console.error(
          `[cron/check-alerts] Error processing org ${org.id}:`,
          orgErr
        );
      }
    }

    console.log("[cron/check-alerts] Completed:", summary);
    return Response.json({ ok: true, weekNumber, year, ...summary });
  } catch (err) {
    console.error("[cron/check-alerts] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch Management and CEO users for an org (email recipients for alerts).
 */
async function getManagers(orgId: string) {
  return prisma.user.findMany({
    where: {
      orgId,
      role: { in: ["CEO", "MANAGEMENT"] },
      isActive: true,
    },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Find KR_BLOCKED alerts that have not yet been emailed to Management
 * (no EMAIL notification of type KR_BLOCKED_ALERT linked to this alert).
 */
async function getUnnotifiedBlockedAlerts(orgId: string) {
  return prisma.alert.findMany({
    where: {
      orgId,
      type: "KR_BLOCKED",
      isResolved: false,
      // No EMAIL notification sent yet for this alert
      notifications: {
        none: {
          channel: "EMAIL",
          type: "KR_BLOCKED_ALERT",
          isSent: true,
        },
      },
    },
    include: {
      keyResult: {
        include: {
          objective: {
            include: { product: true, department: true },
          },
        },
      },
    },
  });
}

