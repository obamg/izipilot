// Filtres de portée des tâches (équipe / personne / priorité / recherche).
//
// Extrait de SprintDetail pour que le tableau, le backlog et le burndown
// partagent EXACTEMENT la même règle : un onglet qui réimplémenterait le
// filtre finirait par diverger, et l'utilisateur verrait des tâches que le
// filtre affiché prétend avoir écartées.

/** Un filtre inactif vaut "ALL" ; la recherche inactive vaut "". */
export interface TaskScope {
  /** "ALL" | "P:<productId>" | "D:<departmentId>" */
  team: string;
  /** "ALL" | "UNASSIGNED" | "<userId>" */
  assignee: string;
  /** "ALL" | ActionPriority */
  priority: string;
  /** Texte libre ; comparé au titre, à la description, au KR et à la personne. */
  search: string;
}

export const EMPTY_SCOPE: TaskScope = {
  team: "ALL",
  assignee: "ALL",
  priority: "ALL",
  search: "",
};

/** Le minimum qu'une tâche doit exposer pour être filtrée. */
export interface FilterableTask {
  title: string;
  description: string | null;
  krTitle: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: string;
  productId: string | null;
  departmentId: string | null;
}

/** Vrai si un filtre de portée est posé (hors recherche : le burndown l'ignore). */
export function isScopeActive(scope: TaskScope): boolean {
  return scope.team !== "ALL" || scope.assignee !== "ALL" || scope.priority !== "ALL";
}

/** Vrai si quoi que ce soit restreint la vue, recherche comprise. */
export function isFilterActive(scope: TaskScope): boolean {
  return isScopeActive(scope) || scope.search.trim() !== "";
}

/** Portée seule — sans la recherche texte. */
export function matchesScope(task: FilterableTask, scope: TaskScope): boolean {
  if (scope.team.startsWith("P:") && task.productId !== scope.team.slice(2)) return false;
  if (scope.team.startsWith("D:") && task.departmentId !== scope.team.slice(2)) return false;

  if (scope.assignee === "UNASSIGNED") {
    if (task.assigneeId) return false;
  } else if (scope.assignee !== "ALL" && task.assigneeId !== scope.assignee) {
    return false;
  }

  if (scope.priority !== "ALL" && task.priority !== scope.priority) return false;

  return true;
}

/** Recherche texte seule. Une recherche vide laisse tout passer. */
export function matchesSearch(task: FilterableTask, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return `${task.title} ${task.description ?? ""} ${task.krTitle ?? ""} ${task.assigneeName ?? ""}`
    .toLowerCase()
    .includes(q);
}

/** Portée + recherche. C'est ce que voit l'utilisateur dans une liste. */
export function filterTasks<T extends FilterableTask>(
  tasks: readonly T[],
  scope: TaskScope
): T[] {
  return tasks.filter((t) => matchesScope(t, scope) && matchesSearch(t, scope.search));
}
