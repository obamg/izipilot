"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "./FormModal";

interface UserFormModalProps {
  open: boolean;
  onClose: () => void;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
  } | null;
}

const ROLES = [
  { value: "CEO", label: "CEO" },
  { value: "MANAGEMENT", label: "Management" },
  { value: "PO", label: "Product Owner" },
  { value: "VIEWER", label: "Viewer" },
];

export function UserFormModal({ open, onClose, user }: UserFormModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!user;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      name: form.get("name") as string,
      role: form.get("role") as string,
    };

    if (!isEdit) {
      data.email = form.get("email") as string;
      data.password = form.get("password") as string;
    }

    try {
      const url = isEdit ? `/api/admin/users/${user.id}` : "/api/admin/users";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la sauvegarde");
      }

      onClose();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  return (
    <FormModal
      title={isEdit ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
      open={open}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nom complet
          </label>
          <input
            name="name"
            type="text"
            required
            defaultValue={user?.name ?? ""}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
          />
        </div>

        {!isEdit && (
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
              placeholder="utilisateur@izichange.com"
            />
          </div>
        )}

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            R&ocirc;le
          </label>
          <select
            name="role"
            required
            defaultValue={user?.role ?? "PO"}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {!isEdit && (
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Mot de passe
            </label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
              placeholder="Min. 8 caract\u00e8res"
            />
          </div>
        )}

        {error && (
          <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">
            {error}
          </p>
        )}

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
            disabled={isPending}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {isPending ? "..." : isEdit ? "Enregistrer" : "Cr\u00e9er"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
