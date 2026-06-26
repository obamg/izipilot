"use client";

import { useEffect, useState } from "react";

export interface EditableSprint {
  id: string;
  name: string;
  goal: string | null;
  startDate: string; // ISO
  endDate: string; // ISO
}

interface SprintFormModalProps {
  sprint?: EditableSprint | null; // present → edit, absent → create
  onClose: () => void;
  onSaved?: () => void;
}

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function SprintFormModal({ sprint, onClose, onSaved }: SprintFormModalProps) {
  const isEdit = Boolean(sprint);
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [startDate, setStartDate] = useState(toDateInput(sprint?.startDate ?? null));
  const [endDate, setEndDate] = useState(toDateInput(sprint?.endDate ?? null));
  const [isSaving, setIsSaving] = useState(false);
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
    if (!name.trim() || !startDate || !endDate) return;
    setError(null);
    setIsSaving(true);
    try {
      const res = await fetch(
        isEdit ? `/api/sprints/${sprint!.id}` : "/api/sprints",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            goal: goal.trim() ? goal.trim() : null,
            startDate,
            endDate,
          }),
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

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Modifier le sprint" : "Nouveau sprint"}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3"
      >
        <h2 className="font-serif text-lg text-dark">
          {isEdit ? "Modifier le sprint" : "Nouveau sprint"}
        </h2>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">
            Nom
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="Sprint 4 — …"
            className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-izi-gray mb-1">
            Objectif du sprint
          </label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Que voulons-nous livrer ?"
            className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Début
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full rounded-[7px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Fin
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full rounded-[7px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">
            {error}
          </div>
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
            disabled={isSaving || !name.trim() || !startDate || !endDate}
            className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-white bg-teal hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {isSaving ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </form>
    </div>
  );
}
