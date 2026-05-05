import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KrHistoryChart } from "@/components/kr/KrHistoryChart";
import { KrActionsList } from "@/components/kr/KrActionsList";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}


export default async function KrDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const orgId = session.user.orgId;

  const [kr, orgUsers] = await Promise.all([
    prisma.keyResult.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true } },
        objective: {
          include: {
            product: { select: { code: true, name: true, color: true } },
            department: { select: { code: true, name: true, color: true } },
          },
        },
        weeklyEntries: {
          orderBy: [{ year: "asc" }, { weekNumber: "asc" }],
          take: 13,
          include: { submitter: { select: { name: true } } },
        },
        actions: {
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          include: { assignee: { select: { id: true, name: true } } },
        },
        alerts: {
          where: { isResolved: false },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!kr) notFound();

  const entity = kr.objective.product || kr.objective.department;
  const entityType = kr.objective.product ? "PRODUCT" : "DEPARTMENT";
  const entityHref =
    entityType === "PRODUCT"
      ? `/products/${entity?.code}`
      : `/departments/${entity?.code}`;

  const scorePercent = Math.round(Number(kr.score) * 100);
  const scoreColor =
    scorePercent >= 70
      ? "var(--green)"
      : scorePercent >= 40
      ? "var(--gold)"
      : "var(--red)";

  // Build chart data — sort by year+week, take last 13
  const chartData = kr.weeklyEntries
    .slice(-13)
    .map((e) => ({
      week: `S${String(e.weekNumber).padStart(2, "0")}`,
      score: Math.round(Number(e.scoreAtEntry) * 100),
    }));

  const latestEntry = kr.weeklyEntries[kr.weeklyEntries.length - 1];

  const openActions = kr.actions.filter(
    (a) => a.status !== "DONE" && a.status !== "CANCELLED"
  );
  const closedActions = kr.actions.filter(
    (a) => a.status === "DONE" || a.status === "CANCELLED"
  );

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-[11px] text-izi-gray mb-2">
        <Link href="/dashboard" className="hover:text-teal no-underline">
          Dashboard
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={entityHref} className="hover:text-teal no-underline">
          {entity?.code} {entity?.name}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-dark font-medium">KR</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5 mb-4">
        <div className="text-[11px] text-izi-gray mb-1">
          Objectif: {kr.objective.title}
        </div>
        <div className="flex items-start gap-3">
          <h1 className="font-serif text-xl text-dark flex-1">{kr.title}</h1>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
              Score
            </div>
            <div
              className="font-mono text-2xl font-bold"
              style={{ color: scoreColor }}
            >
              {scorePercent}%
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-[12px]">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
              Statut
            </div>
            <div className="mt-1">
              <StatusBadge status={kr.status} />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
              Type
            </div>
            <div className="mt-1 font-medium text-dark">{kr.krType}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
              Cible
            </div>
            <div className="mt-1 font-mono font-medium text-dark">
              {kr.target ?? "—"}
              {kr.targetUnit ? ` ${kr.targetUnit}` : ""}
              {kr.targetDate ? ` (${kr.targetDate})` : ""}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
              Actuel
            </div>
            <div className="mt-1 font-mono font-medium text-dark">
              {kr.currentValue}
              {kr.targetUnit ? ` ${kr.targetUnit}` : ""}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-izi-gray mt-3">
          Responsable: <span className="text-dark font-medium">{kr.owner.name}</span>
        </div>
      </div>

      {/* Active alerts */}
      {kr.alerts.length > 0 && (
        <div className="bg-red-lt rounded-xl border border-red/30 p-5 mb-4">
          <h2 className="text-base font-semibold text-dark mb-2">
            Alertes actives ({kr.alerts.length})
          </h2>
          <div className="space-y-1.5">
            {kr.alerts.map((a) => (
              <div key={a.id} className="text-[12px] text-dark">
                <span className="font-semibold">{a.severity}</span> &middot;{" "}
                {a.message}
                <span className="text-izi-gray ml-2 text-[10px]">
                  {formatDateShort(a.createdAt.toISOString())}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/alerts"
            className="text-[11px] text-teal hover:text-teal-dk no-underline font-medium mt-2 inline-block"
          >
            Voir d&eacute;tail &amp; r&eacute;soudre &rarr;
          </Link>
        </div>
      )}

      {/* History chart */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5 mb-4">
        <h2 className="text-base font-semibold text-dark mb-3">
          Progression (13 derni&egrave;res semaines)
        </h2>
        <KrHistoryChart data={chartData} />
      </div>

      {/* Latest weekly entry notes */}
      {latestEntry &&
        (latestEntry.blocker ||
          latestEntry.proposedSolution ||
          latestEntry.actionNeeded ||
          latestEntry.comment) && (
          <div className="bg-white rounded-xl border border-[#deeaea] p-5 mb-4">
            <h2 className="text-base font-semibold text-dark mb-1">
              Derni&egrave;re note du PO
            </h2>
            <p className="text-[11px] text-izi-gray mb-3">
              Semaine {latestEntry.weekNumber}/{latestEntry.year} &middot;{" "}
              {latestEntry.submitter.name} &middot;{" "}
              {formatDate(latestEntry.submittedAt.toISOString())}
            </p>
            <div className="space-y-2 text-[12px] text-dark">
              {latestEntry.blocker && (
                <div>
                  <span className="font-semibold">Blocage :</span>{" "}
                  {latestEntry.blocker}
                </div>
              )}
              {latestEntry.proposedSolution && (
                <div>
                  <span className="font-semibold">Solution propos&eacute;e :</span>{" "}
                  {latestEntry.proposedSolution}
                </div>
              )}
              {latestEntry.actionNeeded && (
                <div>
                  <span className="font-semibold">Besoin :</span>{" "}
                  {latestEntry.actionNeeded}
                </div>
              )}
              {latestEntry.comment && (
                <div>
                  <span className="font-semibold">Commentaire :</span>{" "}
                  {latestEntry.comment}
                </div>
              )}
            </div>
          </div>
        )}

      {/* Actions */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-dark">Actions</h2>
            <p className="text-sm text-izi-gray mt-0.5">
              {openActions.length} ouverte{openActions.length > 1 ? "s" : ""}{" "}
              &middot; {closedActions.length} ferm&eacute;e
              {closedActions.length > 1 ? "s" : ""}
            </p>
          </div>
          <Link
            href="/actions"
            className="text-[11px] text-teal hover:text-teal-dk no-underline font-medium"
          >
            Toutes les actions &rarr;
          </Link>
        </div>

        {kr.actions.length === 0 && (
          <p className="text-sm text-izi-gray py-4">
            Aucune action sur ce KR.
          </p>
        )}

        <KrActionsList
          actions={kr.actions.map((a) => ({
            id: a.id,
            title: a.title,
            description: a.description,
            status: a.status,
            priority: a.priority,
            assigneeId: a.assignee.id,
            assigneeName: a.assignee.name,
            dueDate: a.dueDate?.toISOString() ?? null,
          }))}
          users={orgUsers}
          currentUserRole={session.user.role}
        />
      </div>
    </div>
  );
}
