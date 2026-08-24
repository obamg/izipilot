import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronSecret } from "@/lib/cron";
import { log } from "@/lib/log";
import { OPEN_STATUSES, hoursBetween } from "@/lib/support-request";
import { supportRecipients, supportRequestInclude } from "@/lib/support-request-server";
import { notifySupportRequest } from "@/lib/support-notify";

const logger = log.child("cron/overdue-support-requests");

/** Une relance par demande toutes les 24 h — au-delà c'est du harcèlement. */
const RENOTIFY_AFTER_MS = 24 * 3_600_000;

/**
 * GET /api/cron/overdue-support-requests
 * Quotidien (09h00 WAT). Relance le guichet sur les demandes encore ouvertes
 * dont l'échéance est dépassée. Dédup via `lastOverdueNotifiedAt` : une demande
 * qui traîne une semaine génère 7 relances, pas 7 × le nombre de runs.
 * Protégé par CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const renotifyBefore = new Date(now.getTime() - RENOTIFY_AFTER_MS);

  try {
    const overdue = await prisma.supportRequest.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        dueAt: { not: null, lt: now },
        OR: [{ lastOverdueNotifiedAt: null }, { lastOverdueNotifiedAt: { lt: renotifyBefore } }],
        org: { isActive: true },
      },
      include: supportRequestInclude,
      orderBy: { dueAt: "asc" },
    });

    let notified = 0;
    let skipped = 0;

    for (const req of overdue) {
      const recipients = await supportRecipients(
        req.orgId,
        req.departmentId,
        req.assigneeId
      );
      if (recipients.length === 0) {
        // Guichet sans support ni responsable joignable — rien à relancer, mais
        // on marque quand même pour ne pas rescanner la demande chaque jour.
        await prisma.supportRequest.update({
          where: { id: req.id },
          data: { lastOverdueNotifiedAt: now },
        });
        skipped++;
        continue;
      }

      const lateHours = req.dueAt ? hoursBetween(req.dueAt, now) : 0;
      const lateLabel =
        lateHours < 24
          ? `${Math.round(lateHours)} h`
          : `${Math.floor(lateHours / 24)} jour(s)`;

      await notifySupportRequest({
        kind: "OVERDUE",
        request: req,
        recipients,
        message: `Échéance dépassée de ${lateLabel}.`,
      });

      await prisma.supportRequest.update({
        where: { id: req.id },
        data: { lastOverdueNotifiedAt: now },
      });
      notified++;
    }

    logger.info("run complete", { candidates: overdue.length, notified, skipped });
    return Response.json({ ok: true, candidates: overdue.length, notified, skipped });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
