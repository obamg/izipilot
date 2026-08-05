import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/PageHeader";
import { evaluableSubjectIds, monthDeliveryByUser } from "@/lib/evaluation-server";
import { deliveryScoreFromRatio } from "@/lib/evaluation";
import { EvaluationsView } from "@/components/evaluations/EvaluationsView";

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
        <EvaluationsView month={month} year={year} subjects={subjects} />
      )}
    </div>
  );
}
