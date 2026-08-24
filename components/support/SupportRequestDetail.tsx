"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  SupportRequestCategory,
  SupportRequestPriority,
  SupportRequestStatus,
} from "@prisma/client";
import {
  assignSupportRequest,
  changeSupportRequestStatus,
  commentSupportRequest,
  convertSupportRequestToTask,
  deleteSupportAttachment,
  triageSupportRequest,
} from "@/app/(dashboard)/support/actions";
import {
  SUPPORT_CATEGORY_META,
  SUPPORT_PRIORITY_META,
  SUPPORT_STATUS_META,
  allowedTransitions,
} from "@/lib/support-request";
import type {
  SerializedSupportAttachment,
  SerializedSupportComment,
  SerializedSupportRequest,
} from "@/lib/support-request-serialize";
import { formatBytes } from "@/lib/attachments";
import { CategoryPill, OverduePill, PriorityPill, StatusPill } from "./SupportBadges";
import { AttachmentUploader } from "./AttachmentUploader";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Porto-Novo",
});

const CATEGORIES = Object.keys(SUPPORT_CATEGORY_META) as SupportRequestCategory[];
const PRIORITIES = Object.keys(SUPPORT_PRIORITY_META) as SupportRequestPriority[];

/** Statuts qui exigent une explication écrite avant d'être appliqués. */
const NEEDS_NOTE: SupportRequestStatus[] = ["RESOLVED", "REJECTED"];

interface Props {
  request: SerializedSupportRequest;
  comments: SerializedSupportComment[];
  attachments: SerializedSupportAttachment[];
  access: { canHandle: boolean; isRequester: boolean; actor: "SUPPORT" | "REQUESTER" };
  currentUserId: string;
  /** Personnes assignables (équipe du guichet) — vide si le viewer ne traite pas. */
  assignables: Array<{ id: string; name: string }>;
  /** Sprints ouverts pour la conversion en tâche. */
  sprints: Array<{ id: string; name: string; number: number }>;
}

