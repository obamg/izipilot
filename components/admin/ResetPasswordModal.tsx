"use client";

import { useState, useTransition } from "react";
import { FormModal } from "./FormModal";

interface ResetPasswordModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}

export function ResetPasswordModal({
  open,
  onClose,
  userId,
  userName,
}: ResetPasswordModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const form = new FormData(e.currentTarget);
    const newPassword = form.get("newPassword") as string;
    const confirm = form.get("confirm") as string;

    if (newPassword !== confirm) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/users/${userId}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur");
      }

      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  return (
    <FormModal
      title={`R\u00e9initialiser le mot de passe`}
      open={open}
      onClose={onClose}
    >
      <p className="text-[11px] text-izi-gray mb-3">
        Nouveau mot de passe pour <strong>{userName}</strong>
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nouveau mot de passe
          </label>
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
          />
        </div>
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Confirmer
          </label>
          <input
            name="confirm"
            type="password"
            required
            minLength={8}
            className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
          />
        </div>

        {error && (
          <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">
            {error}
          </p>
        )}
        {success && (
          <p className="text-[11px] text-izi-green bg-izi-green-lt px-3 py-2 rounded-md">
            Mot de passe mis &agrave; jour
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
            disabled={isPending || success}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {isPending ? "..." : "R\u00e9initialiser"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
