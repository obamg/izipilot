"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScoreDonutFilled } from "@/components/ui/ScoreDonut";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { KrStatus, KrType, ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { ActionStatusBadge } from "@/components/ui/ActionStatusBadge";
import { ActionPriorityBadge } from "@/components/ui/ActionPriorityBadge";
import { ActionForm } from "@/components/ui/ActionForm";
import { ActionEditModal, type EditableAction } from "@/components/ui/ActionEditModal";

interface ActionData {
  id: string;
  title: string;
  description: string | null;
  status: ActionStatus;
  priority: ActionPriority;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
}

interface KrData {
  id: string;
  title: string;
  target: number | null;
  targetUnit: string | null;
  currentValue: number;
  score: number;
  status: KrStatus;
  krType: KrType;
  objectiveTitle: string;
  entityCode: string;
  entityName: string;
  entityColor: string;
  departmentId: string | null;
  departmentMembers: { id: string; name: string }[];
  existingProgress?: number;
  existingStatus?: KrStatus;
  existingBlocker?: string;
  existingProposedSolution?: string;
  existingActionNeeded?: string;
  existingComment?: string;
  isSubmitted: boolean;
  actions: ActionData[];
}

interface WeeklyEntryFormProps {
  keyResults: KrData[];
  weekNumber: number;
  year: number;
  orgUsers: { id: string; name: string }[];
  currentUserId: string;
  currentUserRole: UserRole;
}

interface EntryState {
  progress: number;
  status: KrStatus;
  blocker: string;
  proposedSolution: string;
  actionNeeded: string;
  comment: string;
}

const STATUS_OPTIONS: { value: KrStatus; label: string }[] = [
  { value: "ON_TRACK", label: "En bonne voie" },
  { value: "AT_RISK", label: "Attention" },
  { value: "BLOCKED", label: "Bloqu\u00e9" },
  { value: "NOT_STARTED", label: "Non d\u00e9marr\u00e9" },
];

function getScoreColor(score: number): string {
  if (score >= 70) return "var(--green)";
  if (score >= 40) return "var(--gold)";
  return "var(--red)";
}

const ACTION_STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "TODO", label: "A faire" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "BLOCKED", label: "Bloquee" },
  { value: "DONE", label: "Terminee" },
];

