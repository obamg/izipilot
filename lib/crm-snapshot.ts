import { prisma } from "@/lib/prisma";
import {
  getAgentActivityForDay,
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

      await captureAgentActivity(orgId, key);
    } catch (err) {
      errors++;
      console.error(`[crm-snapshot] capture failed for ${key}:`, err);
    }
  }

  return { date, results, errors };
}

/**
 * Captures per-agent activity for the previous UTC day. We store yesterday
 * (rather than today) because the cron runs at 04h UTC — yesterday is fully
 * closed and won't be revised by late-day work.
 */
async function captureAgentActivity(
  orgId: string,
  key: GleapProjectKey
): Promise<void> {
  const day = yesterdayUtcDate();
  const activity = await getAgentActivityForDay(key, day);
  if (!activity) return;

  for (const a of activity.agents) {
    await prisma.agentDailySnapshot.upsert({
      where: {
        orgId_gleapProjectKey_snapshotDate_agentId: {
          orgId,
          gleapProjectKey: key,
          snapshotDate: day,
          agentId: a.id,
        },
      },
      create: {
        orgId,
        gleapProjectKey: key,
        snapshotDate: day,
        agentId: a.id,
        agentName: a.name,
        agentEmail: a.email,
        ticketsHandled: a.ticketsHandled,
        slaBreached: a.slaBreached,
        avgResolutionHours: a.avgResolutionHours,
      },
      update: {
        agentName: a.name,
        agentEmail: a.email,
        ticketsHandled: a.ticketsHandled,
        slaBreached: a.slaBreached,
        avgResolutionHours: a.avgResolutionHours,
        capturedAt: new Date(),
      },
    });
  }
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

export interface WeekAgentTotal {
  agentId: string;
  agentName: string;
  agentEmail: string | null;
  ticketsHandled: number;
  slaBreached: number;
  avgResolutionHours: number | null;
  daysActive: number;
}

export interface WeekAgentTotals {
  agents: WeekAgentTotal[];
  /** Inclusive UTC day bounds of the aggregation window. */
  from: Date;
  to: Date;
  /** Number of distinct snapshot dates with at least one row. */
  daysCovered: number;
}

/**
 * Aggregates the last 7 fully-captured UTC days (yesterday and the 6 prior).
 * `avgResolutionHours` is weighted by ticketsHandled so a single huge day
 * doesn't dominate.
 */
export async function getWeekAgentTotals(
  orgId: string
): Promise<WeekAgentTotals> {
  const to = yesterdayUtcDate();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);

  const rows = await prisma.agentDailySnapshot.findMany({
    where: { orgId, snapshotDate: { gte: from, lte: to } },
  });

  const byAgent = new Map<
    string,
    {
      agentName: string;
      agentEmail: string | null;
      ticketsHandled: number;
      slaBreached: number;
      resolutionHourSum: number;
      resolutionTicketSum: number;
      daysActive: number;
    }
  >();
  const dates = new Set<string>();

  for (const r of rows) {
    dates.add(r.snapshotDate.toISOString().slice(0, 10));
    const cur = byAgent.get(r.agentId);
    const next = cur ?? {
      agentName: r.agentName,
      agentEmail: r.agentEmail,
      ticketsHandled: 0,
      slaBreached: 0,
      resolutionHourSum: 0,
      resolutionTicketSum: 0,
      daysActive: 0,
    };
    // Prefer most recent name/email — rows are unordered, so just overwrite.
    next.agentName = r.agentName;
    next.agentEmail = r.agentEmail;
    next.ticketsHandled += r.ticketsHandled;
    next.slaBreached += r.slaBreached;
    if (r.avgResolutionHours !== null && r.ticketsHandled > 0) {
      next.resolutionHourSum += r.avgResolutionHours * r.ticketsHandled;
      next.resolutionTicketSum += r.ticketsHandled;
    }
    if (r.ticketsHandled > 0) next.daysActive += 1;
    byAgent.set(r.agentId, next);
  }

  const agents: WeekAgentTotal[] = [];
  for (const [agentId, v] of byAgent) {
    agents.push({
      agentId,
      agentName: v.agentName,
      agentEmail: v.agentEmail,
      ticketsHandled: v.ticketsHandled,
      slaBreached: v.slaBreached,
      avgResolutionHours:
        v.resolutionTicketSum > 0
          ? v.resolutionHourSum / v.resolutionTicketSum
          : null,
      daysActive: v.daysActive,
    });
  }

  agents.sort((a, b) => b.ticketsHandled - a.ticketsHandled);

  return { agents, from, to, daysCovered: dates.size };
}
