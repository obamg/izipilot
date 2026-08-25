/**
 * Colonnes de tableau configurables — helpers purs, sans accès Prisma, pour
 * que le placement des cartes et les garde-fous restent testables.
 *
 * Principe central : une colonne porte un libellé libre ("En revue", "Chez le
 * client"…) mais retombe toujours dans l'une des cinq catégories de
 * BoardColumnCategory. Les métriques (lib/sprint.ts, lib/evaluation.ts) ne
 * lisent QUE la catégorie, via la projection SprintTask.status. Une équipe peut
 * donc inventer son flux sans jamais fausser un burndown ni une clôture de
 * sprint.
 */

import type { BoardColumnCategory } from "@prisma/client";

// ── Catégories ───────────────────────────────────────────────────────────────

export interface CategoryMeta {
  label: string;
  /** Ce que la catégorie implique côté métriques — affiché dans l'admin. */
  hint: string;
  color: string;
}

export const CATEGORY_META: Record<BoardColumnCategory, CategoryMeta> = {
  TODO: {
    label: "À faire",
    hint: "Non commencée. Compte dans le reste-à-faire, reportée au sprint suivant.",
    color: "#5f6e7a",
  },
  IN_PROGRESS: {
    label: "En cours",
    hint: "Travail engagé. Compte dans le reste-à-faire, reportée au sprint suivant.",
    color: "#185FA5",
  },
  BLOCKED: {
    label: "Bloquée",
    hint: "Empêchée. Compte dans le reste-à-faire, reportée au sprint suivant.",
    color: "#e23c4a",
  },
  DONE: {
    label: "Terminée",
    hint: "Achevée. Fait descendre le burndown et alimente la vélocité.",
    color: "#1d9e75",
  },
  CANCELLED: {
    label: "Annulée",
    hint: "Hors périmètre. Exclue de tous les totaux du sprint.",
    color: "#8a9aa5",
  },
};

export const CATEGORY_ORDER: BoardColumnCategory[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
];

/**
 * Les cinq colonnes historiques, reproduites à l'identique. Sert de gabarit au
 * flux par défaut (seed + migration) et de point de départ à tout nouveau flux,
 * pour qu'une équipe parte d'un tableau qui marche plutôt que d'une page vide.
 */
export const DEFAULT_COLUMNS: ReadonlyArray<{
  label: string;
  color: string;
  category: BoardColumnCategory;
}> = CATEGORY_ORDER.map((category) => ({
  label: CATEGORY_META[category].label,
  color: CATEGORY_META[category].color,
  category,
}));

// ── Formes client ────────────────────────────────────────────────────────────

/** Une colonne telle que la reçoit le navigateur. */
export interface BoardColumnDef {
  id: string;
  label: string;
  color: string;
  category: BoardColumnCategory;
  sortOrder: number;
  wipLimit: number | null;
}

/** Un flux et ses colonnes, prêt à être rendu. */
export interface BoardWorkflowDef {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  columns: BoardColumnDef[];
}

/** Ordre stable : sortOrder, puis libellé pour départager. */
export function sortColumns<T extends { sortOrder: number; label: string }>(
  columns: readonly T[]
): T[] {
  return [...columns].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.label.localeCompare(b.label, "fr");
  });
}

// ── Placement des cartes ─────────────────────────────────────────────────────

interface PlaceableTask {
  columnId: string | null;
  status: BoardColumnCategory;
}

/**
 * Range chaque tâche dans une colonne du flux affiché.
 *
 * Trois cas, dans l'ordre :
 *  1. La tâche pointe vers une colonne de CE flux → elle y va.
 *  2. Sinon (jamais placée, ou venue d'une autre équipe) → première colonne de
 *     même catégorie.
 *  3. Sinon → `orphans`. Cas réel : le flux n'a pas de colonne « Annulée » mais
 *     une tâche annulée traîne. On ne la fait jamais disparaître du tableau ;
 *     l'appelant l'affiche dans une colonne « Hors flux » d'où elle peut être
 *     redéposée.
 */
export function groupTasksByColumn<T extends PlaceableTask>(
  columns: readonly BoardColumnDef[],
  tasks: readonly T[]
): { byColumn: Record<string, T[]>; orphans: T[] } {
  const byColumn: Record<string, T[]> = {};
  for (const c of columns) byColumn[c.id] = [];

  const firstOfCategory = new Map<BoardColumnCategory, string>();
  for (const c of columns) {
    if (!firstOfCategory.has(c.category)) firstOfCategory.set(c.category, c.id);
  }

  const orphans: T[] = [];
  for (const t of tasks) {
    if (t.columnId && byColumn[t.columnId]) {
      byColumn[t.columnId].push(t);
      continue;
    }
    const fallback = firstOfCategory.get(t.status);
    if (fallback) byColumn[fallback].push(t);
    else orphans.push(t);
  }
  return { byColumn, orphans };
}

/**
 * La colonne équivalente dans un autre flux : même catégorie, première trouvée.
 * Utilisée quand une tâche change d'équipe, ou quand on la déplace depuis la
 * vue « toutes les équipes » — elle reste alors dans le flux de SON équipe au
 * lieu d'être arrachée vers celui d'une autre.
 */
export function equivalentColumn(
  columns: readonly BoardColumnDef[],
  category: BoardColumnCategory
): BoardColumnDef | null {
  return sortColumns(columns).find((c) => c.category === category) ?? null;
}

// ── Garde-fous ───────────────────────────────────────────────────────────────

/**
 * Un flux doit toujours conserver au moins une colonne « à faire » et une
 * colonne « terminée » : sans la première une tâche ne peut pas naître, sans la
 * seconde elle ne peut jamais être achevée et le sprint resterait à 0 %.
 */
export function canRemoveColumn(
  columns: readonly BoardColumnDef[],
  columnId: string
): { ok: true } | { ok: false; reason: string } {
  const target = columns.find((c) => c.id === columnId);
  if (!target) return { ok: false, reason: "Colonne introuvable" };
  const remaining = columns.filter((c) => c.id !== columnId);
  return checkRequiredCategories(remaining);
}

/** Même règle, appliquée à un jeu de colonnes après modification. */
export function checkRequiredCategories(
  columns: readonly { category: BoardColumnCategory }[]
): { ok: true } | { ok: false; reason: string } {
  if (columns.length === 0) {
    return { ok: false, reason: "Un flux doit garder au moins une colonne" };
  }
  if (!columns.some((c) => c.category === "TODO")) {
    return {
      ok: false,
      reason: "Le flux doit garder une colonne « À faire » — sinon aucune tâche ne peut démarrer",
    };
  }
  if (!columns.some((c) => c.category === "DONE")) {
    return {
      ok: false,
      reason: "Le flux doit garder une colonne « Terminée » — sinon le sprint ne peut jamais avancer",
    };
  }
  return { ok: true };
}

// ── Limite WIP ───────────────────────────────────────────────────────────────

export type WipState = "NONE" | "OK" | "AT" | "OVER";

/** État d'une colonne vis-à-vis de sa limite d'encours (0 / null = pas de limite). */
export function wipState(count: number, limit: number | null): WipState {
  if (!limit || limit <= 0) return "NONE";
  if (count > limit) return "OVER";
  if (count === limit) return "AT";
  return "OK";
}
