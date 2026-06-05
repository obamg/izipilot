import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getOpenTicketsCount,
  isGleapConfigured,
  type GleapProjectKey,
} from "@/lib/gleap";
import { PRODUCT_GLEAP_PROJECT } from "@/constants/gleap";
import { getWeekAgentTotals, getYesterdaySnapshots } from "@/lib/crm-snapshot";

function DeltaPill({
  delta,
  lowerIsBetter = true,
}: {
  delta: number | null;
  lowerIsBetter?: boolean;
}) {
  if (delta === null) return null;
  if (delta === 0) {
    return (
      <span className="text-[9px] font-mono text-izi-gray ml-1.5">=</span>
    );
  }
  const goingUp = delta > 0;
  const isBad = lowerIsBetter ? goingUp : !goingUp;
  const color = isBad ? "var(--red)" : "var(--green)";
  const arrow = goingUp ? "\u2191" : "\u2193";
  return (
    <span
      className="text-[10px] font-mono ml-1.5"
      style={{ color }}
      title="vs hier"
    >
      {arrow}
      {Math.abs(delta)}
    </span>
  );
}

function ticketColor(tickets: number | null): string {
  if (tickets === null) return "var(--gray)";
  if (tickets <= 10) return "var(--green)";
  if (tickets <= 20) return "var(--gold)";
  return "var(--red)";
}

function responseColor(hours: number | null): string {
  if (hours === null) return "var(--gray)";
  if (hours <= 4) return "var(--green)";
  if (hours <= 8) return "var(--gold)";
  return "var(--red)";
}

function slaColor(count: number): string {
  if (count === 0) return "var(--green)";
  if (count <= 5) return "var(--gold)";
  return "var(--red)";
}

