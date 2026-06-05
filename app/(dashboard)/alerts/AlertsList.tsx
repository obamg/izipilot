"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { AlertSeverity, AlertSource, AlertType, KrStatus } from "@prisma/client";

interface AlertData {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  source: AlertSource;
  message: string;
  isResolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  krTitle: string;
  krScore: number;
  krStatus: KrStatus;
  entityCode: string;
  entityName: string;
  triggeredByName: string;
  resolvedByName: string | null;
  poNotes: {
    blocker: string | null;
    proposedSolution: string | null;
    actionNeeded: string | null;
    comment: string | null;
    weekNumber: number;
    year: number;
  } | null;
}

interface AlertsListProps {
  alerts: AlertData[];
  canResolve: boolean;
}

const SEVERITY_COLORS: Record<AlertSeverity, { bg: string; text: string; label: string }> = {
  CRITICAL: { bg: "var(--red-lt)", text: "var(--red)", label: "Critique" },
  HIGH: { bg: "var(--red-lt)", text: "#8b1a1a", label: "Haute" },
  MEDIUM: { bg: "var(--gold-lt)", text: "#7a5500", label: "Moyenne" },
  LOW: { bg: "var(--gray-lt)", text: "var(--gray)", label: "Basse" },
};

const TYPE_LABELS: Record<AlertType, string> = {
  KR_BLOCKED: "KR Bloqu\u00e9",
  KR_DECLINING: "KR en baisse",
  ENTRY_MISSING: "Revue manquante",
  ESCALATION_48H: "Escalade 48h",
  SCORE_BELOW_40: "Score < 40%",
};

