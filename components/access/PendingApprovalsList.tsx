// components/access/PendingApprovalsList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { splitBatchSelection } from "@/lib/access/batch-selection";

interface PendingItem {
  stageId: string;
  stageRole: string;
  beneficiaryName: string;
  assetName: string;
  targetLevelName: string | null;
  kind: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_HEAD: "Chef de département",
  CISO: "CISO",
  COO: "COO",
};

interface BatchResult {
  stageId: string;
  ok: boolean;
  error: string | null;
}

export function PendingApprovalsList({ items }: { items: PendingItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [escalateById, setEscalateById] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(stageId: string, decision: "APPROVE" | "REJECT" | "CLARIFY" | "RETURN") {
    setError(null);
    const rawReason = reasonById[stageId]?.trim() ?? "";
    const reason = rawReason.length > 0 ? rawReason : null;
    const isEscalating = decision === "APPROVE" && (escalateById[stageId] ?? false);
    if ((decision !== "APPROVE" || isEscalating) && !reason) {
      setError("Un motif est obligatoire pour cette décision");
      return;
    }
    setBusyId(stageId);
    try {
      const res = await fetch(`/api/access/requests/stages/${stageId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason, escalateToCoo: escalateById[stageId] ?? false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de la décision");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusyId(null);
    }
  }

  // Une étape avec escalade cochée n'entre jamais dans le lot (voir
  // splitBatchSelection) : sa case de sélection est désactivée et, par
  // défense en profondeur, elle est de toute façon retirée ici.
  const { approvable: selectedIds } = splitBatchSelection(selected, escalateById);

  function toggleEscalate(stageId: string, checked: boolean) {
    setEscalateById((s) => ({ ...s, [stageId]: checked }));
    if (checked) setSelected((s) => ({ ...s, [stageId]: false }));
  }

  async function decideBatchApprove() {
    setError(null);
    setBatchResults(null);
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      const res = await fetch("/api/access/requests/decide-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedIds.map((stageId) => ({ stageId, decision: "APPROVE", reason: null })),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error ?? "Échec du lot");
      }
      setBatchResults(payload.data);
      setSelected({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBatchBusy(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-[12px] text-izi-gray">Aucune approbation en attente.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[12px] text-red">{error}</p>}
      {selectedIds.length > 0 && (
        <div className="rounded-[8px] bg-teal-lt p-3 flex items-center justify-between">
          <span className="text-[12px] text-teal-dk">{selectedIds.length} sélectionnée(s)</span>
          <button
            type="button"
            disabled={batchBusy}
            onClick={decideBatchApprove}
            className="rounded-[6px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            {batchBusy ? "Approbation..." : "Approuver la sélection"}
          </button>
        </div>
      )}
      {batchResults && (
        <p className="text-[11px] text-izi-gray">
          {batchResults.filter((r) => r.ok).length} approuvée(s), {batchResults.filter((r) => !r.ok).length} en erreur.
        </p>
      )}
      {items.map((item) => {
        const isEscalating = escalateById[item.stageId] ?? false;
        return (
        <div key={item.stageId} className="rounded-[10px] border border-border-soft bg-white p-4">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!isEscalating && (selected[item.stageId] ?? false)}
              disabled={isEscalating}
              onChange={(e) => setSelected((s) => ({ ...s, [item.stageId]: e.target.checked }))}
              className="mt-1 accent-[color:var(--teal)] disabled:opacity-40"
              aria-label={
                isEscalating
                  ? `Sélection indisponible pour ${item.beneficiaryName} : escalade requise, à traiter individuellement`
                  : `Sélectionner la demande de ${item.beneficiaryName}`
              }
            />
            <div className="flex-1">
              <p className="text-[13px] text-dark mb-1">
                <strong>{item.beneficiaryName}</strong> — {item.kind} — {item.assetName}
                {item.targetLevelName ? ` (${item.targetLevelName})` : ""}
              </p>
              <p className="text-[11px] text-izi-gray mb-2">Étape : {ROLE_LABELS[item.stageRole] ?? item.stageRole}</p>
              <textarea
                value={reasonById[item.stageId] ?? ""}
                onChange={(e) => setReasonById((s) => ({ ...s, [item.stageId]: e.target.value }))}
                placeholder="Motif (obligatoire sauf pour approuver)"
                rows={2}
                aria-label={`Motif de la décision pour ${item.beneficiaryName}`}
                className="izi-form-input w-full rounded-[6px] border border-teal-md px-2 py-1 text-[11px] mb-2"
              />
              {item.stageRole === "CISO" && (
                <label className="flex items-center gap-1 text-[11px] text-izi-gray mb-2">
                  <input
                    type="checkbox"
                    checked={isEscalating}
                    onChange={(e) => toggleEscalate(item.stageId, e.target.checked)}
                    aria-label={`Escalader vers COO après approbation pour ${item.beneficiaryName}`}
                    className="accent-[color:var(--teal)]"
                  />
                  Escalader vers COO après approbation
                </label>
              )}
              {isEscalating && (
                <p className="text-[11px] text-dark-md mb-2">
                  Escalade requise — à traiter individuellement (exclue de l&apos;approbation en lot).
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "APPROVE")}
                  className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
                >
                  Approuver
                </button>
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "REJECT")}
                  className="rounded-[6px] bg-red px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Rejeter
                </button>
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "CLARIFY")}
                  className="rounded-[6px] bg-gold px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Demander clarification
                </button>
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "RETURN")}
                  className="rounded-[6px] border border-teal-md px-2.5 py-1 text-[11px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50"
                >
                  Retourner
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
