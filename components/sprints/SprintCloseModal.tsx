"use client";

import { useEffect, useState } from "react";
import { describeClosePlan, type ClosePlan } from "@/lib/sprint";

interface SprintCloseModalProps {
  sprintName: string;
  /** Le plan est chargé par l'appelant ; null tant qu'il arrive. */
  plan: ClosePlan | null;
  loadError: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (startNext: boolean) => void;
}

export function SprintCloseModal({
  sprintName,
  plan,
  loadError,
  busy,
  onCancel,
  onConfirm,
}: SprintCloseModalProps) {
  // Coché par défaut : c'est le comportement en vigueur, et laisser l'org sans
  // sprint actif doit rester un geste délibéré, pas un oubli.
  const [startNext, setStartNext] = useState(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const lines = plan ? describeClosePlan(plan, startNext) : [];
  const leavesOrgIdle = Boolean(plan) && (!plan!.chainTo || !startNext);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Clôturer ${sprintName}`}
    >
      <div className="w-full max-w-md rounded-[12px] border border-border-soft bg-white p-5 shadow-lg">
        <h2 className="font-serif text-lg text-dark mb-1">Clôturer {sprintName} ?</h2>
        <p className="text-[12px] text-izi-gray mb-3">
          Cette action est définitive : les scores du sprint sont figés.
        </p>

        {loadError ? (
          <div className="rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
            {loadError}
          </div>
        ) : !plan ? (
          <p className="text-[12px] text-izi-gray py-3">Calcul des conséquences…</p>
        ) : (
          <>
            <ul className="space-y-1.5 mb-3">
              {lines.map((line, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-dark">
                  <span className="text-teal shrink-0" aria-hidden="true">
                    →
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {plan.chainTo && (
              <label className="flex items-start gap-2 rounded-[7px] border border-border-soft bg-gray-lt px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={startNext}
                  onChange={(e) => setStartNext(e.target.checked)}
                  className="mt-0.5 accent-teal"
                />
                <span className="text-[12px] text-dark">
                  Démarrer {plan.chainTo.name} maintenant
                  <span className="block text-[11px] text-izi-gray mt-0.5">
                    Décochez pour clôturer aujourd&apos;hui et démarrer plus tard.
                  </span>
                </span>
              </label>
            )}

            {leavesOrgIdle && (
              <p className="mt-2 rounded-[7px] border border-gold/40 bg-gold-lt px-3 py-2 text-[11px] text-dark-md">
                Sans sprint actif, les tâches récurrentes du jour tomberont au
                backlog. Elles seront reprises au démarrage du prochain sprint.
              </p>
            )}
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[7px] border border-border-soft bg-white px-3 py-1.5 text-[12px] font-medium text-izi-gray hover:bg-gray-lt transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(startNext)}
            disabled={busy || !plan}
            className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {busy ? "Clôture…" : "Clôturer"}
          </button>
        </div>
      </div>
    </div>
  );
}
