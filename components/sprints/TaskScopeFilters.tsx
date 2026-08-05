"use client";

import type { TeamOption } from "./types";

// Shared scope filters (assignee / team / priority) used by both the board and
// the burndown so a filtered view is consistent across tabs. Free-text search
// lives only on the board (it doesn't apply to a burndown), so it's not here.

const PRIORITY_FILTERS: { value: string; label: string }[] = [
  { value: "URGENT", label: "Urgente" },
  { value: "HIGH", label: "Haute" },
  { value: "MEDIUM", label: "Moyenne" },
  { value: "LOW", label: "Basse" },
];

const SELECT_CLS =
  "rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal";

interface Props {
  currentUserId: string;
  assigneeFilter: string;
  setAssigneeFilter: (v: string) => void;
  teamFilter: string;
  setTeamFilter: (v: string) => void;
  priorityFilter: string;
  setPriorityFilter: (v: string) => void;
  assigneeOptions: { id: string; name: string }[];
  products: TeamOption[];
  departments: TeamOption[];
}

export function TaskScopeFilters({
  currentUserId,
  assigneeFilter,
  setAssigneeFilter,
  teamFilter,
  setTeamFilter,
  priorityFilter,
  setPriorityFilter,
  assigneeOptions,
  products,
  departments,
}: Props) {
  const mineActive = assigneeFilter === currentUserId;

  return (
    <>
      {/* Quick "my tasks" toggle — one click to see only what's assigned to me. */}
      <button
        type="button"
        onClick={() => setAssigneeFilter(mineActive ? "ALL" : currentUserId)}
        aria-pressed={mineActive}
        className={`rounded-[7px] border px-3 py-1.5 text-[12px] font-medium transition-colors ${
          mineActive
            ? "border-teal bg-teal text-white"
            : "border-border-soft bg-white text-dark hover:bg-gray-lt"
        }`}
      >
        Mes tâches
      </button>

      <select
        value={assigneeFilter}
        onChange={(e) => setAssigneeFilter(e.target.value)}
        className={SELECT_CLS}
        aria-label="Filtrer par personne"
      >
        <option value="ALL">Tout le monde</option>
        <option value={currentUserId}>Mes tâches</option>
        <option value="UNASSIGNED">Non assignées</option>
        {assigneeOptions.some((u) => u.id !== currentUserId) && (
          <optgroup label="Personnes">
            {assigneeOptions
              .filter((u) => u.id !== currentUserId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </optgroup>
        )}
      </select>

      <select
        value={teamFilter}
        onChange={(e) => setTeamFilter(e.target.value)}
        className={SELECT_CLS}
        aria-label="Filtrer par équipe"
      >
        <option value="ALL">Toutes les équipes</option>
        <optgroup label="Produits">
          {products.map((p) => (
            <option key={p.id} value={`P:${p.id}`}>
              {p.code} — {p.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Départements">
          {departments.map((d) => (
            <option key={d.id} value={`D:${d.id}`}>
              {d.code} — {d.name}
            </option>
          ))}
        </optgroup>
      </select>

      <select
        value={priorityFilter}
        onChange={(e) => setPriorityFilter(e.target.value)}
        className={SELECT_CLS}
        aria-label="Filtrer par priorité"
      >
        <option value="ALL">Toutes priorités</option>
        {PRIORITY_FILTERS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </>
  );
}
