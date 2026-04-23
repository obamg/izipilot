"use client";

import { FormModal } from "./FormModal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmer",
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <FormModal title={title} open={open} onClose={onClose}>
      <p className="text-[11px] text-izi-gray mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={loading}
          className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
        >
          Annuler
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium text-white transition-colors disabled:opacity-50 ${
            destructive
              ? "bg-izi-red hover:bg-red-700"
              : "bg-teal hover:bg-teal-dk"
          }`}
        >
          {loading ? "..." : confirmLabel}
        </button>
      </div>
    </FormModal>
  );
}
