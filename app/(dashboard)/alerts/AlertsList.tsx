"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { AlertSeverity, AlertType, KrStatus } from "@prisma/client";

interface AlertData {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
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
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");

  const filtered = alerts.filter((a) => {
    if (filter === "active" && a.isResolved) return false;
    if (filter === "resolved" && !a.isResolved) return false;
    if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
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
        <div className="flex gap-0.5 bg-white rounded-lg border border-[#deeaea] p-0.5">
          {(["active", "all", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                filter === f
                  ? "bg-teal text-white"
                  : "text-izi-gray hover:bg-izi-gray-lt"
              }`}
            >
              {f === "active" ? "Actives" : f === "all" ? "Toutes" : "R\u00e9solues"}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AlertType | "ALL")}
          className="px-3 py-1.5 rounded-lg border border-[#deeaea] bg-white text-[11px] text-dark font-sans"
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
          <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
            <p className="text-sm text-izi-gray">Aucune alerte trouv&eacute;e.</p>
          </div>
        )}

        {filtered.map((alert) => {
          const sevConfig = SEVERITY_COLORS[alert.severity];
          const isResolving = resolvingId === alert.id;

          return (
            <div
              key={alert.id}
              className={`bg-white rounded-[10px] border border-[#deeaea] p-4 ${
                alert.isResolved ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Severity indicator */}
                <div
                  className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0 text-xs mt-0.5"
                  style={{ backgroundColor: sevConfig.text }}
                >
                  {alert.severity === "CRITICAL" || alert.severity === "HIGH"
                    ? "\uD83D\uDD34"
                    : alert.severity === "MEDIUM"
                    ? "\uD83D\uDFE1"
                    : "\u26AA"}
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
                        className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans resize-none h-[60px] leading-relaxed"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleResolve(alert.id)}
                          disabled={!resolution.trim() || isPending}
                          className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
                        >
                          Confirmer
                        </button>
                        <button
                          onClick={() => {
                            setResolvingId(null);
                            setResolution("");
                          }}
                          className="px-3 py-1.5 rounded-md text-[11px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
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
