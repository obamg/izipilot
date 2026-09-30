"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TASK_ACTION_LABELS, TASK_STATE_LABELS } from "@/lib/access/fulfilment";
import type { FulfilmentTaskDTO } from "@/lib/access/fulfilment-read-server";

type Mode = "complete" | "block" | "handover" | "reconcile" | null;

const STAGE_ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_HEAD: "Chef de département",
  CISO: "CISO",
  COO: "COO",
};

const EVENT_LABELS: Record<string, string> = {
  RELEASED: "Libérée",
  CLAIMED: "Réclamée",
  HANDED_OVER: "Passée à",
  BLOCKED: "Bloquée",
  RESUMED: "Reprise",
  PARTIAL_REMOVAL: "Ancien niveau retiré",
  COMPLETED: "Exécutée",
  RECONCILED: "Réconciliée — aucune modification",
  CANCELLED: "Annulée",
};

const STATE_BADGE: Record<string, string> = {
  READY: "bg-teal-lt text-teal-dk",
  CLAIMED: "bg-gold-lt text-dark",
  BLOCKED: "bg-red-lt text-dark",
  COMPLETED: "bg-green-lt text-dark",
  CANCELLED: "bg-gray-lt text-izi-gray",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo", dateStyle: "short", timeStyle: "short" });
}

/** Valeur d'un champ datetime-local pour « maintenant » (heure locale du navigateur). */
export function nowForDateTimeInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputClass =
  "izi-form-input w-full rounded-[6px] border border-teal-md bg-white px-2 py-2 text-[13px] text-dark";
const primaryButton =
  "rounded-[6px] bg-teal px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-dk disabled:opacity-50";
const secondaryButton =
  "rounded-[6px] border border-teal-md bg-white px-3 py-2 text-[13px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50";

interface Props {
  task: FulfilmentTaskDTO;
  readOnly: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}

