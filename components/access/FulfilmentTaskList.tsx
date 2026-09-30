"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FulfilmentTaskDTO } from "@/lib/access/fulfilment-read-server";
import { shortTaskReference } from "@/lib/access/fulfilment";
import { FulfilmentTaskCard, nowForDateTimeInput } from "./FulfilmentTaskCard";

interface BatchItemResult {
  taskId: string;
  ok: boolean;
  error: string | null;
}

interface Evidence {
  reference: string;
  note: string;
  method: "DIRECT" | "REMOVE_THEN_GRANT";
}

const EMPTY_EVIDENCE: Evidence = { reference: "", note: "", method: "DIRECT" };

const inputClass =
  "izi-form-input w-full rounded-[6px] border border-teal-md bg-white px-2 py-2 text-[13px] text-dark";
const primaryButton =
  "rounded-[6px] bg-teal px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-dk disabled:opacity-50";
const secondaryButton =
  "rounded-[6px] border border-teal-md bg-white px-3 py-2 text-[13px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50";

interface Props {
  rows: FulfilmentTaskDTO[];
  /** Supervision CISO/COO : aucune action. */
  readOnly: boolean;
  /** Onglet « À faire » : sélection multiple pour réclamer / confirmer en lot. */
  selectable: boolean;
  emptyMessage: string;
}

export function FulfilmentTaskList({ rows, readOnly, selectable, emptyMessage }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [completedAtLocal, setCompletedAtLocal] = useState("");
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);

  const chosen = rows.filter((r) => selected[r.id]);
  const claimable = chosen.filter((r) => r.viewerCan.claim);
  const completable = chosen.filter((r) => r.viewerCan.complete);
  const referenceOf = (taskId: string) => rows.find((r) => r.id === taskId)?.reference ?? shortTaskReference(taskId);
  const evidenceOf = (taskId: string) => evidence[taskId] ?? EMPTY_EVIDENCE;
  const setEvidenceOf = (taskId: string, patch: Partial<Evidence>) =>
    setEvidence((all) => ({ ...all, [taskId]: { ...(all[taskId] ?? EMPTY_EVIDENCE), ...patch } }));

  async function sendBatch(path: "claim-batch" | "complete-batch", items: unknown[]) {
    if (busy || items.length === 0) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/access/tasks/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Échec du lot");
      setResults(payload.data.results as BatchItemResult[]);
      setSelected({});
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function claimSelection() {
    void sendBatch(
      "claim-batch",
      claimable.map((r) => ({ taskId: r.id, expectedRevision: r.revision }))
    );
  }

  function completeSelection() {
    if (!completedAtLocal) {
      setError("Indiquez la date réelle d'exécution");
      return;
    }
    const missing = completable.find((r) => !evidenceOf(r.id).reference.trim() && !evidenceOf(r.id).note.trim());
    if (missing) {
      setError(`Référence ou note manquante pour ${missing.reference}`);
      return;
    }
    const completedAt = new Date(completedAtLocal).toISOString();
    void sendBatch(
      "complete-batch",
      completable.map((r) => {
        const e = evidenceOf(r.id);
        return {
          taskId: r.id,
          expectedRevision: r.revision,
          completedAt,
          reference: e.reference,
          note: e.note,
          ...(r.action === "CHANGE_LEVEL" ? { method: r.oldRemovedAt ? "REMOVE_THEN_GRANT" : e.method } : {}),
        };
      })
    );
  }

  if (rows.length === 0 && !results) {
    return (
      <div className="rounded-[10px] border border-border-soft bg-white p-6 text-center">
        <p className="text-[15px] text-izi-gray">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {results && (
        <div className="mb-3 rounded-[10px] border border-border-soft bg-white p-3" role="status">
          <p className="text-[13px] font-medium text-dark">
            Résultat du lot : {results.filter((r) => r.ok).length} réussie(s), {results.filter((r) => !r.ok).length} en échec
          </p>
          <ul className="mt-1 space-y-0.5">
            {results.map((r) => (
              <li key={r.taskId} className={`text-[13px] ${r.ok ? "text-dark-md" : "text-red"}`}>
                {referenceOf(r.taskId)} — {r.ok ? "fait" : r.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-2 text-[13px] text-red">
          {error}
        </p>
      )}

      {selectable && chosen.length > 0 && !confirming && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-teal-md bg-teal-lt p-3">
          <span className="text-[13px] text-dark">{chosen.length} sélectionnée(s)</span>
          <button type="button" disabled={busy || claimable.length === 0} onClick={claimSelection} className={primaryButton}>
            Réclamer la sélection ({claimable.length})
          </button>
          <button
            type="button"
            disabled={busy || completable.length === 0}
            onClick={() => {
              setError(null);
              setCompletedAtLocal(nowForDateTimeInput());
              setConfirming(true);
            }}
            className={primaryButton}
          >
            Confirmer la sélection ({completable.length})
          </button>
        </div>
      )}

      {confirming && (
        <div className="mb-3 flex flex-col gap-3 rounded-[10px] border border-teal-md bg-white p-3">
          <h2 className="font-serif text-[18px] text-dark">Confirmer {completable.length} tâche(s)</h2>
          <label className="text-[13px] text-dark">
            Date et heure réelles (communes)
            <input
              type="datetime-local"
              value={completedAtLocal}
              onChange={(e) => setCompletedAtLocal(e.target.value)}
              className={inputClass}
            />
          </label>
          <p className="text-[11px] text-izi-gray">
            Chaque tâche porte sa propre référence ou note. N&apos;écrivez jamais de mot de passe ni de secret.
          </p>
          {completable.map((r) => (
            <fieldset key={r.id} className="rounded-[8px] bg-gray-lt p-2">
              <legend className="text-[13px] font-medium text-dark">
                {r.reference} · {r.beneficiaryName} · {r.assetName}
              </legend>
              <label className="text-[13px] text-dark">
                Référence
                <input
                  value={evidenceOf(r.id).reference}
                  onChange={(e) => setEvidenceOf(r.id, { reference: e.target.value })}
                  maxLength={200}
                  className={inputClass}
                />
              </label>
              <label className="text-[13px] text-dark">
                Note
                <input
                  value={evidenceOf(r.id).note}
                  onChange={(e) => setEvidenceOf(r.id, { note: e.target.value })}
                  maxLength={2000}
                  className={inputClass}
                />
              </label>
              {r.action === "CHANGE_LEVEL" && !r.oldRemovedAt && (
                <label className="text-[13px] text-dark">
                  Méthode de remplacement
                  <select
                    value={evidenceOf(r.id).method}
                    onChange={(e) => setEvidenceOf(r.id, { method: e.target.value as Evidence["method"] })}
                    className={inputClass}
                  >
                    <option value="DIRECT">Remplacement direct</option>
                    <option value="REMOVE_THEN_GRANT">Retrait puis octroi (les deux faits)</option>
                  </select>
                </label>
              )}
            </fieldset>
          ))}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={completeSelection} className={primaryButton}>
              Enregistrer les confirmations
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButton}>
              Fermer
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((task) => (
          <FulfilmentTaskCard
            key={`${task.id}:${task.revision}`}
            task={task}
            readOnly={readOnly}
            selectable={selectable && (task.viewerCan.claim || task.viewerCan.complete)}
            selected={selected[task.id] ?? false}
            onToggle={() => setSelected((s) => ({ ...s, [task.id]: !s[task.id] }))}
          />
        ))}
      </div>
    </div>
  );
}
