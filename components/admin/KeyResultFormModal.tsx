"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "./FormModal";

interface KeyResultFormModalProps {
  open: boolean;
  onClose: () => void;
  objectiveId: string;
  kr?: {
    id: string;
    title: string;
    krType: string;
    target: number | null;
    targetUnit: string | null;
    targetDate: string | null;
    ownerId: string;
  } | null;
  users: { id: string; name: string }[];
}

export function KeyResultFormModal({
  open,
  onClose,
  objectiveId,
  kr,
  users,
}: KeyResultFormModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [krType, setKrType] = useState(kr?.krType ?? "NUMERIC");
  const isEdit = !!kr;

  function handleOpen() {
    setKrType(kr?.krType ?? "NUMERIC");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {
      title: form.get("title") as string,
      krType,
      ownerId: form.get("ownerId") as string,
    };

    if (krType === "NUMERIC" || krType === "PERCENTAGE") {
      data.target = Number(form.get("target"));
      data.targetUnit = (form.get("targetUnit") as string) || null;
      data.targetDate = null;
    } else if (krType === "DATE") {
      data.target = null;
      data.targetUnit = null;
      data.targetDate = (form.get("targetDate") as string) || null;
    } else {
      // BINARY
      data.target = 1;
      data.targetUnit = null;
      data.targetDate = null;
    }

    if (!isEdit) {
      data.objectiveId = objectiveId;
    }

    try {
      const url = isEdit
        ? `/api/admin/key-results/${kr.id}`
        : "/api/admin/key-results";
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

  const showTarget = krType === "NUMERIC" || krType === "PERCENTAGE";
  const showDate = krType === "DATE";

  return (
    <FormModal
      title={isEdit ? "Modifier le Key Result" : "Nouveau Key Result"}
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
            defaultValue={kr?.title ?? ""}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Type
          </label>
          <div className="flex gap-1 flex-wrap">
            {(["NUMERIC", "PERCENTAGE", "DATE", "BINARY"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setKrType(t)}
                className={`px-2 py-[5px] rounded-[6px] text-[10px] font-medium transition-colors ${
                  krType === t
                    ? "bg-teal text-white"
                    : "border border-teal-md text-izi-gray hover:bg-teal-lt"
                }`}
              >
                {t === "NUMERIC"
                  ? "Num\u00e9rique"
                  : t === "PERCENTAGE"
                  ? "Pourcentage"
                  : t === "DATE"
                  ? "Date/Jalon"
                  : "Binaire"}
              </button>
            ))}
          </div>
        </div>

        {showTarget && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                Cible
              </label>
              <input
                name="target"
                type="number"
                step="any"
                required
                defaultValue={kr?.target ?? ""}
                className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
              />
            </div>
            <div>
              <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
                Unit&eacute;
              </label>
              <input
                name="targetUnit"
                defaultValue={kr?.targetUnit ?? ""}
                placeholder="$, %, traders..."
                className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
              />
            </div>
          </div>
        )}

        {showDate && (
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Date cible
            </label>
            <input
              name="targetDate"
              required
              defaultValue={kr?.targetDate ?? ""}
              placeholder="Avr 2026"
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
            />
          </div>
        )}

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Responsable (PO)
          </label>
          <select
            name="ownerId"
            required
            defaultValue={kr?.ownerId ?? ""}
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
