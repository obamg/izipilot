import { prisma } from "@/lib/prisma";
import {
  getOpenTicketsCount,
  getWorkspaceStats,
  isGleapConfigured,
  type GleapProjectKey,
} from "@/lib/gleap";

const PROJECT_KEYS: GleapProjectKey[] = ["TRADING", "AFRICAPART", "SHARED"];

function todayUtcDate(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function yesterdayUtcDate(): Date {
  const d = todayUtcDate();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

export interface CrmSnapshotResult {
  gleapProjectKey: GleapProjectKey;
  openTickets: number | null;
  slaBreachedInSample: number | null;
  sampleSize: number | null;
  agentsActive: number | null;
}

export async function captureCrmSnapshots(orgId: string): Promise<{
  date: Date;
  results: CrmSnapshotResult[];
  errors: number;
}> {
  const date = todayUtcDate();
  const results: CrmSnapshotResult[] = [];
  let errors = 0;

  for (const key of PROJECT_KEYS) {
    if (!isGleapConfigured(key)) continue;
    try {
      const [openTickets, stats] = await Promise.all([
        getOpenTicketsCount(key),
        getWorkspaceStats(key),
      ]);

      const result: CrmSnapshotResult = {
        gleapProjectKey: key,
        openTickets,
        slaBreachedInSample: stats?.slaBreachedInSample ?? null,
        sampleSize: stats?.sampleSize ?? null,
        agentsActive: stats?.agents.length ?? null,
      };
      results.push(result);

      await prisma.crmDailySnapshot.upsert({
        where: {
          orgId_gleapProjectKey_snapshotDate: {
            orgId,
            gleapProjectKey: key,
            snapshotDate: date,
          },
        },
        create: {
          orgId,
          gleapProjectKey: key,
          snapshotDate: date,
          openTickets: result.openTickets,
          slaBreachedInSample: result.slaBreachedInSample,
          sampleSize: result.sampleSize,
          agentsActive: result.agentsActive,
        },
        update: {
          openTickets: result.openTickets,
          slaBreachedInSample: result.slaBreachedInSample,
          sampleSize: result.sampleSize,
          agentsActive: result.agentsActive,
          capturedAt: new Date(),
        },
      });
    } catch (err) {
      errors++;
      console.error(`[crm-snapshot] capture failed for ${key}:`, err);
    }
  }

  return { date, results, errors };
}

export interface YesterdaySnapshotMap {
  byProject: Map<GleapProjectKey, {
    openTickets: number | null;
    slaBreachedInSample: number | null;
    sampleSize: number | null;
    agentsActive: number | null;
  }>;
  date: Date;
}

export async function getYesterdaySnapshots(
  orgId: string
): Promise<YesterdaySnapshotMap> {
  const date = yesterdayUtcDate();
  const rows = await prisma.crmDailySnapshot.findMany({
    where: { orgId, snapshotDate: date },
  });
  const byProject = new Map<
    GleapProjectKey,
    {
      openTickets: number | null;
      slaBreachedInSample: number | null;
      sampleSize: number | null;
      agentsActive: number | null;
    }
  >();
  for (const r of rows) {
    byProject.set(r.gleapProjectKey as GleapProjectKey, {
      openTickets: r.openTickets,
      slaBreachedInSample: r.slaBreachedInSample,
      sampleSize: r.sampleSize,
      agentsActive: r.agentsActive,
    });
  }
  return { byProject, date };
}