export default async function CustomerMetricsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const products = await prisma.product.findMany({
    where: { orgId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, status: true },
  });

  // Resolve unique Gleap projects we need to query (one fetch per project, even if
  // shared by multiple products).
  const uniqueProjectKeys = Array.from(
    new Set(
      products
        .map((p) => PRODUCT_GLEAP_PROJECT[p.code])
        .filter((k): k is GleapProjectKey => Boolean(k))
    )
  );

  // Page render path used to fetch /tickets?limit=1000 on every request to
  // build the agent leaderboard and the SLA breach KPI. That call took up
  // to 12s, was per-process cached only, and dominated cold-start time on
  // Mon-morning traffic. The nightly snapshot already captures the same
  // data — read it instead and only hit Gleap for the live open-ticket
  // counts (one cheap /tickets?limit=1 call per project).
  const [ticketCountEntries, yesterday, weekTotals] = await Promise.all([
    Promise.all(
      uniqueProjectKeys.map(async (key) => {
        const count = await getOpenTicketsCount(key);
        return [key, count] as const;
      })
    ),
    getYesterdaySnapshots(orgId),
    getWeekAgentTotals(orgId),
  ]);
  const openTicketsByProject = new Map(ticketCountEntries);

  // Leaderboard now reflects the last 7 fully-captured days. More stable
  // than a single-day snapshot and matches the daysCovered label.
  const agentsRanked = weekTotals.agents
    .slice()
    .sort((a, b) => b.ticketsHandled - a.ticketsHandled);

  // Org-wide live KPIs.
  const totalOpenTickets = ticketCountEntries.reduce(
    (acc, [, c]) => acc + (c ?? 0),
    0
  );
  const totalResolutionHours = agentsRanked
    .map((a) => a.avgResolutionHours)
    .filter((h): h is number => h !== null);
  const avgResolutionHours =
    totalResolutionHours.length > 0
      ? totalResolutionHours.reduce((a, b) => a + b, 0) /
        totalResolutionHours.length
      : null;

  // SLA breach KPI now comes from yesterday's SHARED snapshot. We lose the
  // live-vs-yesterday delta in exchange for fast page loads; deltas inside
  // the leaderboard already use the 7-day window.
  const sharedSnapshot = yesterday.byProject.get("SHARED") ?? null;
  const slaBreachedInSample = sharedSnapshot?.slaBreachedInSample ?? null;
  const sharedSampleSize = sharedSnapshot?.sampleSize ?? null;

  // Compute "vs hier" deltas — only when yesterday data exists for the same
  // set of projects we're showing today.
  function ticketsDelta(key: GleapProjectKey, todayCount: number | null) {
    if (todayCount === null) return null;
    const y = yesterday.byProject.get(key);
    if (!y || y.openTickets === null) return null;
    return todayCount - y.openTickets;
  }

  let totalTicketsYesterday = 0;
  let allYesterdayPresent = uniqueProjectKeys.length > 0;
  for (const key of uniqueProjectKeys) {
    const y = yesterday.byProject.get(key);
    if (!y || y.openTickets === null) {
      allYesterdayPresent = false;
      break;
    }
    totalTicketsYesterday += y.openTickets;
  }
  const totalTicketsDelta = allYesterdayPresent
    ? totalOpenTickets - totalTicketsYesterday
    : null;

  const fetchedAtLabel = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Porto-Novo",
  }).format(new Date());

  const dayFmt = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const weekRangeLabel =
    weekTotals.daysCovered > 0
      ? `${dayFmt.format(weekTotals.from)} \u2014 ${dayFmt.format(weekTotals.to)}`
      : null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="font-serif text-[20px] text-dark">CRM</h1>
          <p className="text-[11px] text-izi-gray mt-0.5">
            Tickets clients et performance des agents
          </p>
          <p className="text-[10px] text-izi-gray mt-1">
            Tickets ouverts en direct &middot; mise &agrave; jour &agrave; {fetchedAtLabel}
            {sharedSampleSize !== null && (
              <>
                {" "}&middot; SLA et agents bas&eacute;s sur le snapshot quotidien
                {" "}(&eacute;chantillon {sharedSampleSize} tickets)
              </>
            )}
          </p>
        </div>
        <div className="text-[10px] text-izi-gray bg-teal-lt border border-teal-md rounded-[6px] px-2.5 py-1.5">
          NPS &amp; CSAT{" "}
          <span className="font-semibold text-dark">
            &agrave; venir
          </span>{" "}
          &middot; sondages non encore configur&eacute;s
        </div>
      </div>

      {/* Org-wide KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-border-soft px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            Tickets ouverts
          </div>
          <div
            className="font-serif text-2xl leading-none flex items-baseline"
            style={{ color: ticketColor(totalOpenTickets) }}
          >
            {totalOpenTickets}
            <DeltaPill delta={totalTicketsDelta} />
          </div>
          <div className="text-[9px] text-izi-gray mt-2">
            tous projets connect&eacute;s
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border-soft px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            R&eacute;solution moyenne
          </div>
          <div
            className="font-serif text-2xl leading-none"
            style={{ color: responseColor(avgResolutionHours) }}
          >
            {avgResolutionHours !== null
              ? `${avgResolutionHours.toFixed(1)}h`
              : "\u2014"}
          </div>
          <div className="text-[9px] text-izi-gray mt-2">
            agents du workspace partag&eacute;
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border-soft px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            Agents actifs
          </div>
          <div className="font-serif text-2xl leading-none text-dark">
            {agentsRanked.length}
          </div>
          <div className="text-[9px] text-izi-gray mt-2">
            ayant trait&eacute; au moins un ticket
          </div>
        </div>
        <div
          className="bg-white rounded-xl border border-border-soft px-5 py-4"
          title="Nombre de tickets en breach SLA dans l'échantillon des derniers tickets fournis par Gleap. Borne basse — peut sous-estimer le total réel sur un gros backlog."
        >
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            SLA d&eacute;pass&eacute;s
          </div>
          <div
            className="font-serif text-2xl leading-none"
            style={{
              color:
                slaBreachedInSample !== null
                  ? slaColor(slaBreachedInSample)
                  : "var(--gray)",
            }}
          >
            {slaBreachedInSample !== null ? slaBreachedInSample : "\u2014"}
          </div>
          <div className="text-[9px] text-izi-gray mt-2">
            snapshot d&apos;hier &middot; {sharedSampleSize ?? 0} tickets
            (workspace partag&eacute;)
          </div>
        </div>
      </div>

      {/* Per-product cards */}
      <div className="bg-white rounded-xl border border-border-soft p-5">
        <h2 className="text-base font-semibold text-dark mb-4">Par produit</h2>

        {products.length === 0 ? (
          <p className="text-sm text-izi-gray py-6">Aucun produit actif.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {products.map((p) => {
              const projectKey = PRODUCT_GLEAP_PROJECT[p.code];
              const connected = projectKey
                ? isGleapConfigured(projectKey)
                : false;
              const openTickets = projectKey
                ? openTicketsByProject.get(projectKey) ?? null
                : null;
              const productDelta = projectKey
                ? ticketsDelta(projectKey, openTickets)
                : null;
              const isShared = projectKey === "SHARED";

              return (
                <Link
                  key={p.code}
                  href={`/products/${p.code}`}
                  className="block bg-white rounded-[10px] border border-border-soft p-4 hover:border-teal-md transition-colors no-underline"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="font-mono text-sm font-semibold px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--teal-lt)",
                        color: "var(--teal)",
                      }}
                    >
                      {p.code}
                    </span>
                    <span className="text-base font-medium text-dark flex-1">
                      {p.name}
                    </span>
                    {connected ? (
                      <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-izi-green-lt text-izi-green">
                        Live
                      </span>
                    ) : (
                      <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-izi-gray-lt text-izi-gray">
                        &Agrave; venir
                      </span>
                    )}
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
                        Tickets ouverts
                      </div>
                      <div
                        className="font-serif text-[28px] leading-none mt-1 flex items-baseline"
                        style={{ color: ticketColor(openTickets) }}
                      >
                        {openTickets !== null ? openTickets : "\u2014"}
                        <DeltaPill delta={productDelta} />
                      </div>
                    </div>
                    <div className="text-right">
                      {isShared && (
                        <div className="text-[9px] text-izi-gray italic">
                          Workspace mutualis&eacute;
                        </div>
                      )}
                      <div className="text-[9px] uppercase tracking-wide text-izi-gray font-semibold mt-1">
                        {p.status}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Weekly agent totals from persisted snapshots */}
      <div className="bg-white rounded-xl border border-border-soft p-5 mt-4">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-dark">
              Cette semaine (7 derniers jours)
            </h2>
            <p className="text-[10px] text-izi-gray mt-0.5">
              {weekRangeLabel
                ? `${weekRangeLabel} UTC \u00b7 ${weekTotals.daysCovered}/7 jours captur\u00e9s`
                : "Aucune donn\u00e9e captur\u00e9e \u2014 le snapshot tourne chaque nuit \u00e0 04h UTC"}
            </p>
          </div>
        </div>

        {weekTotals.agents.length === 0 ? (
          <p className="text-sm text-izi-gray py-6">
            Aucune activit&eacute; agent captur&eacute;e sur les 7 derniers jours.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-izi-gray font-semibold border-b border-border-soft">
                  <th className="py-2 pr-3 w-8">#</th>
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3 text-right">Tickets 7j</th>
                  <th className="py-2 pr-3 text-right">Jours actifs</th>
                  <th className="py-2 pr-3 text-right">R&eacute;solution moy.</th>
                  <th className="py-2 text-right">SLA d&eacute;pass&eacute;s</th>
                </tr>
              </thead>
              <tbody>
                {weekTotals.agents.map((a, idx) => (
                  <tr
                    key={a.agentId}
                    className="border-b border-border-soft last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-izi-gray">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="text-sm text-dark font-medium">
                        {a.agentName}
                      </div>
                      {a.agentEmail && a.agentEmail !== a.agentName && (
                        <div className="text-[10px] text-izi-gray font-mono mt-0.5">
                          {a.agentEmail}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-[12px] text-dark">
                      {a.ticketsHandled}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-[12px] text-izi-gray">
                      {a.daysActive}/7
                    </td>
                    <td
                      className="py-2.5 pr-3 text-right font-mono text-[12px]"
                      style={{
                        color:
                          a.avgResolutionHours !== null
                            ? responseColor(a.avgResolutionHours)
                            : "var(--gray)",
                      }}
                    >
                      {a.avgResolutionHours !== null
                        ? `${a.avgResolutionHours.toFixed(1)}h`
                        : "\u2014"}
                    </td>
                    <td
                      className="py-2.5 text-right font-mono text-[12px] font-semibold"
                      style={{ color: slaColor(a.slaBreached) }}
                    >
                      {a.slaBreached}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
