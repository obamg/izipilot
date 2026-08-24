"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "./FormModal";

interface DepartmentFormModalProps {
  open: boolean;
  onClose: () => void;
  department?: {
    id: string;
    code: string;
    name: string;
    color: string;
    description: string | null;
    ownerId: string;
    acceptsRequests: boolean;
    supportUserId: string | null;
  } | null;
  users: { id: string; name: string }[];
}

export function DepartmentFormModal({
  open,
  onClose,
  department,
  users,
}: DepartmentFormModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!department;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const data = {
      code: form.get("code") as string,
      name: form.get("name") as string,
      color: form.get("color") as string,
      description: (form.get("description") as string) || null,
      ownerId: form.get("ownerId") as string,
      acceptsRequests: form.get("acceptsRequests") === "on",
      // Chaîne vide = pas d'agent désigné → l'API stocke null et les demandes
      // retombent sur le responsable.
      supportUserId: (form.get("supportUserId") as string) || null,
    };

    try {
      const url = isEdit
        ? `/api/admin/departments/${department.id}`
        : "/api/admin/departments";
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
      title={isEdit ? "Modifier le d\u00e9partement" : "Nouveau d\u00e9partement"}
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
              defaultValue={department?.code ?? ""}
              placeholder="D9"
              className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans"
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
              defaultValue={department?.color ?? "#008081"}
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
            defaultValue={department?.name ?? ""}
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Description
          </label>
          <textarea
            name="description"
            defaultValue={department?.description ?? ""}
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans resize-none h-[52px]"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Responsable
          </label>
          <select
            name="ownerId"
            required
            defaultValue={department?.ownerId ?? ""}
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">S&eacute;lectionner...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        {/* Guichet de demandes internes */}
        <div className="border-t border-border-soft pt-3 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="acceptsRequests"
              defaultChecked={department?.acceptsRequests ?? false}
              className="accent-[color:var(--teal)]"
            />
            <span className="text-[11px] font-medium text-dark">
              Guichet de demandes internes
            </span>
          </label>
          <p className="text-[10px] text-izi-gray">
            Quand c&apos;est activ&eacute;, tout le monde peut adresser une demande
            &agrave; ce d&eacute;partement depuis &laquo;&nbsp;Demandes internes&nbsp;&raquo;.
          </p>

          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Agent traiteur
            </label>
            <select
              name="supportUserId"
              defaultValue={department?.supportUserId ?? ""}
              className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
            >
              <option value="">Aucun &mdash; le responsable re&ccedil;oit les demandes</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-izi-gray mt-1">
              Re&ccedil;oit les nouvelles demandes en auto-affectation.
            </p>
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
