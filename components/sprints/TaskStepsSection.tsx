"use client";

import { useState } from "react";
import type { UserRole } from "@prisma/client";
import {
  canAddStep,
  canToggleStep,
  canEditStep,
  canDeleteStep,
  stepProgress,
} from "@/lib/sprint-step";
import type { TaskStepItem } from "./types";

interface Props {
  taskId: string;
  taskAssigneeId: string | null;
  initialSteps: TaskStepItem[];
  currentUserId: string;
  currentUserRole: UserRole;
  onChanged?: () => void;
}

export function TaskStepsSection({
  taskId,
  taskAssigneeId,
  initialSteps,
  currentUserId,
  currentUserRole,
  onChanged,
}: Props) {
  const [steps, setSteps] = useState<TaskStepItem[]>(initialSteps);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewer = { userId: currentUserId, role: currentUserRole };
  const taskLike = { assigneeId: taskAssigneeId };
  const mayAdd = canAddStep(taskLike, viewer);
  const mayToggle = canToggleStep(taskLike, viewer);
  const progress = stepProgress(steps);
  const allDone = progress.total > 0 && progress.done === progress.total;

  async function patchStep(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sprint-task-steps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de la mise à jour");
        return false;
      }
      setSteps((prev) => prev.map((s) => (s.id === id ? data.data : s)));
      onChanged?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function addStep() {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sprint-tasks/${taskId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de la création");
        return;
      }
      setSteps((prev) => [...prev, data.data]);
      setNewTitle("");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function deleteStep(id: string) {
    if (!confirm("Supprimer cette étape ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sprint-task-steps/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Échec de la suppression");
        return;
      }
      setSteps((prev) => prev.filter((s) => s.id !== id));
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle(id: string) {
    const title = editTitle.trim();
    if (!title) return;
    const ok = await patchStep(id, { title });
    if (ok) setEditingId(null);
  }

  return (
    <div className="border-t border-border-soft pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-semibold text-dark">
          Étapes
          {progress.total > 0 && (
            <span
              className={`ml-1.5 font-mono text-[10px] ${
                allDone ? "text-green" : "text-izi-gray"
              }`}
            >
              {progress.done}/{progress.total}
            </span>
          )}
        </h3>
      </div>

      {progress.total > 0 && (
        <div
          className="mb-2 h-1 w-full overflow-hidden rounded-full bg-izi-gray-lt"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progression des étapes"
        >
          <div
            className={`h-full rounded-full transition-all ${allDone ? "bg-green" : "bg-teal"}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-[6px] border border-red/30 bg-red-lt px-2.5 py-1.5 text-[11px] text-red">
          {error}
        </div>
      )}

      {steps.length === 0 && !mayAdd ? (
        <p className="text-[11px] text-izi-gray py-1">Aucune étape.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {steps.map((s) => {
            const editable = canEditStep(s, taskLike, viewer);
            const deletable = canDeleteStep(s, viewer);
            if (editingId === s.id) {
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    maxLength={200}
                    autoFocus
                    aria-label="Titre de l'étape"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTitle(s.id);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-[6px] border border-border-soft bg-white px-2 py-1 text-[12px] text-dark focus:outline-none focus:border-teal"
                  />
                  <button
                    type="button"
                    onClick={() => saveTitle(s.id)}
                    disabled={busy || !editTitle.trim()}
                    className="shrink-0 rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="shrink-0 text-[11px] text-izi-gray hover:underline"
                  >
                    Annuler
                  </button>
                </li>
              );
            }
            return (
              <li key={s.id} className="group flex items-center gap-2 rounded-[6px] px-1 py-0.5 hover:bg-izi-gray-lt/40">
                <input
                  type="checkbox"
                  checked={s.done}
                  disabled={!mayToggle || busy}
                  onChange={(e) => patchStep(s.id, { done: e.target.checked })}
                  aria-label={`Étape : ${s.title}`}
                  className="h-3.5 w-3.5 shrink-0 accent-[var(--teal,#008081)] disabled:opacity-60"
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] ${
                    s.done ? "line-through text-izi-gray" : "text-dark"
                  }`}
                  title={s.title}
                >
                  {s.title}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => { setEditingId(s.id); setEditTitle(s.title); setError(null); }}
                    disabled={busy}
                    aria-label={`Modifier l'étape ${s.title}`}
                    className="shrink-0 text-[11px] font-medium text-izi-gray opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-teal disabled:opacity-50"
                  >
                    Modifier
                  </button>
                )}
                {deletable && (
                  <button
                    type="button"
                    onClick={() => deleteStep(s.id)}
                    disabled={busy}
                    aria-label={`Supprimer l'étape ${s.title}`}
                    className="shrink-0 text-[13px] leading-none text-izi-gray opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red disabled:opacity-50"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mayAdd && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={200}
            placeholder="Ajouter une étape…"
            aria-label="Nouvelle étape"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addStep();
              }
            }}
            className="min-w-0 flex-1 rounded-[6px] border border-border-soft bg-white px-2 py-1 text-[12px] text-dark focus:outline-none focus:border-teal"
          />
          <button
            type="button"
            onClick={addStep}
            disabled={busy || !newTitle.trim()}
            className="shrink-0 rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}
