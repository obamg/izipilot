"use client";

import { useEffect, useState } from "react";
import type { ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { TaskRequestSection } from "./TaskRequestSection";
import { TaskStepsSection } from "./TaskStepsSection";
import type {
  SprintTaskItem,
  UserOption,
  TeamOption,
  KrOption,
} from "./types";

interface SprintTaskModalProps {
  task?: SprintTaskItem | null; // present → edit
  defaultSprintId?: string | null; // for create: target sprint (null = backlog)
  users: UserOption[];
  products: TeamOption[];
  departments: TeamOption[];
  krs: KrOption[];
  canDelete?: boolean;
  // CONTRIBUTOR view: only the report link is editable (own task only).
  reportOnly?: boolean;
  currentUserId: string;
  currentUserRole: UserRole;
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

const STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "TODO", label: "À faire" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "BLOCKED", label: "Bloquée" },
  { value: "DONE", label: "Terminée" },
  { value: "CANCELLED", label: "Annulée" },
];

const PRIORITY_OPTIONS: { value: ActionPriority; label: string }[] = [
  { value: "LOW", label: "Basse" },
  { value: "MEDIUM", label: "Moyenne" },
  { value: "HIGH", label: "Haute" },
  { value: "URGENT", label: "Urgente" },
];

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

// Team is a single select; encode the choice as "P:<id>" / "D:<id>" / "".
function teamValueOf(task?: SprintTaskItem | null): string {
  if (task?.productId) return `P:${task.productId}`;
  if (task?.departmentId) return `D:${task.departmentId}`;
  return "";
}

