import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/PageHeader";
import { MONTH_LABELS_FR, avgDefined } from "@/lib/evaluation";
import { MyEvaluationsView } from "@/components/evaluations/MyEvaluationsView";

interface Snap {
  deliveredPoints?: number;
  committedPoints?: number;
  ratio?: number | null;
  tasksDone?: number;
  onTimeRate?: number | null;
}

export default async function MyEvaluationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const userId = session.user.id;

  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;

  // Only CLOSED months — never reveal an in-progress month's rating.
  const rows = await prisma.evaluation.findMany({
    where: {
      orgId,
      subjectId: userId,
      OR: [
        { periodYear: { lt: curYear } },
        { periodYear: curYear, periodMonth: { lt: curMonth } },
      ],
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
  });

  // Aggregate per month across all of the person's evaluators.
  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.periodYear}-${r.periodMonth}`;
    const arr = byMonth.get(k) ?? [];
    arr.push(r);
    byMonth.set(k, arr);
  }

  const monthsData = [...byMonth.values()].map((rs) => {
    const y = rs[0].periodYear;
    const m = rs[0].periodMonth;
    const deliveryRow = rs.find((r) => r.deliveryScore != null);
    const snapRow = rs.find((r) => r.statsSnapshot);
    const snap = (snapRow?.statsSnapshot as Snap | null) ?? null;
    return {
      month: m,
      year: y,
      label: `${MONTH_LABELS_FR[m - 1]} ${y}`,
      overall: avgDefined(rs.map((r) => Number(r.overall))),
      deliveryScore: deliveryRow ? Number(deliveryRow.deliveryScore) : null,
      quality: avgDefined(rs.map((r) => r.scoreQuality)),
      collaboration: avgDefined(rs.map((r) => r.scoreCollaboration)),
      initiative: avgDefined(rs.map((r) => r.scoreInitiative)),
      evaluatorCount: rs.length,
      comments: rs
        .map((r) => r.comment)
        .filter((c): c is string => !!c && c.trim().length > 0),
      snapshot: snap
        ? {
            deliveredPoints: snap.deliveredPoints ?? 0,
            committedPoints: snap.committedPoints ?? 0,
            ratio: snap.ratio ?? null,
            tasksDone: snap.tasksDone ?? 0,
            onTimeRate: snap.onTimeRate ?? null,
          }
        : null,
    };
  });

  // Trend: last up-to-6 closed months, oldest → newest.
  const recent = monthsData.slice(0, 6).reverse();
  const trend = {
    labels: recent.map(
      (d) => `${String(d.month).padStart(2, "0")}/${String(d.year).slice(2)}`
    ),
    scores: recent.map((d) => d.overall),
  };

  return (
    <div>
      <PageHeader
        title="Mes évaluations"
        subtitle="Vos notes mensuelles /5 et les retours de votre responsable"
      />
      <MyEvaluationsView months={monthsData} trend={trend} />
    </div>
  );
}
