"use client";

import type { UserRole } from "@prisma/client";

interface MonthRef {
  month: number;
  year: number;
  label: string;
}

export interface TrendData {
  months: MonthRef[];
  perPerson: {
    id: string;
    name: string;
    role: UserRole;
    scores: (number | null)[];
    average: number | null;
  }[];
  isManagement: boolean;
  perDepartment: { code: string; name: string; color: string; average: number | null }[];
  orgSeries: (number | null)[];
}

const ROLE_LABELS: Record<UserRole, string> = {
  CEO: "CEO",
  MANAGEMENT: "Management",
  PO: "PO",
  CONTRIBUTOR: "Contributeur",
  VIEWER: "Observateur",
};

function scoreColor(s: number): string {
  if (s >= 4) return "var(--green)";
  if (s >= 3) return "var(--teal)";
  if (s >= 2) return "var(--gold)";
  return "var(--red)";
}

function Bars({ scores, labels }: { scores: (number | null)[]; labels: string[] }) {
  return (
    <div className="grid grid-cols-6 gap-1 w-[168px]">
      {scores.map((s, i) => (
        <div key={i} className="flex h-8 items-end justify-center" title={`${labels[i]} : ${s != null ? s.toFixed(1) : "—"}`}>
          {s != null ? (
            <div
              className="w-full rounded-[2px]"
              style={{ height: `${Math.max(8, (s / 5) * 100)}%`, backgroundColor: scoreColor(s) }}
            />
          ) : (
            <div className="w-full h-[8%] rounded-[2px] bg-izi-gray-lt" />
          )}
        </div>
      ))}
    </div>
  );
}

function AvgBadge({ value }: { value: number | null }) {
  return (
    <div className="w-[52px] text-right font-mono">
      {value != null ? (
        <span className="text-[15px] font-semibold" style={{ color: scoreColor(value) }}>
          {value.toFixed(1)}
        </span>
      ) : (
        <span className="text-[13px] text-izi-gray">—</span>
      )}
      <span className="text-[10px] text-izi-gray">/5</span>
    </div>
  );
}

export function EvaluationTrends({ trend }: { trend: TrendData }) {
  const { months, perPerson, isManagement, perDepartment, orgSeries } = trend;
  const labels = months.map((m) => m.label);

  const people = [...perPerson].sort((a, b) => {
    if (a.average == null && b.average == null) return a.name.localeCompare(b.name, "fr");
    if (a.average == null) return 1;
    if (b.average == null) return -1;
    return b.average - a.average;
  });

  const orgAvg = orgSeries.filter((v): v is number => v != null).slice(-1)[0] ?? null;

  return (
    <div className="space-y-4">
      {isManagement && (
        <div className="rounded-[12px] border border-border-soft bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray">
              Tendance de l&apos;équipe
            </h2>
            <span className="text-[11px] text-izi-gray">
              moyenne {months[months.length - 1]?.label} :{" "}
              <span className="font-mono font-semibold text-dark">
                {orgAvg != null ? orgAvg.toFixed(1) : "—"}
              </span>
              /5
            </span>
          </div>
          <div className="flex items-end justify-between gap-2 h-24">
            {orgSeries.map((s, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center h-16">
                  {s != null ? (
                    <div
                      className="w-full max-w-[36px] rounded-t-[3px]"
                      style={{ height: `${Math.max(6, (s / 5) * 100)}%`, backgroundColor: scoreColor(s) }}
                      title={`${labels[i]} : ${s.toFixed(1)}`}
                    />
                  ) : (
                    <div className="w-full max-w-[36px] h-[6%] rounded-t-[3px] bg-izi-gray-lt" />
                  )}
                </div>
                <span className="font-mono text-[9px] text-izi-gray">{labels[i]}</span>
                <span className="font-mono text-[10px] font-semibold text-dark">
                  {s != null ? s.toFixed(1) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-person trend */}
      <div className="rounded-[12px] border border-border-soft bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray">
            Par personne
          </h2>
          <div className="flex items-center gap-3">
            <div className="grid grid-cols-6 gap-1 w-[168px]">
              {labels.map((l, i) => (
                <span key={i} className="text-center font-mono text-[9px] text-izi-gray">
                  {l}
                </span>
              ))}
            </div>
            <span className="w-[52px] text-right text-[9px] text-izi-gray">Moy.</span>
          </div>
        </div>
        {people.length === 0 ? (
          <p className="text-[13px] text-izi-gray py-4 text-center">Aucune donnée.</p>
        ) : (
          <div className="divide-y divide-border-soft">
            {people.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-dark truncate">{p.name}</div>
                  <div className="text-[10px] text-izi-gray">{ROLE_LABELS[p.role]}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Bars scores={p.scores} labels={labels} />
                  <AvgBadge value={p.average} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Department rollup (management only) */}
      {isManagement && perDepartment.length > 0 && (
        <div className="rounded-[12px] border border-border-soft bg-white p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray mb-3">
            Par département — moyenne sur {months.length} mois
          </h2>
          <div className="space-y-2">
            {[...perDepartment]
              .sort((a, b) => (b.average ?? 0) - (a.average ?? 0))
              .map((d) => (
                <div key={d.code} className="flex items-center gap-3">
                  <span
                    className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: d.color, backgroundColor: `${d.color}1a` }}
                  >
                    {d.code}
                  </span>
                  <span className="text-[12px] text-dark w-40 truncate">{d.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-izi-gray-lt overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${((d.average ?? 0) / 5) * 100}%`,
                        backgroundColor: scoreColor(d.average ?? 0),
                      }}
                    />
                  </div>
                  <span className="w-[52px] text-right font-mono text-[13px] font-semibold text-dark">
                    {d.average != null ? d.average.toFixed(1) : "—"}
                    <span className="text-[10px] text-izi-gray">/5</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
