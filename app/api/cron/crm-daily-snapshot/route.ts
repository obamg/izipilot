import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { captureCrmSnapshots } from "@/lib/crm-snapshot";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";

const logger = log.child("cron/crm-daily-snapshot");

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/crm-daily-snapshot
 * Captures one daily snapshot per (org, Gleap project) so the CRM page can
 * show "vs hier" deltas. Triggered once a day. Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = {
    orgsProcessed: 0,
    snapshotsCaptured: 0,
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
        const { results, errors } = await captureCrmSnapshots(org.id);
        summary.snapshotsCaptured += results.length;
        summary.errors += errors;
      } catch (orgErr) {
        summary.errors++;
        logger.error("org capture failed", { orgId: org.id }, orgErr);
      }
    }

    logger.info("run complete", summary);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
