import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KrProgressBar } from "@/components/ui/KrProgressBar";
import { AlertCard } from "@/components/ui/AlertCard";
import { DashboardAlerts } from "./DashboardAlerts";
import { DashboardWeekSelector } from "./DashboardWeekSelector";
import { ActionKpiWidget } from "@/components/ui/ActionKpiWidget";
import { getISOWeek } from "@/lib/date";
import type { KrStatus } from "@prisma/client";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const userId = session.user.id;
  const userRole = session.user.role;
  const { weekNumber: currentWeek, year: currentYear } = getISOWeek(new Date());

  const params = await searchParams;
  const weekNumber = params.week ? parseInt(params.week, 10) : currentWeek;
  const year = params.year ? parseInt(params.year, 10) : currentYear;

  // For PO/MANAGEMENT, find their owned products/departments to filter the view
  let ownedProductIds: string[] = [];
  let ownedDepartmentIds: string[] = [];
  const isRestrictedView = userRole === "PO" || userRole === "MANAGEMENT";

  if (isRestrictedView) {
    const [ownedProducts, ownedDepartments] = await Promise.all([
      prisma.product.findMany({
        where: { orgId, ownerId: userId },
        select: { id: true },
      }),
      prisma.department.findMany({
        where: { orgId, ownerId: userId },
        select: { id: true },
      }),
    ]);
    ownedProductIds = ownedProducts.map((p) => p.id);
    ownedDepartmentIds = ownedDepartments.map((d) => d.id);
  }

  // Build KR filter: PO/MANAGEMENT see only their entities, CEO/VIEWER see all
  const krWhereClause = isRestrictedView
    ? {
        orgId,
        isActive: true,
        objective: {
          OR: [
            { productId: { in: ownedProductIds } },
            { departmentId: { in: ownedDepartmentIds } },
          ],
        },
      }
    : { orgId, isActive: true };

  const isHistorical = weekNumber !== currentWeek || year !== currentYear;

  // Fetch all data in parallel
  const [keyResults, alerts, weeklySession, submittedCount, actionGroups, weeklyEntries] = await Promise.all([
    prisma.keyResult.findMany({
      where: krWhereClause,
      include: {
        objective: {
          include: {
            product: { select: { code: true, name: true, color: true } },
            department: { select: { code: true, name: true, color: true } },
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.alert.findMany({
      where: { orgId, isResolved: false },
      include: {
        keyResult: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.weeklySession.findUnique({
      where: { orgId_weekNumber_year: { orgId, weekNumber, year } },
    }),
    prisma.weeklyEntry.groupBy({
      by: ["submittedBy"],
      where: { orgId, weekNumber, year },
    }),
    prisma.action.groupBy({
      by: ["status"],
      where: { orgId },
      _count: true,
    }),
    // Fetch weekly entries for historical view
    isHistorical
      ? prisma.weeklyEntry.findMany({
          where: { orgId, weekNumber, year },
          select: { krId: true, scoreAtEntry: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  // Build a map of krId -> historical score/status for past weeks
  const historicalScores = new Map<string, { score: number; status: string }>();
  if (isHistorical) {
    for (const entry of weeklyEntries) {
      historicalScores.set(entry.krId, {
        score: Number(entry.scoreAtEntry),
        status: entry.status,
      });
    }
  }

  // Compute action KPIs
  const actionKpis = { todo: 0, inProgress: 0, blocked: 0, done: 0, cancelled: 0, total: 0 };
  for (const g of actionGroups) {
    const c = g._count;
    if (g.status === "TODO") actionKpis.todo = c;
    else if (g.status === "IN_PROGRESS") actionKpis.inProgress = c;
    else if (g.status === "BLOCKED") actionKpis.blocked = c;
    else if (g.status === "DONE") actionKpis.done = c;
    else if (g.status === "CANCELLED") actionKpis.cancelled = c;
    actionKpis.total += c;
  }

  // Count POs expected
  const poCount = await prisma.user.count({
    where: { orgId, role: "PO", isActive: true },
  });

  // Helper to get score for a KR (historical or current)
  function getKrScore(kr: (typeof keyResults)[number]): number {
    if (isHistorical && historicalScores.has(kr.id)) {
      return historicalScores.get(kr.id)!.score * 100;
    }
    return Number(kr.score) * 100;
  }

  function getKrStatus(kr: (typeof keyResults)[number]): string {
    if (isHistorical && historicalScores.has(kr.id)) {
      return historicalScores.get(kr.id)!.status;
    }
    return kr.status;
  }

  // Compute KPIs
  const allScores = keyResults.map((kr) => getKrScore(kr));
  const overallScore =
    allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : 0;

  const statusCounts = {
    ON_TRACK: 0,
    AT_RISK: 0,
    BLOCKED: 0,
    NOT_STARTED: 0,
  };
  for (const kr of keyResults) {
    const status = getKrStatus(kr) as keyof typeof statusCounts;
    if (status in statusCounts) statusCounts[status]++;
  }

  // Group KRs by product/department for the OKR scores section
  const entityGroups = new Map<
    string,
    {
      code: string;
      name: string;
      color: string;
      entityType: string;
      objectives: Map<
        string,
        {
          title: string;
          krs: typeof keyResults;
          avgScore: number;
        }
      >;
      avgScore: number;
    }
  >();

  for (const kr of keyResults) {
    const obj = kr.objective;
    const entity = obj.product || obj.department;
    if (!entity) continue;

    const entityKey = "code" in entity ? entity.code : "";
    if (!entityGroups.has(entityKey)) {
      entityGroups.set(entityKey, {
        code: entityKey,
        name: entity.name,
        color: entity.color,
        entityType: obj.product ? "PRODUCT" : "DEPARTMENT",
        objectives: new Map(),
        avgScore: 0,
      });
    }

    const group = entityGroups.get(entityKey)!;
    if (!group.objectives.has(obj.id)) {
      group.objectives.set(obj.id, {
        title: obj.title,
        krs: [],
        avgScore: 0,
      });
    }
    group.objectives.get(obj.id)!.krs.push(kr);
  }

  // Compute averages
  for (const group of entityGroups.values()) {
    const scores: number[] = [];
    for (const obj of group.objectives.values()) {
      const objScores = obj.krs.map((kr) => getKrScore(kr));
      obj.avgScore =
        objScores.length > 0
          ? Math.round(objScores.reduce((a, b) => a + b, 0) / objScores.length)
          : 0;
      scores.push(...objScores);
    }
    group.avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
  }

  // Sort: blocked entities first, then by score ascending
  const sortedEntities = Array.from(entityGroups.values())
    .filter((e) => e.entityType === "PRODUCT")
    .sort((a, b) => a.avgScore - b.avgScore);

  const formattedDate = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-6 gap-3">
        <div>
          <p className="text-sm text-izi-gray capitalize">{formattedDate}</p>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="font-serif text-2xl text-dark">
              Semaine {weekNumber}
            </h1>
            <DashboardWeekSelector
              weekNumber={weekNumber}
              year={year}
              currentWeek={currentWeek}
              currentYear={currentYear}
            />
          </div>
          <p className="text-sm text-izi-gray mt-1">
            Deadline saisie 09h00 &middot;{" "}
            <span className="font-medium text-dark-md">{submittedCount.length}/{poCount}</span> revues soumises
          </p>
        </div>
        <a
          href="/weekly"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-teal text-white no-underline hover:bg-teal-dk transition-colors shadow-sm shadow-teal/20"
        >
          Soumettre ma revue
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
          </svg>
        </a>
      </div>

      {/* KPIs Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4 hover:shadow-sm transition-shadow">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            Score global
          </div>
          <div className="font-serif text-2xl text-teal leading-none">
            {overallScore}%
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4 hover:shadow-sm transition-shadow">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            En bonne voie
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-izi-green leading-none">
              {statusCounts.ON_TRACK}
            </span>
            <span className="text-xs text-izi-gray">KRs</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4 hover:shadow-sm transition-shadow">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            Attention
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-gold leading-none">
              {statusCounts.AT_RISK}
            </span>
            <span className="text-xs text-izi-gray">KRs</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4 hover:shadow-sm transition-shadow">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            Bloqu&eacute;s
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-izi-red leading-none">
              {statusCounts.BLOCKED}
            </span>
            <span className="text-xs text-izi-gray">KRs</span>
          </div>
        </div>
        <ActionKpiWidget
          todo={actionKpis.todo}
          inProgress={actionKpis.inProgress}
          blocked={actionKpis.blocked}
          done={actionKpis.done}
          total={actionKpis.total}
        />
      </div>

      {/* Main grid: OKR scores + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-4">
        {/* OKR Scores — Products */}
        <div className="bg-white rounded-xl border border-[#deeaea] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-dark">
                Scores OKR &mdash; Produits
              </h2>
              <p className="text-sm text-izi-gray mt-0.5">
                S{String(weekNumber).padStart(2, "0")} &middot; {year}
              </p>
            </div>
          </div>
          {sortedEntities.length === 0 && (
            <p className="text-sm text-izi-gray py-6">Aucun OKR trouv&eacute;.</p>
          )}
          {sortedEntities.map((entity, i) => (
            <div
              key={entity.code}
              className={`mb-4 pb-4 ${
                i < sortedEntities.length - 1
                  ? "border-b border-izi-gray-lt"
                  : ""
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="font-mono text-xs font-semibold px-2 py-0.5 rounded"
                  style={{
                    backgroundColor:
                      entity.avgScore < 40
                        ? "var(--red-lt)"
                        : "var(--teal-lt)",
                    color:
                      entity.avgScore < 40 ? "var(--red)" : "var(--teal)",
                  }}
                >
                  {entity.code}
                </span>
                <span className="text-sm font-medium text-dark flex-1">
                  {entity.name}
                </span>
                <span
                  className="font-mono text-sm font-bold"
                  style={{
                    color:
                      entity.avgScore >= 70
                        ? "var(--green)"
                        : entity.avgScore >= 40
                        ? "var(--gold)"
                        : "var(--red)",
                  }}
                >
                  {entity.avgScore}%
                </span>
              </div>
              {Array.from(entity.objectives.values()).flatMap((obj) =>
                obj.krs.map((kr) => (
                  <KrProgressBar
                    key={kr.id}
                    score={Math.round(getKrScore(kr))}
                    label={kr.title}
                    className="py-1.5 border-b border-izi-gray-lt last:border-b-0"
                  />
                ))
              )}
            </div>
          ))}
        </div>

        {/* Right column: Alerts */}
        <div className="flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-[#deeaea] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-dark">
                  Alertes actives
                </h2>
                <p className="text-sm text-izi-gray mt-0.5">
                  {alerts.length} requ{alerts.length > 1 ? "i\u00e8rent" : "iert"} une action
                </p>
              </div>
            </div>
            {alerts.length === 0 && (
              <p className="text-sm text-izi-gray py-6">Aucune alerte active.</p>
            )}
            <DashboardAlerts
              alerts={alerts.map((a) => ({
                id: a.id,
                title: `${a.keyResult.title}`,
                subtitle: a.message,
                severity: a.severity,
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
