"use client";

import type { ReactNode } from "react";
import { TaskScopeFilters } from "./TaskScopeFilters";
import type { TeamOption } from "./types";

// Recherche + filtres de portée + compteur, montés ensemble. Le tableau et le
// backlog partagent cette barre : ce sont deux vues des mêmes tâches, filtrer
// l'une sans l'autre laissait passer des tâches que le filtre affiché dit
// pourtant avoir écartées.

interface Props {
  currentUserId: string;
  search: string;
  setSearch: (v: string) => void;
  assigneeFilter: string;
  setAssigneeFilter: (v: string) => void;
  teamFilter: string;
  setTeamFilter: (v: string) => void;
  priorityFilter: string;
  setPriorityFilter: (v: string) => void;
  assigneeOptions: { id: string; name: string }[];
  products: TeamOption[];
  departments: TeamOption[];
  /** Compteur "N sur M" affiché dès qu'un filtre est actif. */
  active: boolean;
  matched: number;
  total: number;
  onReset: () => void;
  /** Actions poussées à droite de la ligne de filtres (créer une tâche, etc.). */
  children?: ReactNode;
}

export function TaskFilterBar({
  currentUserId,
  search,
  setSearch,
  assigneeFilter,
  setAssigneeFilter,
  teamFilter,
  setTeamFilter,
  priorityFilter,
  setPriorityFilter,
  assigneeOptions,
  products,
  departments,
  active,
  matched,
  total,
  onReset,
  children,
}: Props) {
  return (
    <div className="mb-3 space-y-2">
      {/* Text search — the most prominent filter: type to narrow instantly. */}
      <div className="relative">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-izi-gray"
        >
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M14 14l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une tâche, une personne ou un KR…"
          aria-label="Rechercher une tâche"
          className="w-full rounded-[8px] border border-border-soft bg-white pl-9 pr-3 py-2 text-[13px] text-dark placeholder:text-izi-gray focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Effacer la recherche"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-izi-gray hover:text-dark text-[15px] leading-none"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TaskScopeFilters
          currentUserId={currentUserId}
          assigneeFilter={assigneeFilter}
          setAssigneeFilter={setAssigneeFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          assigneeOptions={assigneeOptions}
          products={products}
          departments={departments}
        />

        {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
      </div>

      {active && (
        <div className="flex items-center gap-2 text-[11px] text-izi-gray">
          <span>
            {matched} tâche{matched > 1 ? "s" : ""} sur {total}
          </span>
          <button type="button" onClick={onReset} className="text-teal hover:text-teal-dk underline">
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  );
}
