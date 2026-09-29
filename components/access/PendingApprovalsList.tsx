// components/access/PendingApprovalsList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

export function PendingApprovalsList({ items }: { items: PendingItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [escalateById, setEscalateById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(stageId: string, decision: "APPROVE" | "REJECT" | "CLARIFY" | "RETURN") {
    setError(null);
    const rawReason = reasonById[stageId]?.trim() ?? "";
    const reason = rawReason.length > 0 ? rawReason : null;
    if (decision !== "APPROVE" && !reason) {
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

  if (items.length === 0) {
    return <p className="text-[12px] text-izi-gray">Aucune approbation en attente.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[12px] text-red">{error}</p>}
      {items.map((item) => (
        <div key={item.stageId} className="rounded-[10px] border border-border-soft bg-white p-4">
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
                checked={escalateById[item.stageId] ?? false}
                onChange={(e) => setEscalateById((s) => ({ ...s, [item.stageId]: e.target.checked }))}
                aria-label={`Escalader vers COO après approbation pour ${item.beneficiaryName}`}
                className="accent-[color:var(--teal)]"
              />
              Escalader vers COO après approbation
            </label>
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
      ))}
    </div>
  );
}
