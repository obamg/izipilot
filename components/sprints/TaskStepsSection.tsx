"use client";

import { useState } from "react";
import type { ActionStatus, UserRole } from "@prisma/client";
import {
  canAddStep,
  canUpdateStepStatus,
  canEditStepDetails,
  canDeleteStep,
  stepProgress,
} from "@/lib/sprint-step";
import type { TaskStepItem, UserOption } from "./types";

const STATUS_OPTIONS: { value: ActionStatus; label: string; color: string }[] = [
  { value: "TODO", label: "À faire", color: "#5f6e7a" },
  { value: "IN_PROGRESS", label: "En cours", color: "#185FA5" },
  { value: "BLOCKED", label: "Bloquée", color: "#e23c4a" },
  { value: "DONE", label: "Terminée", color: "#1d9e75" },
  { value: "CANCELLED", label: "Annulée", color: "#8a9aa5" },
];

interface Props {
  taskId: string;
  taskAssigneeId: string | null;
  initialSteps: TaskStepItem[];
  currentUserId: string;
  currentUserRole: UserRole;
  users: UserOption[];
  onChanged?: () => void;
}

export function TaskStepsSection({
  taskId,
  taskAssigneeId,
  initialSteps,
  currentUserId,
  currentUserRole,
  users,
  onChanged,
}: Props) {
  const [steps, setSteps] = useState<TaskStepItem[]>(initialSteps);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewer = { userId: currentUserId, role: currentUserRole };
  const taskLike = { assigneeId: taskAssigneeId };
  const mayAdd = canAddStep(taskLike, viewer);
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

  async function createStep(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sprint-tasks/${taskId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de la création");
        return false;
      }
      setSteps((prev) => [...prev, data.data]);
      onChanged?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function deleteStep(id: string) {
    if (!confirm("Supprimer cette sous-tâche ?")) return;
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

  return (
    <div className="border-t border-border-soft pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-semibold text-dark">
          Sous-tâches
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
        {mayAdd && !showForm && (
          <button
            type="button"
            onClick={() => { setShowForm(true); setError(null); }}
            className="text-[11px] font-medium text-teal hover:text-teal-dk"
          >
            + Ajouter une sous-tâche
          </button>
        )}
      </div>

      {progress.total > 0 && (
        <div
          className="mb-2 h-1 w-full overflow-hidden rounded-full bg-izi-gray-lt"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progression des sous-tâches"
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

      {showForm && (
        <StepForm
          users={users}
          busy={busy}
          submitLabel="Ajouter"
          onCancel={() => { setShowForm(false); setError(null); }}
          onSubmit={async (payload) => {
            const ok = await createStep(payload);
            if (ok) setShowForm(false);
          }}
        />
      )}

      {steps.length === 0 && !showForm ? (
        <p className="text-[11px] text-izi-gray py-1">Aucune sous-tâche.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {steps.map((s) =>
            editingId === s.id ? (
              <li key={s.id}>
                <StepForm
                  users={users}
                  busy={busy}
                  initial={s}
                  submitLabel="Enregistrer"
                  onCancel={() => { setEditingId(null); setError(null); }}
                  onSubmit={async (payload) => {
                    const ok = await patchStep(s.id, payload);
                    if (ok) setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <StepRow
                key={s.id}
                step={s}
                busy={busy}
                canMove={canUpdateStepStatus(s, taskLike, viewer)}
                canEdit={canEditStepDetails(s, taskLike, viewer)}
                canDelete={canDeleteStep(s, viewer)}
                onStatus={(status) => patchStep(s.id, { status })}
                onEdit={() => { setEditingId(s.id); setError(null); }}
                onDelete={() => deleteStep(s.id)}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
}

interface StepRowProps {
  step: TaskStepItem;
  busy: boolean;
  canMove: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onStatus: (status: ActionStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function StepRow({
  step,
  busy,
  canMove,
  canEdit,
  canDelete,
  onStatus,
  onEdit,
  onDelete,
}: StepRowProps) {
  const opt = STATUS_OPTIONS.find((o) => o.value === step.status) ?? STATUS_OPTIONS[0];
  const isDone = step.status === "DONE";
  const isCancelled = step.status === "CANCELLED";
  return (
    <li className="flex items-center gap-2 rounded-[8px] border border-border-soft bg-white px-2 py-1.5">
      {canMove ? (
        <select
          value={step.status}
          onChange={(e) => onStatus(e.target.value as ActionStatus)}
          disabled={busy}
          aria-label={`Statut de la sous-tâche ${step.title}`}
          className="shrink-0 rounded-[6px] border border-border-soft bg-white px-1 py-0.5 text-[10px] font-medium focus:outline-none focus:border-teal disabled:opacity-50"
          style={{ color: opt.color }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
          style={{ color: opt.color, backgroundColor: `${opt.color}1a` }}
        >
          {opt.label}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[12px] ${
            isDone || isCancelled ? "line-through text-izi-gray" : "text-dark"
          }`}
          title={step.title}
        >
          {step.title}
        </div>
        {(step.assigneeName || step.storyPoints != null) && (
          <div className="text-[10px] text-izi-gray truncate">
            {step.assigneeName ?? "Non assignée"}
            {step.storyPoints != null && (
              <span className="font-mono"> · {step.storyPoints} pts</span>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          aria-label={`Modifier la sous-tâche ${step.title}`}
          className="shrink-0 text-[11px] font-medium text-izi-gray hover:text-teal disabled:opacity-50"
        >
          Modifier
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Supprimer la sous-tâche ${step.title}`}
          className="shrink-0 text-[13px] leading-none text-izi-gray hover:text-red disabled:opacity-50"
        >
          ×
        </button>
      )}
    </li>
  );
}

interface StepFormProps {
  users: UserOption[];
  busy: boolean;
  initial?: TaskStepItem;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}

function StepForm({ users, busy, initial, submitLabel, onCancel, onSubmit }: StepFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? "");
  const [points, setPoints] = useState(
    initial?.storyPoints != null ? String(initial.storyPoints) : ""
  );

  function submit() {
    if (!title.trim()) return;
    const parsed = points.trim() === "" ? null : Number(points);
    onSubmit({
      title: title.trim(),
      assigneeId: assigneeId || null,
      storyPoints: parsed != null && Number.isFinite(parsed) ? parsed : null,
    });
  }

  return (
    <div className="mb-2 rounded-[8px] border border-border-soft bg-izi-gray-lt/30 p-2.5 space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder="Titre de la sous-tâche"
        autoFocus
        aria-label="Titre de la sous-tâche"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full rounded-[6px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          aria-label="Responsable de la sous-tâche"
          className="rounded-[6px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
        >
          <option value="">Non assignée</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <input
          type="number"
          min={0}
          max={1000}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="Points"
          aria-label="Story points de la sous-tâche"
          className="rounded-[6px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-izi-gray hover:underline"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
