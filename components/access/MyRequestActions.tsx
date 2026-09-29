// components/access/MyRequestActions.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RequestRow {
  requestId: string;
  versionId: string;
  state: string;
  stageIdIfClarification: string | null;
  assetId: string;
  targetLevelId: string | null;
  justification: string;
}

interface AssetOption {
  id: string;
  name: string;
  levels: { id: string; name: string }[];
}

const CANCELLABLE_STATES = [
  "PENDING_APPROVAL",
  "CLARIFICATION_REQUIRED",
  "REVISION_REQUIRED",
  "AUTHORIZED_WAITING_START",
  "READY_FOR_FULFILMENT",
];

export function MyRequestActions({ row, assets }: { row: RequestRow; assets: AssetOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarificationText, setClarificationText] = useState("");

  const levels = assets.find((a) => a.id === row.assetId)?.levels ?? [];
  // Le niveau visé à l'origine peut avoir été archivé/désactivé depuis
  // (la liste `levels` ci-dessus est déjà filtrée `enabled: true,
  // archivedAt: null` côté page.tsx) — ne présélectionner que s'il est
  // toujours une option valide, sinon laisser le select vide plutôt que de
  // planter ou de présélectionner silencieusement un niveau inexistant.
  const initialLevelId =
    row.targetLevelId && levels.some((l) => l.id === row.targetLevelId) ? row.targetLevelId : "";
  const [reviseLevelId, setReviseLevelId] = useState(initialLevelId);
  const [reviseJustification, setReviseJustification] = useState(row.justification);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/requests/${row.requestId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de l'annulation");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function respondToClarification(stageId: string) {
    if (busy || !clarificationText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/requests/stages/${stageId}/clarification-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: clarificationText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de la réponse");
      }
      setClarificationText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function revise() {
    if (busy || !reviseLevelId || !reviseJustification.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/requests/versions/${row.versionId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetLevelId: reviseLevelId,
          justification: reviseJustification,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de la révision");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  const canCancel = CANCELLABLE_STATES.includes(row.state);
  const canRevise = row.state === "REVISION_REQUIRED";

  return (
    <div className="flex flex-col gap-1">
      {error && <p className="text-[10px] text-red">{error}</p>}
      {row.state === "CLARIFICATION_REQUIRED" && row.stageIdIfClarification && (
        <div className="flex items-center gap-1">
          <input
            value={clarificationText}
            onChange={(e) => setClarificationText(e.target.value)}
            placeholder="Votre réponse..."
            aria-label="Réponse à la clarification"
            className="izi-form-input w-28 min-w-0 rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark"
          />
          <button
            type="button"
            disabled={busy || !clarificationText.trim()}
            onClick={() => respondToClarification(row.stageIdIfClarification as string)}
            className="shrink-0 rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            Répondre
          </button>
        </div>
      )}
      {canRevise && (
        <div className="flex flex-col gap-1">
          <select
            value={reviseLevelId}
            onChange={(e) => setReviseLevelId(e.target.value)}
            aria-label="Niveau visé (révision)"
            className="izi-form-input w-full rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark bg-white"
          >
            <option value="">Choisir un niveau...</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <textarea
            value={reviseJustification}
            onChange={(e) => setReviseJustification(e.target.value)}
            rows={2}
            aria-label="Justification (révision)"
            className="izi-form-input w-full rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark bg-white"
          />
          <button
            type="button"
            disabled={busy || !reviseLevelId || !reviseJustification.trim()}
            onClick={revise}
            className="shrink-0 rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50 self-start"
          >
            Réviser
          </button>
        </div>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          className="text-[10px] text-red underline text-left"
        >
          Annuler la demande
        </button>
      )}
    </div>
  );
}
