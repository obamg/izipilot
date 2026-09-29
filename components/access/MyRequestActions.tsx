// components/access/MyRequestActions.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RequestRow {
  requestId: string;
  versionId: string;
  state: string;
  stageIdIfClarification: string | null;
}

const CANCELLABLE_STATES = [
  "PENDING_APPROVAL",
  "CLARIFICATION_REQUIRED",
  "REVISION_REQUIRED",
  "AUTHORIZED_WAITING_START",
  "READY_FOR_FULFILMENT",
];

export function MyRequestActions({ row }: { row: RequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarificationText, setClarificationText] = useState("");

  async function cancel() {
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
    if (!clarificationText.trim()) return;
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

  const canCancel = CANCELLABLE_STATES.includes(row.state);

  return (
    <div className="flex flex-col gap-1">
      {error && <p className="text-[10px] text-red">{error}</p>}
      {row.state === "CLARIFICATION_REQUIRED" && row.stageIdIfClarification && (
        <div className="flex items-center gap-1">
          <input
            value={clarificationText}
            onChange={(e) => setClarificationText(e.target.value)}
            placeholder="Votre réponse..."
            className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => respondToClarification(row.stageIdIfClarification as string)}
            className="rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            Répondre
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
