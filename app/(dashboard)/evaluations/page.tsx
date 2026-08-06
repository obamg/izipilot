import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/PageHeader";
import { evaluableSubjectIds, monthDeliveryByUser } from "@/lib/evaluation-server";
import { deliveryScoreFromRatio, recentMonths, avgDefined } from "@/lib/evaluation";
import { EvaluationsView } from "@/components/evaluations/EvaluationsView";

const HISTORY_MONTHS = 6;

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
}

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const role = session.user.role;
  const evaluatorId = session.user.id;

  const allowed = await evaluableSubjectIds(orgId, { id: evaluatorId, role });
  const canEvaluateAnyone = allowed === "ALL" || allowed.length > 0;

  const now = new Date();
  const sp = await searchParams;
  const month = clamp(Number(sp.month), 1, 12, now.getUTCMonth() + 1);
  const year = clamp(Number(sp.year), 2020, 2100, now.getUTCFullYear());

  const users = canEvaluateAnyone
    ? await prisma.user.findMany({
        where:
          allowed === "ALL"
            ? { orgId, isActive: true, id: { not: evaluatorId } }
            : { orgId, isActive: true, id: { in: allowed } },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      })
    : [];

  const userIds = users.map((u) => u.id);
  const [deliveryMap, existing] = await Promise.all([
    monthDeliveryByUser(orgId, year, month, userIds),
    userIds.length
      ? prisma.evaluation.findMany({
          where: {
            orgId,
            evaluatorId,
            periodMonth: month,
            periodYear: year,
            subjectId: { in: userIds },
          },
        })
      : Promise.resolve([]),
  ]);
  const evalBySubject = new Map(existing.map((e) => [e.subjectId, e]));

  const subjects = users.map((u) => {
    const stats = deliveryMap.get(u.id) ?? null;
    const ev = evalBySubject.get(u.id);
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      delivery: stats
        ? {
            deliveredPoints: stats.deliveredPoints,
            committedPoints: stats.committedPoints,
            ratio: stats.ratio,
            tasksDone: stats.tasksDone,
            tasksTotal: stats.tasksTotal,
            onTimeRate: stats.onTimeRate,
          }
        : null,
      deliveryScore: deliveryScoreFromRatio(stats?.ratio ?? null),
      evaluation: ev
        ? {
            scoreQuality: ev.scoreQuality,
            scoreCollaboration: ev.scoreCollaboration,
            scoreInitiative: ev.scoreInitiative,
            overall: Number(ev.overall),
            comment: ev.comment,
          }
        : null,
    };
  });

  // ── Trend / history: avg overall per (subject, month) over the last N months
  const months = recentMonths(year, month, HISTORY_MONTHS);
  const isManagement = allowed === "ALL";

  const grouped = userIds.length
    ? await prisma.evaluation.groupBy({
        by: ["subjectId", "periodYear", "periodMonth"],
        where: {
          orgId,
          subjectId: { in: userIds },
          OR: months.map((mo) => ({ periodYear: mo.year, periodMonth: mo.month })),
        },
        _avg: { overall: true },
      })
    : [];
  const key = (sid: string, y: number, m: number) => `${sid}:${y}:${m}`;
  const avgMap = new Map<string, number>();
  for (const g of grouped) {
    if (g._avg.overall != null) {
      avgMap.set(key(g.subjectId, g.periodYear, g.periodMonth), Number(g._avg.overall));
    }
  }

  const perPerson = users.map((u) => {
    const scores = months.map((mo) => avgMap.get(key(u.id, mo.year, mo.month)) ?? null);
    return { id: u.id, name: u.name, role: u.role, scores, average: avgDefined(scores) };
  });

  let perDepartment: { code: string; name: string; color: string; average: number | null }[] = [];
  let orgSeries: (number | null)[] = [];
  if (isManagement && perPerson.length) {
    orgSeries = months.map((_, i) => avgDefined(perPerson.map((p) => p.scores[i])));
    const depts = await prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true, color: true },
      orderBy: { sortOrder: "asc" },
    });
    const members = await prisma.departmentMember.findMany({
      where: { departmentId: { in: depts.map((d) => d.id) } },
      select: { departmentId: true, userId: true },
    });
    const avgByPerson = new Map(perPerson.map((p) => [p.id, p.average]));
    const byDept = new Map<string, string[]>();
    for (const m of members) {
      const arr = byDept.get(m.departmentId) ?? [];
      arr.push(m.userId);
      byDept.set(m.departmentId, arr);
    }
    perDepartment = depts
      .map((d) => ({
        code: d.code,
        name: d.name,
        color: d.color,
        average: avgDefined((byDept.get(d.id) ?? []).map((id) => avgByPerson.get(id) ?? null)),
      }))
      .filter((d) => d.average != null);
  }

  const trend = {
    months: months.map((mo) => ({ month: mo.month, year: mo.year, label: mo.label })),
    perPerson,
    isManagement,
    perDepartment,
    orgSeries,
  };

  return (
    <div>
      <PageHeader
        title="Évaluations"
        subtitle="Notation mensuelle de vos collègues — /5, basée sur leur livraison"
      />
      {!canEvaluateAnyone ? (
        <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center">
          <p className="text-[14px] text-dark font-medium mb-1">
            Aucune personne à évaluer
          </p>
          <p className="text-[12px] text-izi-gray">
            Les évaluations sont réservées au management et aux responsables
            d&apos;équipe (département ou produit).
          </p>
        </div>
      ) : (
        <EvaluationsView month={month} year={year} subjects={subjects} trend={trend} />
      )}
    </div>
  );
}
