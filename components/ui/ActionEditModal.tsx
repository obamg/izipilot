"use client";

import { useEffect, useState } from "react";
import type { ActionStatus, ActionPriority } from "@prisma/client";

export interface EditableAction {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
}

interface ActionEditModalProps {
  action: EditableAction;
  users: { id: string; name: string }[];
  canDelete?: boolean;
  onClose: () => void;
  onUpdated?: () => void;
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

export function ActionEditModal({
  action,
  users,
  canDelete = false,
  onClose,
  onUpdated,
  onDeleted,
}: ActionEditModalProps) {
  const [title, setTitle] = useState(action.title);
  const [description, setDescription] = useState(action.description ?? "");
  const [assigneeId, setAssigneeId] = useState(action.assigneeId);
  const [status, setStatus] = useState<ActionStatus>(action.status);
  const [priority, setPriority] = useState<ActionPriority>(action.priority);
  const [dueDate, setDueDate] = useState(toDateInput(action.dueDate));
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          assigneeId,
          status,
          priority,
          dueDate: dueDate || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur lors de la sauvegarde");
        return;
      }
      onUpdated?.();
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Supprimer cette action ?")) return;
    setError(null);
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/actions/${action.id}`, { method: "DELETE" });
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Modifier l'action"
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3"
      >
        <h2 className="font-serif text-lg text-dark">Modifier l&apos;action</h2>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">
            Titre
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={2}
            maxLength={200}
            className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Responsable
            </label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Statut
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ActionStatus)}
              className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Priorité
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ActionPriority)}
              className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Échéance
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-[7px] border border-[#deeaea] bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          {canDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || isSaving}
              className="text-[12px] font-medium text-red hover:underline disabled:opacity-50"
            >
              {isDeleting ? "Suppression…" : "Supprimer"}
            </button>
          ) : <span />}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-izi-gray border border-[#deeaea] bg-white hover:bg-gray-lt transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-white bg-teal hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {isSaving ? "Sauvegarde…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