export function WeeklyEntryForm({
  keyResults,
  weekNumber,
  year,
  orgUsers,
  currentUserId,
  currentUserRole,
}: WeeklyEntryFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const draftKey = `izipilot-draft-S${weekNumber}-${year}`;
  const [draftRestored, setDraftRestored] = useState(false);
  const [actionUpdates, setActionUpdates] = useState<Record<string, ActionStatus>>({});
  const [showActionForm, setShowActionForm] = useState<string | null>(null);
  const [actionCreating, setActionCreating] = useState(false);
  const [editingAction, setEditingAction] = useState<EditableAction | null>(null);

  const canEditAction = currentUserRole !== "VIEWER";
  const canDeleteAction = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";

  const [entries, setEntries] = useState<Record<string, EntryState>>(() => {
    const initial: Record<string, EntryState> = {};
    for (const kr of keyResults) {
      initial[kr.id] = {
        progress: kr.existingProgress ?? kr.score,
        status: kr.existingStatus ?? kr.status,
        blocker: kr.existingBlocker ?? "",
        proposedSolution: kr.existingProposedSolution ?? "",
        actionNeeded: kr.existingActionNeeded ?? "",
        comment: kr.existingComment ?? "",
      };
    }
    return initial;
  });

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved) as Record<string, EntryState>;
        // Only restore fields that haven't been submitted yet
        setEntries((prev) => {
          const merged = { ...prev };
          for (const kr of keyResults) {
            if (!kr.isSubmitted && draft[kr.id]) {
              merged[kr.id] = { ...prev[kr.id], ...draft[kr.id] };
            }
          }
          return merged;
        });
        setDraftRestored(true);
        setTimeout(() => setDraftRestored(false), 3000);
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage on change (debounced)
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveDraft = useCallback(
    (data: Record<string, EntryState>) => {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        try {
          localStorage.setItem(draftKey, JSON.stringify(data));
        } catch {
          // quota exceeded or unavailable — ignore
        }
      }, 500);
    },
    [draftKey]
  );

  function updateEntry(krId: string, field: keyof EntryState, value: string | number) {
    setEntries((prev) => {
      const next = {
        ...prev,
        [krId]: { ...prev[krId], [field]: value },
      };
      saveDraft(next);
      return next;
    });
  }

  function handleActionStatusChange(actionId: string, status: ActionStatus) {
    setActionUpdates((prev) => ({ ...prev, [actionId]: status }));
  }

  async function handleCreateAction(data: {
    krId: string;
    title: string;
    description?: string;
    assigneeId: string;
    priority: ActionPriority;
    dueDate?: string;
  }) {
    setActionCreating(true);
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Erreur creation action");
      setShowActionForm(null);
      startTransition(() => router.refresh());
    } catch {
      setSubmitError("Erreur lors de la creation de l'action");
    } finally {
      setActionCreating(false);
    }
  }

  async function handleSubmit(isDraft: boolean) {
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      // Submit each KR entry individually
      const results = await Promise.all(
        keyResults.map((kr) =>
          fetch("/api/weekly-entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              krId: kr.id,
              weekNumber,
              year,
              progress: entries[kr.id].progress / 100,
              status: entries[kr.id].status,
              blocker: entries[kr.id].blocker || null,
              proposedSolution: entries[kr.id].proposedSolution || null,
              actionNeeded: entries[kr.id].actionNeeded || null,
              comment: entries[kr.id].comment || null,
            }),
          })
        )
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        const data = await failed[0].json().catch(() => ({}));
        throw new Error(data.error || `${failed.length} saisie(s) en erreur`);
      }

      // Bulk update action statuses if any changed
      const actionUpdateList = Object.entries(actionUpdates);
      if (actionUpdateList.length > 0) {
        await fetch("/api/actions/bulk-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: actionUpdateList.map(([actionId, status]) => ({
              actionId,
              status,
            })),
          }),
        });
      }

      // Clear draft from localStorage after successful submission
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      setSubmitSuccess(true);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  // Group KRs by entity
  const grouped = new Map<string, KrData[]>();
  for (const kr of keyResults) {
    const key = kr.entityCode;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(kr);
  }

  return (
    <div>
      {draftRestored && (
        <div className="bg-teal-lt border border-teal-md rounded-[7px] px-3 py-2 mb-3 text-[11px] text-dark">
          Brouillon restaur&eacute; depuis la sauvegarde locale.
        </div>
      )}

      {Array.from(grouped.entries()).map(([entityCode, krs]) => {
        const first = krs[0];
        return (
          <div
            key={entityCode}
            className="bg-white rounded-[10px] border border-[#deeaea] p-4 mb-3"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-semibold text-dark">
                  {first.entityCode} {first.entityName} &middot; S
                  {String(weekNumber).padStart(2, "0")}
                </div>
              </div>
            </div>

            {Array.from(
              krs.reduce((map, kr) => {
                if (!map.has(kr.objectiveTitle)) map.set(kr.objectiveTitle, []);
                map.get(kr.objectiveTitle)!.push(kr);
                return map;
              }, new Map<string, KrData[]>())
            ).map(([objectiveTitle, objectiveKrs]) => (
              <div
                key={objectiveTitle}
                className="rounded-[10px] border border-teal-md bg-teal-lt/40 mb-4 last:mb-0 overflow-hidden"
              >
                <div className="bg-teal-lt border-b border-teal-md px-4 py-2.5">
                  <div className="text-[9px] font-semibold tracking-[0.08em] uppercase text-teal-dk mb-0.5">
                    Objectif
                  </div>
                  <div className="font-serif text-[15px] leading-tight text-dark">
                    {objectiveTitle}
                  </div>
                </div>
                <div className="p-3 space-y-4">
                  {objectiveKrs.map((kr) => {
                const entry = entries[kr.id];
                const displayScore = entry.progress;
                const scoreColor = getScoreColor(displayScore);
                const actionsCount = kr.actions.length;
                const actionsDone = kr.actions.filter(
                  (a) => (actionUpdates[a.id] ?? a.status) === "DONE"
                ).length;

                return (
                  <div
                    key={kr.id}
                    className="rounded-[10px] border border-[#deeaea] overflow-hidden"
                  >
                    {/* ── KR Header ── colored top bar */}
                    <div
                      className="px-4 py-3 flex items-center gap-3"
                      style={{ backgroundColor: `${scoreColor}10`, borderBottom: `2px solid ${scoreColor}30` }}
                    >
                      <ScoreDonutFilled score={displayScore} size={42} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-dark leading-tight">
                          {kr.title}
                        </div>
                        <div className="text-[10px] text-izi-gray mt-0.5">
                          {kr.currentValue} {kr.targetUnit ?? ""} / {kr.target ?? "N/A"} {kr.targetUnit ?? ""}
                        </div>
                      </div>
                      <StatusBadge status={entry.status} />
                    </div>

                    {/* ── KR Saisie ── form fields */}
                    <div className="px-4 py-3 space-y-3 bg-white">
                      {/* Progress slider */}
                      <div>
                        <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                          Avancement
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={entry.progress}
                            onChange={(e) =>
                              updateEntry(kr.id, "progress", Number(e.target.value))
                            }
                            className="flex-1 accent-teal"
                            style={{ accentColor: "var(--teal)" }}
                          />
                          <span
                            className="font-mono text-sm font-semibold min-w-[34px] text-right"
                            style={{ color: scoreColor }}
                          >
                            {displayScore}%
                          </span>
                        </div>
                      </div>

                      {/* Status + Comment row */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                            Statut
                          </label>
                          <select
                            value={entry.status}
                            onChange={(e) =>
                              updateEntry(kr.id, "status", e.target.value)
                            }
                            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                            Commentaire
                          </label>
                          <textarea
                            value={entry.comment}
                            onChange={(e) =>
                              updateEntry(kr.id, "comment", e.target.value)
                            }
                            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans resize-none h-[38px] leading-relaxed"
                            placeholder="Commentaire libre..."
                          />
                        </div>
                      </div>

                      {/* Blocker */}
                      {(entry.status === "BLOCKED" || entry.blocker) && (
                        <div>
                          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                            Blocage identifi&eacute;
                          </label>
                          <textarea
                            value={entry.blocker}
                            onChange={(e) =>
                              updateEntry(kr.id, "blocker", e.target.value)
                            }
                            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans resize-none h-[42px] leading-relaxed"
                            placeholder="D\u00e9crivez le blocage..."
                          />
                        </div>
                      )}

                      {/* Proposed solution — AT_RISK */}
                      {(entry.status === "AT_RISK" || entry.proposedSolution) && (
                        <div>
                          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                            Approche de solution
                          </label>
                          <textarea
                            value={entry.proposedSolution}
                            onChange={(e) =>
                              updateEntry(kr.id, "proposedSolution", e.target.value)
                            }
                            className="w-full px-[9px] py-[7px] border border-[#e6d28a] bg-[var(--gold-lt)] rounded-[7px] text-[11px] text-dark font-sans resize-none h-[42px] leading-relaxed"
                            placeholder="D&eacute;crivez votre approche pour r&eacute;soudre ce point..."
                          />
                        </div>
                      )}

                      {/* Action needed */}
                      {(entry.status === "BLOCKED" ||
                        entry.status === "AT_RISK" ||
                        entry.actionNeeded) && (
                        <div>
                          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                            Besoin Management
                          </label>
                          <textarea
                            value={entry.actionNeeded}
                            onChange={(e) =>
                              updateEntry(kr.id, "actionNeeded", e.target.value)
                            }
                            className={`w-full px-[9px] py-[7px] border rounded-[7px] text-[11px] text-dark font-sans resize-none h-[42px] leading-relaxed ${
                              entry.status === "BLOCKED"
                                ? "bg-izi-red-lt border-[#f0b0b0]"
                                : "border-teal-md"
                            }`}
                            placeholder="De quoi avez-vous besoin ?"
                          />
                        </div>
                      )}
                    </div>

                    {/* ── Actions Section ── visually separated */}
                    <div className="bg-[var(--gray-lt)] border-t border-[#deeaea] px-4 py-3">
                      {/* Actions header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[13px] h-[13px] text-izi-gray">
                            <path d="M9 11l3 3L22 4" />
                            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                          </svg>
                          <span className="text-[10px] font-semibold text-dark-md">
                            Actions
                          </span>
                          {actionsCount > 0 && (
                            <span className="text-[9px] font-mono px-1.5 py-px rounded-full bg-white border border-[#deeaea] text-izi-gray">
                              {actionsDone}/{actionsCount}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowActionForm(showActionForm === kr.id ? null : kr.id)}
                          className="flex items-center gap-1 text-[10px] font-semibold text-teal hover:text-teal-dk transition-colors px-2 py-1 rounded-[5px] hover:bg-white"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                            <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
                          </svg>
                          Ajouter
                        </button>
                      </div>

                      {/* Warning: blocked KR without actions */}
                      {entry.status === "BLOCKED" && kr.actions.length === 0 && (
                        <div className="bg-izi-red-lt border border-[#f0b0b0] rounded-[7px] px-2.5 py-2 mb-2 text-[10px] text-izi-red flex items-center gap-1.5">
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0">
                            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.25a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                          </svg>
                          Un KR bloqu&eacute; n&eacute;cessite au moins une action corrective.
                        </div>
                      )}

                      {/* Action list */}
                      {actionsCount > 0 && (
                        <div className="bg-white rounded-[8px] border border-[#deeaea] divide-y divide-[#deeaea]">
                          {kr.actions.map((action) => {
                            const currentStatus = actionUpdates[action.id] ?? action.status;
                            const isDone = currentStatus === "DONE";
                            const isBlocked = currentStatus === "BLOCKED";
                            return (
                              <div
                                key={action.id}
                                onClick={
                                  canEditAction
                                    ? () =>
                                        setEditingAction({
                                          id: action.id,
                                          title: action.title,
                                          description: action.description,
                                          assigneeId: action.assigneeId,
                                          status: currentStatus,
                                          priority: action.priority,
                                          dueDate: action.dueDate,
                                        })
                                    : undefined
                                }
                                className={`flex items-center gap-2.5 px-3 py-2 ${isDone ? "opacity-60" : ""} ${canEditAction ? "cursor-pointer hover:bg-gray-lt/40" : ""}`}
                              >
                                {/* Status dot/checkbox */}
                                <div
                                  className="relative shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <select
                                    value={currentStatus}
                                    onChange={(e) => handleActionStatusChange(action.id, e.target.value as ActionStatus)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    aria-label={`Statut: ${action.title}`}
                                  >
                                    {ACTION_STATUS_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                  </select>
                                  <div
                                    className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center ${
                                      isDone ? "border-[var(--green)] bg-[var(--green)]" :
                                      isBlocked ? "border-[var(--red)] bg-transparent" :
                                      currentStatus === "IN_PROGRESS" ? "border-[#185FA5] bg-transparent" :
                                      "border-[#c0c8cc] bg-transparent"
                                    }`}
                                  >
                                    {isDone && (
                                      <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" className="w-2.5 h-2.5">
                                        <path d="M2.5 6l2.5 2.5 4.5-5" />
                                      </svg>
                                    )}
                                    {currentStatus === "IN_PROGRESS" && (
                                      <div className="w-[8px] h-[8px] rounded-full bg-[#185FA5]" />
                                    )}
                                    {isBlocked && (
                                      <div className="w-[8px] h-[8px] rounded-full bg-[var(--red)]" />
                                    )}
                                  </div>
                                </div>

                                {/* Action title */}
                                <span className={`text-[11px] flex-1 min-w-0 truncate ${isDone ? "line-through text-izi-gray" : "text-dark font-medium"}`}>
                                  {action.title}
                                </span>

                                {/* Meta: assignee, priority, due date */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {action.dueDate && (
                                    <span className={`text-[9px] font-mono ${
                                      !isDone && new Date(action.dueDate) < new Date()
                                        ? "text-[var(--red)] font-semibold"
                                        : "text-izi-gray"
                                    }`}>
                                      {new Date(action.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                                    </span>
                                  )}
                                  <span className="text-[9px] text-izi-gray hidden sm:inline">{action.assigneeName}</span>
                                  <ActionPriorityBadge priority={action.priority} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Empty state */}
                      {actionsCount === 0 && entry.status !== "BLOCKED" && (
                        <div className="text-[10px] text-izi-gray italic py-1">
                          Aucune action pour ce KR.
                        </div>
                      )}

                      {/* New action form */}
                      {showActionForm === kr.id && (
                        <div className="mt-2">
                          <ActionForm
                            krId={kr.id}
                            users={kr.departmentMembers.length > 0 ? kr.departmentMembers : orgUsers}
                            allUsers={orgUsers}
                            currentUserId={currentUserId}
                            onSubmit={handleCreateAction}
                            onCancel={() => setShowActionForm(null)}
                            isLoading={actionCreating}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* Submit bar */}
      <div className="sticky bottom-0 bg-white/90 backdrop-blur-sm border-t border-[#deeaea] px-4 py-3 flex justify-end gap-2 -mx-5 mt-4">
        {submitError && (
          <span className="text-xs text-izi-red self-center mr-auto">
            {submitError}
          </span>
        )}
        {submitSuccess && (
          <span className="text-xs text-izi-green self-center mr-auto">
            Revue soumise avec succ&egrave;s !
          </span>
        )}
        <button
          onClick={() => handleSubmit(true)}
          disabled={isPending}
          className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-transparent border border-teal-md text-teal hover:bg-teal-lt transition-colors disabled:opacity-50"
        >
          Enregistrer brouillon
        </button>
        <button
          onClick={() => handleSubmit(false)}
          disabled={isPending}
          className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          {isPending ? "Envoi..." : "Soumettre la revue \u2192"}
        </button>
      </div>

      {editingAction && (
        <ActionEditModal
          action={editingAction}
          users={orgUsers}
          canDelete={canDeleteAction}
          onClose={() => setEditingAction(null)}
          onUpdated={() => router.refresh()}
          onDeleted={() => router.refresh()}
        />
      )}
    </div>
  );
}
