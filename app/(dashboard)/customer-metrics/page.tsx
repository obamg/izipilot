import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getOpenTicketsCount,
  getWorkspaceStats,
  isGleapConfigured,
  type GleapProjectKey,
} from "@/lib/gleap";
import { PRODUCT_GLEAP_PROJECT } from "@/constants/gleap";
import { getYesterdaySnapshots } from "@/lib/crm-snapshot";

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

  // Parallel fetch open-ticket counts per project.
  const ticketCountEntries = await Promise.all(
    uniqueProjectKeys.map(async (key) => {
      const count = await getOpenTicketsCount(key);
      return [key, count] as const;
    })
  );
  const openTicketsByProject = new Map(ticketCountEntries);

  // Workspace stats from SHARED project (leaderboard + SLA tile).
  const sharedStats = await getWorkspaceStats("SHARED");

  // Yesterday's snapshots for "vs hier" deltas.
  const yesterday = await getYesterdaySnapshots(orgId);
  const agentsRanked = (sharedStats?.agents ?? [])
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

  const sharedYesterday = yesterday.byProject.get("SHARED");
  const slaDelta =
    sharedStats !== null &&
    sharedYesterday &&
    sharedYesterday.slaBreachedInSample !== null
      ? sharedStats.slaBreachedInSample - sharedYesterday.slaBreachedInSample
      : null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="font-serif text-[20px] text-dark">CRM</h1>
          <p className="text-[11px] text-izi-gray mt-0.5">
            Tickets clients et performance des agents &middot; donn&eacute;es Gleap en direct
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
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
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
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
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
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
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
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            SLA d&eacute;pass&eacute;s
          </div>
          <div
            className="font-serif text-2xl leading-none flex items-baseline"
            style={{
              color:
                sharedStats !== null
                  ? slaColor(sharedStats.slaBreachedInSample)
                  : "var(--gray)",
            }}
          >
            {sharedStats !== null
              ? sharedStats.slaBreachedInSample
              : "\u2014"}
            <DeltaPill delta={slaDelta} />
          </div>
          <div className="text-[9px] text-izi-gray mt-2">
            sur les {sharedStats?.sampleSize ?? 0} tickets r&eacute;cents
            (workspace partag&eacute;)
          </div>
        </div>
      </div>

      {/* Per-product cards */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5">
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
                  className="block bg-white rounded-[10px] border border-[#deeaea] p-4 hover:border-teal-md transition-colors no-underline"
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

      {/* Agent performance leaderboard */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5 mt-4">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-dark">
              Performance des agents
            </h2>
            <p className="text-[10px] text-izi-gray mt-0.5">
              Workspace partag&eacute; (P2/P4/P5/P6/P7) &middot; class&eacute;s par
              volume de tickets trait&eacute;s
            </p>
          </div>
        </div>

        {agentsRanked.length === 0 ? (
          <p className="text-sm text-izi-gray py-6">
            {sharedStats === null
              ? "Connexion Gleap non configur\u00e9e."
              : "Aucun agent avec ticket trait\u00e9 dans ce workspace."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-izi-gray font-semibold border-b border-[#deeaea]">
                  <th className="py-2 pr-3 w-8">#</th>
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3 text-right">Tickets</th>
                  <th className="py-2 pr-3 text-right">R&eacute;solution</th>
                  <th className="py-2 text-right">SLA d&eacute;pass&eacute;s</th>
                </tr>
              </thead>
              <tbody>
                {agentsRanked.map((a, idx) => (
                  <tr
                    key={a.id}
                    className="border-b border-[#deeaea] last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-izi-gray">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-3 text-sm text-dark font-medium">
                      {a.name}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-[12px] text-dark">
                      {a.ticketsHandled}
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
