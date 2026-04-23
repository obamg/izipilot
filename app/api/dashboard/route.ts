import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent, objectiveScore } from "@/lib/score";
import { getISOWeek } from "@/lib/date";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.user.orgId;

  // Get current ISO week
  const now = new Date();
  const { weekNumber, year } = getISOWeek(now);

  // Compute previous week
  const prevWeek = weekNumber > 1
    ? { weekNumber: weekNumber - 1, year }
    : { weekNumber: 52, year: year - 1 };

  // Run queries in parallel
  const [krs, alerts, weekEntries, totalKrs, prevWeekEntries] = await Promise.all([
    // All active KRs with scores
    prisma.keyResult.findMany({
      where: { orgId, isActive: true, deletedAt: null },
      select: { score: true, status: true },
    }),

    // Unresolved alerts
    prisma.alert.groupBy({
      by: ["severity"],
      where: { orgId, isResolved: false },
      _count: true,
    }),

    // This week's entries
    prisma.weeklyEntry.findMany({
      where: { orgId, weekNumber, year },
      select: { krId: true },
    }),

    // Total expected KRs
    prisma.keyResult.count({
      where: { orgId, isActive: true, deletedAt: null },
    }),

    // Previous week's entries for delta calculation
    prisma.weeklyEntry.findMany({
      where: { orgId, weekNumber: prevWeek.weekNumber, year: prevWeek.year },
      select: { scoreAtEntry: true },
    }),
  ]);

  // Status breakdown
  const statusBreakdown = {
    onTrack: krs.filter((kr) => kr.status === "ON_TRACK").length,
    atRisk: krs.filter((kr) => kr.status === "AT_RISK").length,
    blocked: krs.filter((kr) => kr.status === "BLOCKED").length,
    notStarted: krs.filter((kr) => kr.status === "NOT_STARTED").length,
  };

  // Overall score
  const overallScore = objectiveScore(krs.map((kr) => kr.score));
  const overallScorePercent = scoreToPercent(overallScore);

  // Alert counts
  const alertMap = Object.fromEntries(
    alerts.map((a) => [a.severity.toLowerCase(), a._count])
  );

  // Check if deadline passed (Monday 09:00 local)
  // Deadline is Monday at 09:00 — it has passed if we're past Monday 09:00
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
  const deadlinePassed =
    dayOfWeek > 1 || // Tuesday–Saturday: deadline passed
    dayOfWeek === 0 || // Sunday: deadline passed (from last week)
    (dayOfWeek === 1 && now.getHours() >= 9); // Monday after 09:00

  return Response.json({
    data: {
      statusBreakdown,
      overallScorePercent,
      overallDelta: (() => {
        if (prevWeekEntries.length === 0) return 0;
        const prevAvg = prevWeekEntries.reduce((sum, e) => sum + Number(e.scoreAtEntry), 0) / prevWeekEntries.length;
        const prevPercent = Math.round(prevAvg * 100);
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
