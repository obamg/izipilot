import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";

interface ProductMetrics {
  npsScore: number | null;
  csatPercent: number | null;
  openTickets: number | null;
  avgResponseHours: number | null;
}

// TODO(gleap): replace with live data from Gleap API/webhook ingestion.
// Mapping {productCode -> Gleap project} should be configured per org.
const STUB_METRICS: Record<string, ProductMetrics> = {
  P1: { npsScore: 32, csatPercent: 78, openTickets: 14, avgResponseHours: 6.2 },
  P2: { npsScore: 51, csatPercent: 88, openTickets: 7, avgResponseHours: 3.4 },
  P3: { npsScore: 44, csatPercent: 82, openTickets: 22, avgResponseHours: 8.1 },
  P4: { npsScore: null, csatPercent: null, openTickets: null, avgResponseHours: null },
  P5: { npsScore: null, csatPercent: null, openTickets: null, avgResponseHours: null },
  P6: { npsScore: 38, csatPercent: 80, openTickets: 11, avgResponseHours: 5.5 },
  P7: { npsScore: null, csatPercent: null, openTickets: null, avgResponseHours: null },
};

function npsColor(nps: number | null): string {
  if (nps === null) return "var(--gray)";
  if (nps >= 50) return "var(--green)";
  if (nps >= 20) return "var(--gold)";
  return "var(--red)";
}

function csatColor(csat: number | null): string {
  if (csat === null) return "var(--gray)";
  if (csat >= 85) return "var(--green)";
  if (csat >= 70) return "var(--gold)";
  return "var(--red)";
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

function MetricTile({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
}) {
  return (
    <div className="bg-izi-gray-lt/60 rounded-[8px] px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wide text-izi-gray font-semibold">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-base font-bold" style={{ color }}>
          {value}
        </span>
        {unit && (
          <span className="text-[10px] text-izi-gray font-medium">{unit}</span>
        )}
      </div>
    </div>
  );
}

export default async function CustomerMetricsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const products = await prisma.product.findMany({
    where: { orgId, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, color: true, status: true },
  });

  // Aggregate org-wide KPIs from products that have data
  const withData = products
    .map((p) => STUB_METRICS[p.code])
    .filter((m): m is ProductMetrics => !!m && m.npsScore !== null);

  const avg = (vals: number[]) =>
    vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  const orgNps = avg(withData.map((m) => m.npsScore!).filter((v) => v !== null));
  const orgCsat = avg(
    withData.map((m) => m.csatPercent!).filter((v) => v !== null)
  );
  const orgTickets = withData
    .map((m) => m.openTickets ?? 0)
    .reduce((a, b) => a + b, 0);
  const orgResponse = avg(
    withData.map((m) => m.avgResponseHours!).filter((v) => v !== null)
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="font-serif text-[20px] text-dark">
            Performance client
          </h1>
          <p className="text-[11px] text-izi-gray mt-0.5">
            NPS, CSAT, tickets et temps de r&eacute;ponse par produit
          </p>
        </div>
        <div className="text-[10px] text-izi-gray bg-gold-lt border border-[#e6d28a] rounded-[6px] px-2.5 py-1.5">
          Donn&eacute;es de d&eacute;monstration &middot;{" "}
          <span className="font-semibold text-dark">
            int&eacute;gration Gleap &agrave; venir
          </span>
        </div>
      </div>

      {/* Org-wide KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            NPS moyen
          </div>
          <div
            className="font-serif text-2xl leading-none"
            style={{ color: npsColor(orgNps) }}
          >
            {orgNps !== null ? Math.round(orgNps) : "\u2014"}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            CSAT moyen
          </div>
          <div
            className="font-serif text-2xl leading-none"
            style={{ color: csatColor(orgCsat) }}
          >
            {orgCsat !== null ? `${Math.round(orgCsat)}%` : "\u2014"}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            Tickets ouverts
          </div>
          <div
            className="font-serif text-2xl leading-none"
            style={{ color: ticketColor(orgTickets) }}
          >
            {orgTickets}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#deeaea] px-5 py-4">
          <div className="text-xs font-semibold tracking-wide uppercase text-izi-gray mb-2">
            R&eacute;ponse moyenne
          </div>
          <div
            className="font-serif text-2xl leading-none"
            style={{ color: responseColor(orgResponse) }}
          >
            {orgResponse !== null ? `${orgResponse.toFixed(1)}h` : "\u2014"}
          </div>
        </div>
      </div>

      {/* Per-product cards */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5">
        <h2 className="text-base font-semibold text-dark mb-4">Par produit</h2>

        {products.length === 0 ? (
          <p className="text-sm text-izi-gray py-6">
            Aucun produit actif.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {products.map((p) => {
              const m = STUB_METRICS[p.code] ?? {
                npsScore: null,
                csatPercent: null,
                openTickets: null,
                avgResponseHours: null,
              };
              const hasData =
                m.npsScore !== null ||
                m.csatPercent !== null ||
                m.openTickets !== null ||
                m.avgResponseHours !== null;

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
                    <span className="text-[9px] uppercase tracking-wide text-izi-gray font-semibold">
                      {p.status}
                    </span>
                  </div>

                  {hasData ? (
                    <div className="grid grid-cols-2 gap-2">
                      <MetricTile
                        label="NPS"
                        value={m.npsScore !== null ? String(m.npsScore) : "\u2014"}
                        color={npsColor(m.npsScore)}
                      />
                      <MetricTile
                        label="CSAT"
                        value={
                          m.csatPercent !== null ? String(m.csatPercent) : "\u2014"
                        }
                        unit={m.csatPercent !== null ? "%" : undefined}
                        color={csatColor(m.csatPercent)}
                      />
                      <MetricTile
                        label="Tickets ouverts"
                        value={
                          m.openTickets !== null ? String(m.openTickets) : "\u2014"
                        }
                        color={ticketColor(m.openTickets)}
                      />
                      <MetricTile
                        label="R&eacute;ponse moyenne"
                        value={
                          m.avgResponseHours !== null
                            ? m.avgResponseHours.toFixed(1)
                            : "\u2014"
                        }
                        unit={m.avgResponseHours !== null ? "h" : undefined}
                        color={responseColor(m.avgResponseHours)}
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-izi-gray italic py-2">
                      Pas encore connect&eacute; &agrave; Gleap.
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