export function SprintTaskModal({
  task,
  defaultSprintId = null,
  users,
  products,
  departments,
  krs,
  canDelete = false,
  reportOnly = false,
  currentUserId,
  currentUserRole,
  onClose,
  onSaved,
  onDeleted,
}: SprintTaskModalProps) {
  const isEdit = Boolean(task);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [reportUrl, setReportUrl] = useState(task?.reportUrl ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? "");
  const [team, setTeam] = useState(teamValueOf(task));
  const [krId, setKrId] = useState(task?.krId ?? "");
  const [priority, setPriority] = useState<ActionPriority>(task?.priority ?? "MEDIUM");
  const [status, setStatus] = useState<ActionStatus>(task?.status ?? "TODO");
  const [storyPoints, setStoryPoints] = useState(
    task?.storyPoints != null ? String(task.storyPoints) : ""
  );
  const [dueDate, setDueDate] = useState(toDateInput(task?.dueDate ?? null));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function teamFields() {
    if (team.startsWith("P:")) return { productId: team.slice(2), departmentId: null };
    if (team.startsWith("D:")) return { departmentId: team.slice(2), productId: null };
    return { productId: null, departmentId: null };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setIsSaving(true);
    try {
      const reportValue = reportUrl.trim() ? reportUrl.trim() : null;
      let payload: Record<string, unknown>;
      if (reportOnly) {
        // CONTRIBUTOR may only touch the report link — send that field alone.
        payload = { reportUrl: reportValue };
      } else {
        const { productId, departmentId } = teamFields();
        const points = storyPoints.trim() === "" ? null : Number(storyPoints);
        payload = {
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          reportUrl: reportValue,
          assigneeId: assigneeId || null,
          productId,
          departmentId,
          krId: krId || null,
          priority,
          storyPoints: points != null && Number.isFinite(points) ? points : null,
          dueDate: dueDate || null,
        };
        if (isEdit) payload.status = status;
        else payload.sprintId = defaultSprintId;
      }

      const res = await fetch(
        isEdit ? `/api/sprint-tasks/${task!.id}` : "/api/sprint-tasks",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de l'enregistrement");
        return;
      }
      onSaved?.();
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!confirm("Supprimer cette tâche ?")) return;
    setError(null);
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/sprint-tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de la suppression");
        return;
      }
      onDeleted?.();
      onClose();
    } finally {
      setIsDeleting(false);
    }
  }

  const teamOptions = [
    {
      label: "Produits",
      options: products.map((p) => ({
        value: `P:${p.id}`,
        label: `${p.code} — ${p.name}`,
        searchHaystack: p.code,
      })),
    },
    {
      label: "Départements",
      options: departments.map((d) => ({
        value: `D:${d.id}`,
        label: `${d.code} — ${d.name}`,
        searchHaystack: d.code,
      })),
    },
  ];

  // Group KRs by entity for the searchable picker.
  const krGroups = (() => {
    const grouped = new Map<string, { entity: string; krs: KrOption[] }>();
    for (const kr of krs) {
      const key = kr.entityCode || "—";
      if (!grouped.has(key)) grouped.set(key, { entity: `${kr.entityCode} — ${kr.entityName}`, krs: [] });
      grouped.get(key)!.krs.push(kr);
    }
    return Array.from(grouped.values()).map((g) => ({
      label: g.entity,
      options: g.krs.map((kr) => ({
        value: kr.id,
        label: kr.title,
        searchHaystack: g.entity,
      })),
    }));
  })();

  // Compact editor for CONTRIBUTOR: report link only, on their own task.
  if (reportOnly) {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Lien du rapport"
      >
        <form
          onSubmit={handleSave}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3"
        >
          <h2 className="font-serif text-lg text-dark">Lien du rapport</h2>
          {task && (
            <p className="text-[12px] text-izi-gray line-clamp-2">{task.title}</p>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Lien du rapport (optionnel)
            </label>
            <input
              type="url"
              value={reportUrl}
              onChange={(e) => setReportUrl(e.target.value)}
              maxLength={2048}
              placeholder="https://…"
              autoFocus
              className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal"
            />
          </div>

          {error && (
            <div className="rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">
              {error}
            </div>
          )}

          {task && (
            <TaskStepsSection
              taskId={task.id}
              taskAssigneeId={task.assigneeId}
              initialSteps={task.steps}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              users={users}
              onChanged={onSaved}
            />
          )}

          {task && (
            <TaskRequestSection
              taskId={task.id}
              taskAssigneeId={task.assigneeId}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              users={users}
              products={products}
              departments={departments}
              onChanged={onSaved}
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-izi-gray border border-border-soft bg-white hover:bg-gray-lt transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-white bg-teal hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Modifier la tâche" : "Nouvelle tâche"}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-serif text-lg text-dark">
          {isEdit ? "Modifier la tâche" : "Nouvelle tâche"}
        </h2>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">Titre</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={2}
            maxLength={200}
            className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal resize-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">
            Lien du rapport (optionnel)
          </label>
          <input
            type="url"
            value={reportUrl}
            onChange={(e) => setReportUrl(e.target.value)}
            maxLength={2048}
            placeholder="https://…"
            className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">Responsable</label>
            <SearchableSelect
              value={assigneeId || "NONE"}
              onChange={(v) => setAssigneeId(v === "NONE" ? "" : v)}
              ariaLabel="Responsable"
              allOption={{ value: "NONE", label: "Non assignée" }}
              options={users.map((u) => ({ value: u.id, label: u.name }))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">Équipe</label>
            <SearchableSelect
              value={team || "NONE"}
              onChange={(v) => setTeam(v === "NONE" ? "" : v)}
              ariaLabel="Équipe"
              allOption={{ value: "NONE", label: "Aucune équipe" }}
              options={teamOptions}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">
            Key Result lié (optionnel)
          </label>
          <SearchableSelect
            value={krId || "NONE"}
            onChange={(v) => setKrId(v === "NONE" ? "" : v)}
            ariaLabel="Key Result lié"
            allOption={{ value: "NONE", label: "Aucun KR" }}
            options={krGroups}
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">Priorité</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ActionPriority)}
              className="w-full rounded-[7px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {isEdit && (
            <div>
              <label className="block text-[11px] font-semibold text-izi-gray mb-1">Statut</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ActionStatus)}
                className="w-full rounded-[7px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">Points</label>
            <input
              type="number"
              min={0}
              max={1000}
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
              placeholder="—"
              className="w-full rounded-[7px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">Échéance</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-[7px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">
            {error}
          </div>
        )}

        {isEdit && task && (
          <TaskStepsSection
            taskId={task.id}
            taskAssigneeId={task.assigneeId}
            initialSteps={task.steps}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            users={users}
            onChanged={onSaved}
          />
        )}

        {isEdit && task && (
          <TaskRequestSection
            taskId={task.id}
            taskAssigneeId={task.assigneeId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            users={users}
            products={products}
            departments={departments}
            onChanged={onSaved}
          />
        )}

        <div className="flex items-center justify-between pt-1">
          {isEdit && canDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || isSaving}
              className="text-[12px] font-medium text-red hover:underline disabled:opacity-50"
            >
              {isDeleting ? "Suppression…" : "Supprimer"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-izi-gray border border-border-soft bg-white hover:bg-gray-lt transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-white bg-teal hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