export function AlertsList({ alerts, canResolve }: AlertsListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("active");
  const [typeFilter, setTypeFilter] = useState<AlertType | "ALL">("ALL");
  const [sourceFilter, setSourceFilter] = useState<AlertSource | "ALL">("ALL");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");

  const filtered = alerts.filter((a) => {
    if (filter === "active" && a.isResolved) return false;
    if (filter === "resolved" && !a.isResolved) return false;
    if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
    if (sourceFilter !== "ALL" && a.source !== sourceFilter) return false;
    return true;
  });

  async function handleResolve(alertId: string) {
    if (!resolution.trim()) return;

    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, resolution }),
      });

      if (res.ok) {
        setResolvingId(null);
        setResolution("");
        startTransition(() => router.refresh());
      }
    } catch (err) {
      console.error("Failed to resolve alert:", err);
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex gap-0.5 bg-white rounded-lg border border-border-soft p-0.5">
          {(["active", "all", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`min-h-[44px] md:min-h-0 px-3 py-2 md:py-1.5 rounded-md text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal transition-colors ${
                filter === f
                  ? "bg-teal text-white"
                  : "text-izi-gray hover:bg-izi-gray-lt"
              }`}
            >
              {f === "active" ? "Actives" : f === "all" ? "Toutes" : "R\u00e9solues"}
            </button>
          ))}
        </div>

        <div className="flex gap-0.5 bg-white rounded-lg border border-border-soft p-0.5">
          {(
            [
              { v: "ALL", label: "Toutes sources" },
              { v: "AUTOMATIC", label: "Automatiques" },
              { v: "MANUAL", label: "Manuelles" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              onClick={() => setSourceFilter(opt.v as AlertSource | "ALL")}
              className={`min-h-[44px] md:min-h-0 px-3 py-2 md:py-1.5 rounded-md text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal transition-colors ${
                sourceFilter === opt.v
                  ? "bg-teal text-white"
                  : "text-izi-gray hover:bg-izi-gray-lt"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AlertType | "ALL")}
          className="izi-form-input min-h-[44px] md:min-h-0 px-3 py-2 md:py-1.5 rounded-lg border border-border-soft bg-white text-dark font-sans"
        >
          <option value="ALL">Tous les types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Alert cards */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-white rounded-[10px] border border-border-soft p-8 text-center">
            <p className="text-sm text-izi-gray">Aucune alerte trouv&eacute;e.</p>
          </div>
        )}

        {filtered.map((alert) => {
          const sevConfig = SEVERITY_COLORS[alert.severity];
          const isResolving = resolvingId === alert.id;

          return (
            <div
              key={alert.id}
              className={`bg-white rounded-[10px] border border-border-soft p-4 ${
                alert.isResolved ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Severity indicator \u2014 SVG glyph on colored chip */}
                <div
                  className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: sevConfig.text }}
                  aria-hidden="true"
                >
                  {alert.severity === "CRITICAL" || alert.severity === "HIGH" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  ) : alert.severity === "MEDIUM" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="white" className="w-2.5 h-2.5">
                      <circle cx="12" cy="12" r="5" />
                    </svg>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-dark">
                      {alert.entityCode} &mdash; {alert.krTitle}
                    </span>
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium"
                      style={{ backgroundColor: sevConfig.bg, color: sevConfig.text }}
                    >
                      {sevConfig.label}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-izi-gray-lt text-izi-gray font-medium">
                      {TYPE_LABELS[alert.type]}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        alert.source === "MANUAL"
                          ? "bg-teal-lt text-teal-dk"
                          : "bg-izi-gray-lt text-izi-gray"
                      }`}
                      title={
                        alert.source === "MANUAL"
                          ? `Soulev\u00e9e manuellement par ${alert.triggeredByName}`
                          : "D\u00e9tection automatique"
                      }
                    >
                      {alert.source === "MANUAL" ? "Manuelle" : "Auto"}
                    </span>
                    {alert.isResolved && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-izi-green-lt text-izi-green font-medium">
                        R&eacute;solu
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] text-izi-gray mt-1">
                    {alert.message}
                  </p>

                  <div className="flex items-center gap-3 mt-1.5 text-[9px] text-izi-gray">
                    <span>Score: <span className="font-mono font-semibold">{alert.krScore}%</span></span>
                    <span>&middot;</span>
                    <span>{formatDate(alert.createdAt)}</span>
                    {alert.resolvedByName && (
                      <>
                        <span>&middot;</span>
                        <span>R&eacute;solu par {alert.resolvedByName}</span>
                      </>
                    )}
                  </div>

                  {(alert.type === "KR_BLOCKED" || alert.type === "ESCALATION_48H") &&
                    alert.poNotes &&
                    (alert.poNotes.blocker ||
                      alert.poNotes.proposedSolution ||
                      alert.poNotes.actionNeeded ||
                      alert.poNotes.comment) && (
                      <div className="mt-2 p-2 bg-izi-gray-lt rounded text-[10px] text-dark space-y-1.5 border-l-2 border-red">
                        <div className="text-[9px] font-semibold text-izi-gray uppercase tracking-wide">
                          Note du PO &mdash; semaine {alert.poNotes.weekNumber}/{alert.poNotes.year}
                        </div>
                        {alert.poNotes.blocker && (
                          <div>
                            <span className="font-semibold">Blocage :</span>{" "}
                            {alert.poNotes.blocker}
                          </div>
                        )}
                        {alert.poNotes.proposedSolution && (
                          <div>
                            <span className="font-semibold">Solution propos&eacute;e :</span>{" "}
                            {alert.poNotes.proposedSolution}
                          </div>
                        )}
                        {alert.poNotes.actionNeeded && (
                          <div>
                            <span className="font-semibold">Besoin :</span>{" "}
                            {alert.poNotes.actionNeeded}
                          </div>
                        )}
                        {alert.poNotes.comment && (
                          <div>
                            <span className="font-semibold">Commentaire :</span>{" "}
                            {alert.poNotes.comment}
                          </div>
                        )}
                      </div>
                    )}

                  {alert.resolution && (
                    <div className="mt-2 p-2 bg-izi-green-lt rounded text-[10px] text-dark">
                      <span className="font-semibold">R&eacute;solution :</span>{" "}
                      {alert.resolution}
                    </div>
                  )}

                  {/* Resolve form */}
                  {isResolving && (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        placeholder="D&eacute;crivez la r&eacute;solution / d&eacute;cision prise..."
                        className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans resize-none min-h-[60px] leading-relaxed"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleResolve(alert.id)}
                          disabled={!resolution.trim() || isPending}
                          className="min-h-[44px] md:min-h-0 px-3 py-2 md:py-1.5 rounded-md text-[11px] font-medium bg-teal text-white hover:bg-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-1 transition-colors disabled:opacity-50"
                        >
                          Confirmer
                        </button>
                        <button
                          onClick={() => {
                            setResolvingId(null);
                            setResolution("");
                          }}
                          className="min-h-[44px] md:min-h-0 px-3 py-2 md:py-1.5 rounded-md text-[11px] font-medium text-izi-gray hover:bg-izi-gray-lt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-1 transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {canResolve && !alert.isResolved && !isResolving && (
                  <button
                    onClick={() => setResolvingId(alert.id)}
                    className="text-[10px] font-semibold text-teal border border-teal-md bg-transparent px-[9px] py-[3px] rounded-[5px] cursor-pointer font-sans shrink-0 hover:bg-teal-lt transition-colors"
                  >
                    D&eacute;cider
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
