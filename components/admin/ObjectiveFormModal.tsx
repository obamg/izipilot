"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "./FormModal";

interface ObjectiveFormModalProps {
  open: boolean;
  onClose: () => void;
  objective?: {
    id: string;
    title: string;
    why: string | null;
    quarter: string;
    year: number;
    entityType: string;
    departmentId: string | null;
    productId: string | null;
  } | null;
  departments: { id: string; code: string; name: string }[];
  products: { id: string; code: string; name: string }[];
}

export function ObjectiveFormModal({
  open,
  onClose,
  objective,
  departments,
  products,
}: ObjectiveFormModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string>(
    objective?.entityType ?? "DEPARTMENT"
  );
  const isEdit = !!objective;

  function handleOpen() {
    if (!isEdit) {
      setEntityType("DEPARTMENT");
    } else {
      setEntityType(objective.entityType);
    }
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const data = {
      title: form.get("title") as string,
      why: (form.get("why") as string) || null,
      quarter: form.get("quarter") as string,
      year: Number(form.get("year")),
      entityType,
      departmentId: entityType === "DEPARTMENT" ? (form.get("entityId") as string) : undefined,
      productId: entityType === "PRODUCT" ? (form.get("entityId") as string) : undefined,
    };

    try {
      const url = isEdit
        ? `/api/admin/objectives/${objective.id}`
        : "/api/admin/objectives";
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

  const entities = entityType === "DEPARTMENT" ? departments : products;
  const defaultEntityId =
    objective?.entityType === "DEPARTMENT"
      ? objective.departmentId
      : objective?.productId;

  return (
    <FormModal
      title={isEdit ? "Modifier l'objectif" : "Nouvel objectif"}
      open={open}
      onClose={onClose}
      onOpen={handleOpen}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Titre
          </label>
          <input
            name="title"
            required
            defaultValue={objective?.title ?? ""}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Pourquoi cet objectif ?
          </label>
          <textarea
            name="why"
            defaultValue={objective?.why ?? ""}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans resize-none h-[52px]"
          />
        </div>

        {!isEdit && (
          <>
            <div>
              <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                Type d&apos;entit&eacute;
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEntityType("DEPARTMENT")}
                  className={`px-3 py-[6px] rounded-[7px] text-[11px] font-medium transition-colors ${
                    entityType === "DEPARTMENT"
                      ? "bg-teal text-white"
                      : "border border-teal-md text-izi-gray hover:bg-teal-lt"
                  }`}
                >
                  D&eacute;partement
                </button>
                <button
                  type="button"
                  onClick={() => setEntityType("PRODUCT")}
                  className={`px-3 py-[6px] rounded-[7px] text-[11px] font-medium transition-colors ${
                    entityType === "PRODUCT"
                      ? "bg-teal text-white"
                      : "border border-teal-md text-izi-gray hover:bg-teal-lt"
                  }`}
                >
                  Produit
                </button>
              </div>
            </div>

            <div>
              <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                {entityType === "DEPARTMENT" ? "D\u00e9partement" : "Produit"}
              </label>
              <select
                name="entityId"
                required
                defaultValue={defaultEntityId ?? ""}
                className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
              >
                <option value="">S&eacute;lectionner...</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} — {e.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Trimestre
            </label>
            <select
              name="quarter"
              required
              defaultValue={objective?.quarter ?? "Q1"}
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
            >
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Ann&eacute;e
            </label>
            <input
              name="year"
              type="number"
              required
              min={2024}
              max={2030}
              defaultValue={objective?.year ?? 2026}
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
            />
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
