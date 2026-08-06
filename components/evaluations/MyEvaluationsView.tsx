"use client";

interface Snapshot {
  deliveredPoints: number;
  committedPoints: number;
  ratio: number | null;
  tasksDone: number;
  onTimeRate: number | null;
}

interface MonthData {
  month: number;
  year: number;
  label: string;
  overall: number | null;
  deliveryScore: number | null;
  quality: number | null;
  collaboration: number | null;
  initiative: number | null;
  evaluatorCount: number;
  comments: string[];
  snapshot: Snapshot | null;
}

interface Props {
  months: MonthData[]; // most recent first
  trend: { labels: string[]; scores: (number | null)[] };
}

function scoreColor(s: number): string {
  if (s >= 4) return "var(--green)";
  if (s >= 3) return "var(--teal)";
  if (s >= 2) return "var(--gold)";
  return "var(--red)";
}

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-[8px] bg-izi-gray-lt/50 px-2.5 py-1.5">
      <div className="text-[10px] text-izi-gray">{label}</div>
      <div className="font-mono text-[15px] font-semibold" style={{ color: value != null ? scoreColor(value) : undefined }}>
        {value != null ? value.toFixed(1) : "—"}
        <span className="text-[10px] text-izi-gray">/5</span>
      </div>
    </div>
  );
}

export function MyEvaluationsView({ months, trend }: Props) {
  if (months.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center">
        <p className="text-[14px] text-dark font-medium mb-1">
          Aucune évaluation pour le moment
        </p>
        <p className="text-[12px] text-izi-gray max-w-md mx-auto">
          Vos notes apparaîtront ici une fois le mois clôturé. Elles sont
          calculées à partir de votre livraison réelle et des critères de votre
          responsable.
        </p>
      </div>
    );
  }

  const latest = months[0];
  const hasTrend = trend.scores.some((s) => s != null);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-[12px] border border-border-soft bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-izi-gray">
              Dernière note — {latest.label}
            </div>
            <div
              className="font-mono text-[34px] font-semibold leading-none mt-1"
              style={{ color: latest.overall != null ? scoreColor(latest.overall) : undefined }}
            >
              {latest.overall != null ? latest.overall.toFixed(1) : "—"}
              <span className="text-[16px] text-izi-gray">/5</span>
            </div>
          </div>
          {hasTrend && (
            <div className="flex items-end gap-1.5 h-16">
              {trend.scores.map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="flex items-end h-12">
                    {s != null ? (
                      <div
                        className="w-4 rounded-t-[3px]"
                        style={{ height: `${Math.max(8, (s / 5) * 100)}%`, backgroundColor: scoreColor(s) }}
                        title={`${trend.labels[i]} : ${s.toFixed(1)}`}
                      />
                    ) : (
                      <div className="w-4 h-[8%] rounded-t-[3px] bg-izi-gray-lt" />
                    )}
                  </div>
                  <span className="font-mono text-[9px] text-izi-gray">{trend.labels[i]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-month detail */}
      {months.map((m) => (
        <div key={`${m.year}-${m.month}`} className="rounded-[12px] border border-border-soft bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif text-[16px] text-dark">{m.label}</h3>
            <div
              className="font-mono text-[20px] font-semibold"
              style={{ color: m.overall != null ? scoreColor(m.overall) : undefined }}
            >
              {m.overall != null ? m.overall.toFixed(1) : "—"}
              <span className="text-[12px] text-izi-gray">/5</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Metric label="Livraison (auto)" value={m.deliveryScore} />
            <Metric label="Qualité" value={m.quality} />
            <Metric label="Collaboration" value={m.collaboration} />
            <Metric label="Initiative" value={m.initiative} />
          </div>

          {m.snapshot && (
            <p className="text-[11px] text-izi-gray mb-2">
              <span className="font-mono font-semibold text-dark">
                {m.snapshot.deliveredPoints}/{m.snapshot.committedPoints}
              </span>{" "}
              pts livrés · {m.snapshot.tasksDone} tâches · ponctualité{" "}
              {pct(m.snapshot.onTimeRate)}
              {m.snapshot.ratio != null && ` · ${pct(m.snapshot.ratio)} de l'engagé`}
            </p>
          )}

          {m.comments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] font-semibold text-izi-gray">Retours</div>
              {m.comments.map((c, i) => (
                <p
                  key={i}
                  className="rounded-[7px] border-l-2 border-teal-md bg-teal-lt/40 px-3 py-2 text-[12px] text-dark-md"
                >
                  {c}
                </p>
              ))}
            </div>
          )}

          <p className="mt-2 text-[10px] text-izi-gray">
            Évalué par {m.evaluatorCount} personne{m.evaluatorCount > 1 ? "s" : ""}.
          </p>
        </div>
      ))}
    </div>
  );
}
