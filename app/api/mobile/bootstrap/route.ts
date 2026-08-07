import { NextRequest } from "next/server";
import { auth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getISOWeek } from "@/lib/date";
import { getWeeklyKrData } from "@/lib/weekly-data";
import {
  alertVisibilityWhere,
  departmentVisibilityWhere,
  krVisibilityWhere,
} from "@/lib/visibility";

// One-round-trip payload for the native app: user, week context, dashboard
// aggregates (entities + KPIs), and the weekly-entry form data. Alerts come
// from the existing /api/alerts route.

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, role } = session.user;
  const { weekNumber: currentWeek, year: currentYear } = getISOWeek(new Date());
  const { searchParams } = request.nextUrl;
  const weekNumber = Number(searchParams.get("week")) || currentWeek;
  const year = Number(searchParams.get("year")) || currentYear;

  const [products, departments, unresolvedAlertCount, weekly] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        objectives: {
          where: { isActive: true },
          include: {
            keyResults: { where: { isActive: true }, select: { score: true, status: true } },
          },
        },
      },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true, ...departmentVisibilityWhere(role) },
      orderBy: { sortOrder: "asc" },
      include: {
        objectives: {
          where: { isActive: true },
          include: {
            keyResults: {
              where: { isActive: true, ...krVisibilityWhere(role) },
              select: { score: true, status: true },
            },
          },
        },
      },
    }),
    prisma.alert.count({
      where: { orgId, isResolved: false, ...alertVisibilityWhere(role) },
    }),
    getWeeklyKrData(
      { id: session.user.id, orgId, role },
      weekNumber,
      year,
    ),
  ]);

  type EntityWithKrs = {
    objectives: { keyResults: { score: unknown; status: string }[] }[];
  };
  const allKrs = (e: EntityWithKrs) => e.objectives.flatMap((o) => o.keyResults);
  const avgScore = (krs: { score: unknown }[]) =>
    krs.length === 0
      ? 0
      : Math.round(
          (krs.reduce((a, kr) => a + Number(kr.score), 0) / krs.length) * 100,
        );

  const entityPayload = (e: EntityWithKrs & { code: string; name: string; color: string }) => ({
    code: e.code,
    name: e.name,
    color: e.color,
    scorePercent: avgScore(allKrs(e)),
  });

  // Global KPIs across every KR visible to this role.
  const everyKr = [...products.flatMap(allKrs), ...departments.flatMap(allKrs)];
  const kpis = {
    globalScorePercent: avgScore(everyKr),
    totalKrs: everyKr.length,
    onTrack: everyKr.filter((k) => k.status === "ON_TRACK").length,
    atRisk: everyKr.filter((k) => k.status === "AT_RISK").length,
    blocked: everyKr.filter((k) => k.status === "BLOCKED").length,
    notStarted: everyKr.filter((k) => k.status === "NOT_STARTED").length,
    unresolvedAlertCount,
  };

  return Response.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role,
      orgId,
    },
    week: { weekNumber, year, currentWeek, currentYear },
    products: products.map(entityPayload),
    departments: departments.map(entityPayload),
    kpis,
    weekly: {
      krData: weekly.krData,
      orgUsers: weekly.orgUsers,
      isReadOnly: weekly.isReadOnly,
      isHistorical: weekly.isHistorical,
      deadline: new Date(weekly.deadline).toISOString(),
      entityNames: weekly.entityNames,
      submittedCount: weekly.submittedCount,
    },
  });
}
