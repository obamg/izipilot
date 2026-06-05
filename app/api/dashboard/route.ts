import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent, meanScore } from "@/lib/score";
import { getISOWeek, getPreviousISOWeek } from "@/lib/date";
import { alertVisibilityWhere, krVisibilityWhere } from "@/lib/visibility";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.user.orgId;
  const userRole = session.user.role;

  // Get current ISO week
  const now = new Date();
  const { weekNumber, year } = getISOWeek(now);

  // Compute previous ISO week — crosses year boundaries correctly (some
  // ISO years have 53 weeks, e.g. 2020 and 2026).
  const prevWeek = getPreviousISOWeek(year, weekNumber);

  // Run queries in parallel
  const [krs, alerts, weekEntries, totalKrs, prevWeekEntries] = await Promise.all([
    // All active KRs with scores + objectiveId for the rollup
    prisma.keyResult.findMany({
      where: { orgId, isActive: true, deletedAt: null, ...krVisibilityWhere(userRole) },
      select: { score: true, status: true, objectiveId: true },
    }),

    // Unresolved alerts
    prisma.alert.groupBy({
      by: ["severity"],
      where: { orgId, isResolved: false, ...alertVisibilityWhere(userRole) },
      _count: true,
    }),

    // This week's entries
    prisma.weeklyEntry.findMany({
      where: { orgId, weekNumber, year },
      select: { krId: true },
    }),

    // Total expected KRs
    prisma.keyResult.count({
      where: { orgId, isActive: true, deletedAt: null, ...krVisibilityWhere(userRole) },
    }),

    // Previous week's entries grouped by objective for the delta
    prisma.weeklyEntry.findMany({
      where: { orgId, weekNumber: prevWeek.weekNumber, year: prevWeek.year },
      select: {
        scoreAtEntry: true,
        keyResult: { select: { objectiveId: true } },
      },
    }),
  ]);

  // Status breakdown
  const statusBreakdown = {
    onTrack: krs.filter((kr) => kr.status === "ON_TRACK").length,
    atRisk: krs.filter((kr) => kr.status === "AT_RISK").length,
    blocked: krs.filter((kr) => kr.status === "BLOCKED").length,
    notStarted: krs.filter((kr) => kr.status === "NOT_STARTED").length,
  };

  // Overall score: mean of objective means. Flattening every KR would let
  // objectives with more KRs disproportionately weight the company score.
  function meanByObjective<T>(
    rows: T[],
    objectiveOf: (r: T) => string,
    scoreOf: (r: T) => number
  ): number {
    const byObj = new Map<string, number[]>();
    for (const row of rows) {
      const key = objectiveOf(row);
      const arr = byObj.get(key) ?? [];
      arr.push(scoreOf(row));
      byObj.set(key, arr);
    }
    const means: number[] = [];
    for (const arr of byObj.values()) {
      if (arr.length === 0) continue;
      means.push(arr.reduce((a, b) => a + b, 0) / arr.length);
    }
    return meanScore(means);
  }

  const overallScore = meanByObjective(
    krs,
    (kr) => kr.objectiveId,
    (kr) => Number(kr.score)
  );
  const overallScorePercent = scoreToPercent(overallScore);

  // Alert counts
  const alertMap = Object.fromEntries(
    alerts.map((a) => [a.severity.toLowerCase(), a._count])
  );

  // Submission deadline is Sunday 23:59 local. Since getISOWeek() rolls the
  // current week forward on Monday 00:00, the current week's deadline is
  // always upcoming (Sun) — except in the brief Sun 23:59→Mon 00:00 window.
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const deadlinePassed =
    dayOfWeek === 0 &&
    (now.getHours() > 23 ||
      (now.getHours() === 23 && now.getMinutes() >= 59));

  return Response.json({
    data: {
      statusBreakdown,
      overallScorePercent,
      overallDelta: (() => {
        if (prevWeekEntries.length === 0) return 0;
        // Aggregate prev week the same way as current — mean of objective
        // means — so the delta is a like-for-like comparison.
        const prevOverall = meanByObjective(
          prevWeekEntries,
          (e) => e.keyResult.objectiveId,
          (e) => Number(e.scoreAtEntry)
        );
        const prevPercent = scoreToPercent(prevOverall);
        return overallScorePercent - prevPercent;
      })(),
      alertCounts: {
        critical: alertMap.critical ?? 0,
        high: alertMap.high ?? 0,
        medium: alertMap.medium ?? 0,
        low: alertMap.low ?? 0,
      },
      currentWeek: {
        weekNumber,
        year,
        submittedCount: new Set(weekEntries.map((e) => e.krId)).size,
        totalExpected: totalKrs,
        deadlinePassed,
      },
    },
  });
}
