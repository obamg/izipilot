import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { captureCrmSnapshots } from "@/lib/crm-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/crm-daily-snapshot
 * Captures one daily snapshot per (org, Gleap project) so the CRM page can
 * show "vs hier" deltas. Triggered once a day. Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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
        console.error(
          `[cron/crm-daily-snapshot] org ${org.id} failed:`,
          orgErr
        );
      }
    }

    console.log("[cron/crm-daily-snapshot] Completed:", summary);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/crm-daily-snapshot] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
