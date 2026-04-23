"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "./FormModal";

interface ProductFormModalProps {
  open: boolean;
  onClose: () => void;
  product?: {
    id: string;
    code: string;
    name: string;
    color: string;
    description: string | null;
    status: string;
    ownerId: string;
  } | null;
  users: { id: string; name: string }[];
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Actif" },
  { value: "IN_DEVELOPMENT", label: "En d\u00e9veloppement" },
  { value: "PLANNED", label: "Planifi\u00e9" },
  { value: "PAUSED", label: "En pause" },
];

export function ProductFormModal({
  open,
  onClose,
  product,
  users,
}: ProductFormModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!product;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const data = {
      code: form.get("code") as string,
      name: form.get("name") as string,
      color: form.get("color") as string,
      description: (form.get("description") as string) || null,
      status: form.get("status") as string,
      ownerId: form.get("ownerId") as string,
    };

    try {
      const url = isEdit
        ? `/api/admin/products/${product.id}`
        : "/api/admin/products";
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
      title={isEdit ? "Modifier le produit" : "Nouveau produit"}
      open={open}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Code
            </label>
            <input
              name="code"
              required
              defaultValue={product?.code ?? ""}
              placeholder="P8"
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
            />
          </div>
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Couleur
            </label>
            <input
              name="color"
              type="color"
              required
              defaultValue={product?.color ?? "#008081"}
              className="w-full h-[34px] border border-teal-md rounded-[7px] cursor-pointer"
            />
          </div>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nom
          </label>
          <input
            name="name"
            required
            defaultValue={product?.name ?? ""}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Description
          </label>
          <textarea
            name="description"
            defaultValue={product?.description ?? ""}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans resize-none h-[52px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Statut
            </label>
            <select
              name="status"
              required
              defaultValue={product?.status ?? "ACTIVE"}
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Responsable (PO)
            </label>
            <select
              name="ownerId"
              required
              defaultValue={product?.ownerId ?? ""}
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
            >
              <option value="">S&eacute;lectionner...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>

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
