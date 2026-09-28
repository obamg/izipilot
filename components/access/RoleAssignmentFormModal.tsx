"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "@/components/admin/FormModal";

const ASSIGNABLE_ROLES = [
  { value: "IT_ACCESS_OPERATOR", label: "Opérateur accès IT" },
  { value: "HR", label: "RH" },
  { value: "CISO", label: "CISO" },
  { value: "COO", label: "COO" },
  { value: "ASSET_ADMINISTRATOR", label: "Administrateur d'actifs" },
  { value: "AUDIT_VIEWER", label: "Auditeur" },
] as const;

interface RoleAssignmentFormModalProps {
  open: boolean;
  onClose: () => void;
  users: { id: string; name: string }[];
}

export function RoleAssignmentFormModal({ open, onClose, users }: RoleAssignmentFormModalProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const form = new FormData(e.currentTarget);
    const backupUserId = (form.get("backupUserId") as string) || null;

    try {
      const res = await fetch("/api/access/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: form.get("role"),
          userId: form.get("userId"),
          backupUserId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de l'attribution");
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
    <FormModal title="Attribuer un rôle" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Rôle
          </label>
          <select
            name="role"
            required
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Sélectionner...</option>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Titulaire
          </label>
          <select
            name="userId"
            required
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Sélectionner...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Suppléant (optionnel)
          </label>
          <select
            name="backupUserId"
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
            {saving ? "..." : "Attribuer"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
