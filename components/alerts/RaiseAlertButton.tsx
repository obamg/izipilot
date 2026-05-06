"use client";

import { useState } from "react";
import { AlertCreateModal } from "./AlertCreateModal";

interface Props {
  krId: string;
  krTitle: string;
}

export function RaiseAlertButton({ krId, krTitle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold text-red border border-red/40 bg-white hover:bg-red-lt px-3 py-1.5 rounded-md transition-colors"
      >
        Soulever une alerte
      </button>
      {open && (
        <AlertCreateModal
          krId={krId}
          krTitle={krTitle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
