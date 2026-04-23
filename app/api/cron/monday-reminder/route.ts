import { NextRequest } from "next/server";
import * as React from "react";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getISOWeek } from "@/lib/date";
import WeeklyReminder from "@/emails/WeeklyReminder";

/**
 * GET /api/cron/monday-reminder
 * Triggered every Monday at 08:30 by Vercel Cron.
 * Sends a weekly review reminder to all active POs.
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  // ── Auth: verify cron secret ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Compute current ISO week ──────────────────────────────────────────────
  const now = new Date();
  const { weekNumber, year } = getISOWeek(now);

  try {
    // ── Fetch all active organisations ────────────────────────────────────
    const organizations = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    let totalSent = 0;
    let totalFailed = 0;

    for (const org of organizations) {
      // ── Fetch active POs in this org ────────────────────────────────────
      const pos = await prisma.user.findMany({
        where: { orgId: org.id, role: "PO", isActive: true },
        select: { id: true, name: true, email: true },
      });

      for (const po of pos) {
        // Send email
        const result = await sendEmail({
          to: po.email,
          subject: `Rappel OKR — Soumettez votre revue avant 09h00 (Semaine ${weekNumber})`,
          react: React.createElement(WeeklyReminder, {
            name: po.name,
            weekNumber,
            year,
          }),
        });

        // Persist Notification record
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
          console.error(
            `[cron/monday-reminder] Failed to send to ${po.email}:`,
            result.error
          );
        }
      }
    }

    console.log(
      `[cron/monday-reminder] Week ${weekNumber}/${year} — sent: ${totalSent}, failed: ${totalFailed}`
    );

    return Response.json({
      ok: true,
      weekNumber,
      year,
      sent: totalSent,
      failed: totalFailed,
    });
  } catch (err) {
    console.error("[cron/monday-reminder] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