export function FulfilmentTaskCard({ task, readOnly, selectable, selected, onToggle }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedAtLocal, setCompletedAtLocal] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<"DIRECT" | "REMOVE_THEN_GRANT">("DIRECT");
  const [partialRemovalOnly, setPartialRemovalOnly] = useState(false);
  const [reason, setReason] = useState("");
  const [facts, setFacts] = useState("");
  const [toUserId, setToUserId] = useState(task.handoverCandidates[0]?.id ?? "");

  const can = readOnly ? null : task.viewerCan;
  const needsMethod = task.action === "CHANGE_LEVEL" && task.oldRemovedAt === null;

  function open(next: Mode) {
    setError(null);
    setReason("");
    if (next === "complete" && !completedAtLocal) setCompletedAtLocal(nowForDateTimeInput());
    setMode(next);
  }

  async function send(path: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/tasks/${task.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedRevision: task.revision }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Échec de l'opération");
      }
      setMode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function submitComplete() {
    if (!completedAtLocal || (!reference.trim() && !note.trim())) {
      setError("Indiquez la date réelle et une référence ou une note");
      return;
    }
    void send("complete", {
      completedAt: new Date(completedAtLocal).toISOString(),
      reference,
      note,
      ...(task.action === "CHANGE_LEVEL" ? { method: needsMethod ? method : "REMOVE_THEN_GRANT" } : {}),
      partialRemovalOnly: needsMethod && method === "REMOVE_THEN_GRANT" && partialRemovalOnly,
    });
  }

  return (
    <article className="rounded-[10px] border border-border-soft bg-white p-4" aria-label={`Tâche ${task.reference}`}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Sélectionner la tâche ${task.reference}`}
            className="mt-1 h-5 w-5 shrink-0 accent-teal"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-dark">{task.beneficiaryName}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_BADGE[task.state]}`}>
              {TASK_STATE_LABELS[task.state]}
            </span>
            <span className="font-mono text-[11px] text-izi-gray">{task.reference}</span>
          </div>
          <p className="text-[13px] text-izi-gray">{task.departmentName ?? "Département non renseigné"}</p>

          <p className="mt-2 text-[15px] text-dark">
            <span className="font-medium">{TASK_ACTION_LABELS[task.action]}</span> · {task.assetName}
            {task.assetArchived && <span className="ml-1 text-[11px] text-izi-gray">(archivée)</span>}
          </p>
          <p className="text-[13px] text-dark-md">
            {task.fromLevelName ?? "Aucun accès"} → {task.toLevelName ?? "Aucun accès"}
          </p>
          <p className="text-[13px] text-izi-gray">
            {task.periodEnd
              ? `Temporaire jusqu'au ${formatDay(task.periodEnd)}`
              : task.periodStart
                ? `Sans date de fin, à partir du ${formatDay(task.periodStart)}`
                : "Période non renseignée"}
            {" · "}libérée le {formatDay(task.releasedAt)}
          </p>

          {!task.hasOwner && (
            <p className="mt-2 rounded-[6px] bg-red-lt px-2 py-1 text-[13px] text-dark">
              Aucun propriétaire — à affecter
            </p>
          )}
          {task.claimantName && (
            <p className="mt-1 text-[13px] text-dark-md">Prise en charge par {task.claimantName}</p>
          )}
          {task.blockedReason && (
            <p className="mt-2 rounded-[6px] bg-red-lt px-2 py-1 text-[13px] text-dark">Blocage : {task.blockedReason}</p>
          )}
          {task.cancelRequested && (
            <p className="mt-2 rounded-[6px] bg-gold-lt px-2 py-1 text-[13px] text-dark">
              Le demandeur a demandé l&apos;annulation — réconciliez ou confirmez ce qui a réellement été fait.
            </p>
          )}
          {task.staleReason && (
            <p className="mt-2 rounded-[6px] bg-gold-lt px-2 py-1 text-[13px] text-dark">À revoir : {task.staleReason}</p>
          )}

          <p className="mt-2 text-[13px] text-dark-md">
            <span className="text-izi-gray">Motif : </span>
            {task.ownerReason}
          </p>
          {(task.approvalSummary.length > 0 || task.approvalException) && (
            <p className="text-[13px] text-izi-gray">
              {task.approvalException === "COO_SELF_REQUEST"
                ? "Exception : demande personnelle du COO"
                : task.approvalSummary
                    .map((s) => `${STAGE_ROLE_LABELS[s.role] ?? s.role}${s.decidedAt ? ` (${formatDay(s.decidedAt)})` : ""}`)
                    .join(" → ")}
            </p>
          )}
          {task.completedAt && (
            <p className="mt-1 text-[13px] text-dark-md">
              Exécutée le {formatDateTime(task.completedAt)}
              {task.completionReference ? ` · réf. ${task.completionReference}` : ""}
              {task.completionNote ? ` · ${task.completionNote}` : ""}
            </p>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-teal-dk">Historique ({task.events.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {task.events.map((e, i) => (
                <li key={i} className="text-[13px] text-dark-md">
                  <span className="font-mono text-[11px] text-izi-gray">{formatDateTime(e.occurredAt)}</span>{" "}
                  {EVENT_LABELS[e.type] ?? e.type}
                  {e.toUserName ? ` ${e.toUserName}` : ""}
                  {e.actorName ? ` — ${e.actorName}` : e.actingAs === "SYSTEM" ? " — système" : ""}
                  {e.reason ? ` : ${e.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>

          {error && (
            <p role="alert" className="mt-2 text-[13px] text-red">
              {error}
            </p>
          )}

          {can && mode === null && (
            <div className="mt-3 flex flex-wrap gap-2">
              {can.claim && (
                <button type="button" disabled={busy} onClick={() => send("claim", {})} className={primaryButton}>
                  Réclamer
                </button>
              )}
              {can.complete && (
                <button type="button" disabled={busy} onClick={() => open("complete")} className={primaryButton}>
                  Confirmer
                </button>
              )}
              {can.resume && (
                <button type="button" disabled={busy} onClick={() => send("resume", {})} className={primaryButton}>
                  Reprendre
                </button>
              )}
              {can.block && (
                <button type="button" disabled={busy} onClick={() => open("block")} className={secondaryButton}>
                  Signaler un blocage
                </button>
              )}
              {can.handover && (
                <button type="button" disabled={busy} onClick={() => open("handover")} className={secondaryButton}>
                  Passer la main
                </button>
              )}
              {can.reconcile && (
                <button type="button" disabled={busy} onClick={() => open("reconcile")} className={secondaryButton}>
                  Réconcilier
                </button>
              )}
            </div>
          )}

          {mode === "complete" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <label className="text-[13px] text-dark">
                Date et heure réelles
                <input
                  type="datetime-local"
                  value={completedAtLocal}
                  onChange={(e) => setCompletedAtLocal(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-[13px] text-dark">
                Référence (compte, ticket)
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={inputClass} />
              </label>
              <label className="text-[13px] text-dark">
                Note d&apos;exécution
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className={inputClass} />
              </label>
              <p className="text-[11px] text-izi-gray">
                Référence ou note obligatoire. N&apos;écrivez jamais de mot de passe ni de secret.
              </p>
              {needsMethod && (
                <fieldset className="text-[13px] text-dark">
                  <legend className="mb-1">Méthode de remplacement</legend>
                  <label className="mr-4 inline-flex items-center gap-1">
                    <input type="radio" name={`method-${task.id}`} checked={method === "DIRECT"} onChange={() => setMethod("DIRECT")} />
                    Remplacement direct
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name={`method-${task.id}`}
                      checked={method === "REMOVE_THEN_GRANT"}
                      onChange={() => setMethod("REMOVE_THEN_GRANT")}
                    />
                    Retrait puis octroi
                  </label>
                  {method === "REMOVE_THEN_GRANT" && (
                    <label className="mt-1 flex items-center gap-1">
                      <input type="checkbox" checked={partialRemovalOnly} onChange={(e) => setPartialRemovalOnly(e.target.checked)} />
                      Seul l&apos;ancien niveau a été retiré
                    </label>
                  )}
                </fieldset>
              )}
              {task.oldRemovedAt && (
                <p className="text-[13px] text-dark-md">
                  Ancien niveau retiré le {formatDateTime(task.oldRemovedAt)} — confirmez l&apos;octroi du nouveau niveau.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={submitComplete} className={primaryButton}>
                  Enregistrer
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}

          {mode === "block" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <label className="text-[13px] text-dark">
                Motif du blocage (visible du demandeur)
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
              </label>
              <label className="text-[13px] text-dark">
                Faits constatés (internes — ce qui a été tenté ou déjà fait)
                <textarea value={facts} onChange={(e) => setFacts(e.target.value)} maxLength={2000} rows={2} className={inputClass} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => send("block", { reason, facts })}
                  className={primaryButton}
                >
                  Bloquer
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}

          {mode === "handover" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <label className="text-[13px] text-dark">
                Nouveau détenteur
                <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} className={inputClass}>
                  {task.handoverCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[13px] text-dark">
                Motif
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !toUserId || reason.trim().length < 3}
                  onClick={() => send("handover", { toUserId, reason })}
                  className={primaryButton}
                >
                  Passer la main
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}

          {mode === "reconcile" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <p className="text-[13px] text-dark">
                Déclare qu&apos;<strong>aucune modification n&apos;a été effectuée</strong> dans l&apos;application. La tâche et la
                demande seront annulées.
              </p>
              <label className="text-[13px] text-dark">
                Motif
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => send("reconcile", { reason })}
                  className={primaryButton}
                >
                  Aucune modification effectuée
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
