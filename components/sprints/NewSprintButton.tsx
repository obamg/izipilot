"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SprintFormModal } from "./SprintFormModal";

export function NewSprintButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[7px] bg-teal px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors"
      >
        + Nouveau sprint
      </button>
      {open && (
        <SprintFormModal
          onClose={() => setOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
