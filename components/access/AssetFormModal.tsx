"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "@/components/admin/FormModal";

interface AssetFormModalProps {
  open: boolean;
  onClose: () => void;
  users: { id: string; name: string }[];
}

export function AssetFormModal({ open, onClose, users }: AssetFormModalProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/access/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: (form.get("description") as string) || null,
          ownerId: (form.get("ownerId") as string) || null,
          backupOwnerId: (form.get("backupOwnerId") as string) || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la création");
      }
      onClose();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal title="Nouvel actif" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nom
          </label>
          <input
            name="name"
            required
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Description
          </label>
          <textarea
            name="description"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans resize-none h-[52px]"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Propriétaire
          </label>
          <select
            name="ownerId"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Aucun pour l&apos;instant</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Suppléant du propriétaire
          </label>
          <select
            name="backupOwnerId"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Aucun</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {saving ? "..." : "Créer"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
