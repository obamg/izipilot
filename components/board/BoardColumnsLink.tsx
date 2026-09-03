"use client";

import Link from "next/link";
import type { UserRole } from "@prisma/client";
import { canViewWorkflows } from "@/lib/workflow-access";

interface Props {
  role: UserRole;
  /** Flux actuellement affiché — sert d'ancre pour arriver sur sa carte. */
  workflowId: string | null;
}

/**
 * Raccourci « Colonnes » depuis un tableau vers l'écran des flux.
 *
 * Sans lui, la configuration des colonnes n'est atteignable que par une entrée
 * de barre latérale nommée « Flux de tableau » — un vocabulaire qu'on ne
 * devine pas depuis le kanban qu'on cherche à modifier. Le lien pointe droit
 * sur la carte du flux affiché.
 */
export function BoardColumnsLink({ role, workflowId }: Props) {
  if (!canViewWorkflows(role)) return null;

  return (
    <Link
      href={workflowId ? `/workflows#wf-${workflowId}` : "/workflows"}
      className="inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] text-teal transition-colors hover:bg-teal-lt hover:text-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
      title="Ajouter, renommer ou réordonner les colonnes de ce tableau"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <rect x="3" y="4" width="4" height="16" rx="1" />
        <rect x="10" y="4" width="4" height="10" rx="1" />
        <rect x="17" y="4" width="4" height="13" rx="1" />
      </svg>
      Colonnes
    </Link>
  );
}