export function SupportRequestDetail({
  request,
  comments,
  attachments,
  access,
  currentUserId,
  assignables,
  sprints,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [pendingStatus, setPendingStatus] = useState<SupportRequestStatus | null>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [sprintId, setSprintId] = useState<string>(sprints[0]?.id ?? "");

  const transitions = allowedTransitions(request.status, access.actor);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Échec de l'opération");
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function applyStatus(status: SupportRequestStatus) {
    if (NEEDS_NOTE.includes(status) && !note.trim()) {
      setPendingStatus(status);
      setError(null);
      return;
    }
    run(
      () =>
        changeSupportRequestStatus({
          id: request.id,
          status,
          resolutionNote: note.trim() || null,
        }),
      () => {
        setPendingStatus(null);
        setNote("");
      }
    );
  }

  const card = "rounded-[10px] border border-border-soft bg-white p-4";
  const label = "block text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray mb-1";
  const field =
    "w-full rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[14px] text-dark focus:outline-none focus:border-teal";

  return (
    <div className="space-y-4">
      {/* ── En-tête ─────────────────────────────────────────────── */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-[11px] tracking-[0.06em] text-izi-gray">
              {request.reference}
            </div>
            <h1 className="font-serif text-[22px] leading-tight text-dark">{request.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={request.status} />
            {request.isOverdue && <OverduePill />}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <CategoryPill category={request.category} />
          <PriorityPill priority={request.priority} />
          <span className="text-[11px] text-izi-gray">
            {request.department.code} — {request.department.name}
          </span>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
          <Row term="Demandeur" desc={request.requester.name} />
          <Row term="En charge" desc={request.assignee?.name ?? "Non assignée"} />
          {/* Le souhait initial ne s'affiche que s'il diverge de la réalité —
              sinon c'est la même ligne écrite deux fois. */}
          {request.requestedAssignee &&
            request.requestedAssignee.id !== request.assignee?.id && (
              <Row
                term="Adressée à"
                desc={`${request.requestedAssignee.name} (souhait du demandeur)`}
              />
            )}
          <Row term="Déposée le" desc={dateFmt.format(new Date(request.createdAt))} />
          <Row
            term="Échéance"
            desc={request.dueAt ? dateFmt.format(new Date(request.dueAt)) : "—"}
            alert={request.isOverdue}
          />
          {request.resolvedAt && (
            <Row term="Résolue le" desc={dateFmt.format(new Date(request.resolvedAt))} />
          )}
          {request.closedAt && (
            <Row term="Clôturée le" desc={dateFmt.format(new Date(request.closedAt))} />
          )}
        </dl>

        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-dark-md">
          {request.description}
        </p>

        {request.resolutionNote && (
          <div className="mt-3 rounded-[8px] border-l-[3px] border-teal bg-gray-lt p-3">
            <div className={label}>Réponse du support</div>
            <p className="whitespace-pre-wrap text-[14px] text-dark-md">
              {request.resolutionNote}
            </p>
          </div>
        )}

        {request.task && (
          <p className="mt-3 text-[12px] text-teal-dk">
            Convertie en tâche de sprint : <strong>{request.task.title}</strong>
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-[8px] bg-red-lt px-3 py-2 text-[13px] text-red">{error}</p>
      )}

      {/* ── Actions ─────────────────────────────────────────────── */}
      {transitions.length > 0 && (
        <div className={card}>
          <h2 className={label}>Actions</h2>
          <div className="flex flex-wrap gap-2">
            {transitions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={pending}
                onClick={() => applyStatus(s)}
                className="rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[13px] font-medium text-dark hover:border-teal hover:text-teal-dk transition-colors disabled:opacity-50"
              >
                {actionLabel(s, access.actor)}
              </button>
            ))}
          </div>

          {pendingStatus && (
            <div className="mt-3">
              <span className={label}>
                {pendingStatus === "REJECTED" ? "Motif du refus" : "Ce qui a été fait"}
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                autoFocus
                placeholder={
                  pendingStatus === "REJECTED"
                    ? "Pourquoi cette demande ne peut pas être traitée…"
                    : "La solution appliquée, pour que le demandeur sache quoi faire la prochaine fois…"
                }
                className={`${field} resize-y`}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !note.trim()}
                  onClick={() => applyStatus(pendingStatus)}
                  className="rounded-[8px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
                >
                  {pending ? "…" : "Confirmer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingStatus(null);
                    setNote("");
                  }}
                  className="rounded-[8px] border border-border-soft px-4 py-2 text-[13px] text-izi-gray hover:text-dark"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Panneau support ─────────────────────────────────────── */}
      {access.canHandle && (
        <div className={`${card} space-y-3`}>
          <h2 className={label}>Traitement</h2>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={label}>Assignée à</span>
              <select
                value={request.assignee?.id ?? ""}
                disabled={pending}
                onChange={(e) =>
                  run(() =>
                    assignSupportRequest({
                      id: request.id,
                      assigneeId: e.target.value || null,
                    })
                  )
                }
                className={field}
              >
                <option value="">Non assignée</option>
                {assignables.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.id === currentUserId ? " (moi)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={label}>Type</span>
              <select
                value={request.category}
                disabled={pending}
                onChange={(e) =>
                  run(() =>
                    triageSupportRequest({
                      id: request.id,
                      category: e.target.value as SupportRequestCategory,
                    })
                  )
                }
                className={field}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SUPPORT_CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={label}>Priorité</span>
              <select
                value={request.priority}
                disabled={pending}
                onChange={(e) =>
                  run(() =>
                    triageSupportRequest({
                      id: request.id,
                      priority: e.target.value as SupportRequestPriority,
                    })
                  )
                }
                className={field}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {SUPPORT_PRIORITY_META[p].label} · {SUPPORT_PRIORITY_META[p].slaHours} h
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-izi-gray">
            Changer la priorité recale l&apos;échéance sur le SLA correspondant.
          </p>

          {!request.task && (
            <div className="border-t border-border-soft pt-3">
              {!showConvert ? (
                <button
                  type="button"
                  onClick={() => setShowConvert(true)}
                  className="text-[13px] font-medium text-teal-dk hover:underline"
                >
                  Convertir en tâche de sprint →
                </button>
              ) : (
                <div className="space-y-2">
                  <span className={label}>Sprint cible</span>
                  <select
                    value={sprintId}
                    onChange={(e) => setSprintId(e.target.value)}
                    className={field}
                  >
                    <option value="">Backlog (aucun sprint)</option>
                    {sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        Sprint {s.number} — {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            convertSupportRequestToTask({
                              id: request.id,
                              sprintId: sprintId || null,
                            }),
                          () => setShowConvert(false)
                        )
                      }
                      className="rounded-[8px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
                    >
                      {pending ? "…" : "Créer la tâche"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConvert(false)}
                      className="rounded-[8px] border border-border-soft px-4 py-2 text-[13px] text-izi-gray hover:text-dark"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Pièces jointes ──────────────────────────────────────── */}
      <div className={card}>
        <h2 className={label}>Pièces jointes ({attachments.length})</h2>
        {attachments.length === 0 ? (
          <p className="text-[13px] text-izi-gray">Aucune pièce jointe.</p>
        ) : (
          <ul className="space-y-1.5 list-none p-0 m-0">
            {attachments.map((a) => {
              const canDelete = a.uploadedBy.id === currentUserId || access.canHandle;
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-[8px] bg-gray-lt px-3 py-2"
                >
                  <a
                    href={a.href}
                    className="min-w-0 flex-1 truncate text-[13px] text-teal-dk hover:underline"
                  >
                    📎 {a.filename}
                  </a>
                  <span className="shrink-0 text-[11px] text-izi-gray">
                    {formatBytes(a.size)} · {a.uploadedBy.name}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Supprimer ${a.filename}`}
                      onClick={() => run(() => deleteSupportAttachment({ attachmentId: a.id }))}
                      className="shrink-0 text-[12px] text-red hover:underline disabled:opacity-50"
                    >
                      Supprimer
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3">
          <AttachmentUploader requestId={request.id} disabled={pending} />
        </div>
      </div>

      {/* ── Fil de discussion ───────────────────────────────────── */}
      <div className={card}>
        <h2 className={label}>Échanges ({comments.length})</h2>

        {comments.length === 0 ? (
          <p className="text-[13px] text-izi-gray">Aucun message pour l&apos;instant.</p>
        ) : (
          <ul className="space-y-3 list-none p-0 m-0">
            {comments.map((c) => (
              <li
                key={c.id}
                className={`rounded-[8px] p-3 ${
                  c.isInternal ? "border border-dashed border-gold bg-gold-lt" : "bg-gray-lt"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-dark">{c.author.name}</span>
                  <span className="text-[11px] text-izi-gray">
                    {c.isInternal && (
                      <span className="mr-1 font-semibold text-gold">Note interne</span>
                    )}
                    {dateFmt.format(new Date(c.createdAt))}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-dark-md">
                  {c.content}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={
              access.canHandle
                ? "Répondre au demandeur, ou noter une info pour l'équipe…"
                : "Ajouter une précision, un message d'erreur, une capture…"
            }
            className={`${field} resize-y`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {access.canHandle && (
              <label className="flex items-center gap-2 text-[12px] text-izi-gray">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  className="accent-[color:var(--gold)]"
                />
                Note interne (invisible pour le demandeur)
              </label>
            )}
            <button
              type="button"
              disabled={pending || !comment.trim()}
              onClick={() =>
                run(
                  () =>
                    commentSupportRequest({
                      id: request.id,
                      content: comment,
                      isInternal,
                    }),
                  () => {
                    setComment("");
                    setIsInternal(false);
                  }
                )
              }
              className="ml-auto rounded-[8px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {pending ? "…" : "Envoyer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ term, desc, alert }: { term: string; desc: string; alert?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-izi-gray">{term}</dt>
      <dd className={`m-0 font-medium ${alert ? "text-red" : "text-dark"}`}>{desc}</dd>
    </div>
  );
}

/**
 * Libellé du bouton : la même transition n'a pas le même sens des deux côtés.
 * Passer en CLOSED, c'est « clôturer » pour le support et « c'est bon pour moi »
 * pour le demandeur ; repasser en IN_PROGRESS, c'est « rouvrir » vs « pas résolu ».
 */
function actionLabel(status: SupportRequestStatus, actor: "SUPPORT" | "REQUESTER"): string {
  if (actor === "REQUESTER") {
    if (status === "CLOSED") return "C'est résolu, merci";
    if (status === "IN_PROGRESS") return "Toujours pas résolu";
    if (status === "CANCELLED") return "Annuler ma demande";
  }
  switch (status) {
    case "TRIAGED":
      return "Prendre en charge";
    case "IN_PROGRESS":
      return "Rouvrir / démarrer";
    case "ON_HOLD":
      return "Mettre en attente";
    case "RESOLVED":
      return "Marquer résolue";
    case "CLOSED":
      return "Clôturer";
    case "REJECTED":
      return "Refuser";
    case "CANCELLED":
      return "Annuler";
    default:
      return SUPPORT_STATUS_META[status].label;
  }
}
