import { describe, it, expect } from "vitest";
import {
  CATEGORY_ORDER,
  DEFAULT_COLUMNS,
  canRemoveColumn,
  checkRequiredCategories,
  equivalentColumn,
  groupTasksByColumn,
  sortColumns,
  wipState,
  type BoardColumnDef,
} from "@/lib/board-column";

function col(
  id: string,
  category: BoardColumnDef["category"],
  sortOrder = 0,
  wipLimit: number | null = null
): BoardColumnDef {
  return { id, label: id, color: "#000", category, sortOrder, wipLimit };
}

// Un flux IT typique : deux colonnes « en cours » distinctes, pas de colonne
// « annulée » — exactement le genre de flux que l'ancien enum interdisait.
const IT_FLOW: BoardColumnDef[] = [
  col("todo", "TODO", 0),
  col("analyse", "IN_PROGRESS", 1),
  col("dev", "IN_PROGRESS", 2),
  col("revue", "IN_PROGRESS", 3),
  col("done", "DONE", 4),
];

describe("DEFAULT_COLUMNS", () => {
  it("reproduit les cinq colonnes historiques, dans l'ordre", () => {
    expect(DEFAULT_COLUMNS.map((c) => c.category)).toEqual(CATEGORY_ORDER);
  });
});

describe("groupTasksByColumn", () => {
  it("range une tâche dans sa colonne quand elle appartient au flux affiché", () => {
    const { byColumn, orphans } = groupTasksByColumn(IT_FLOW, [
      { columnId: "revue", status: "IN_PROGRESS" },
    ]);
    expect(byColumn.revue).toHaveLength(1);
    expect(orphans).toHaveLength(0);
  });

  it("retombe sur la première colonne de la catégorie pour une tâche jamais placée", () => {
    const { byColumn } = groupTasksByColumn(IT_FLOW, [
      { columnId: null, status: "IN_PROGRESS" },
    ]);
    // "analyse" est la première IN_PROGRESS par sortOrder, pas "dev" ni "revue".
    expect(byColumn.analyse).toHaveLength(1);
    expect(byColumn.dev).toHaveLength(0);
  });

  it("retombe aussi pour une tâche venue du flux d'une autre équipe", () => {
    const { byColumn, orphans } = groupTasksByColumn(IT_FLOW, [
      { columnId: "colonne-d-une-autre-equipe", status: "DONE" },
    ]);
    expect(byColumn.done).toHaveLength(1);
    expect(orphans).toHaveLength(0);
  });

  it("ne perd jamais une tâche dont la catégorie n'a pas de colonne", () => {
    // Le flux IT n'a pas de colonne « Annulée » : la tâche doit ressortir en
    // orphelin, surtout pas disparaître du tableau.
    const { byColumn, orphans } = groupTasksByColumn(IT_FLOW, [
      { columnId: null, status: "CANCELLED" },
    ]);
    expect(orphans).toHaveLength(1);
    expect(Object.values(byColumn).flat()).toHaveLength(0);
  });

  it("initialise toutes les colonnes, même vides", () => {
    const { byColumn } = groupTasksByColumn(IT_FLOW, []);
    expect(Object.keys(byColumn).sort()).toEqual(
      ["analyse", "dev", "done", "revue", "todo"].sort()
    );
  });
});

describe("equivalentColumn", () => {
  it("rend la première colonne de la catégorie visée", () => {
    expect(equivalentColumn(IT_FLOW, "IN_PROGRESS")?.id).toBe("analyse");
  });

  it("rend null quand le flux n'a pas cette catégorie", () => {
    expect(equivalentColumn(IT_FLOW, "CANCELLED")).toBeNull();
  });

  it("respecte sortOrder plutôt que l'ordre du tableau reçu", () => {
    const shuffled = [col("b", "TODO", 5), col("a", "TODO", 1)];
    expect(equivalentColumn(shuffled, "TODO")?.id).toBe("a");
  });
});

describe("checkRequiredCategories", () => {
  it("accepte un flux qui a une entrée et une sortie", () => {
    expect(checkRequiredCategories(IT_FLOW).ok).toBe(true);
  });

  it("refuse un flux sans colonne « à faire »", () => {
    const r = checkRequiredCategories([col("a", "IN_PROGRESS"), col("b", "DONE")]);
    expect(r.ok).toBe(false);
  });

  it("refuse un flux sans colonne « terminée »", () => {
    // Sans sortie, le sprint resterait à 0 % quoi qu'il arrive.
    const r = checkRequiredCategories([col("a", "TODO"), col("b", "IN_PROGRESS")]);
    expect(r.ok).toBe(false);
  });

  it("refuse un flux vide", () => {
    expect(checkRequiredCategories([]).ok).toBe(false);
  });
});

describe("canRemoveColumn", () => {
  it("autorise la suppression d'une colonne intermédiaire", () => {
    expect(canRemoveColumn(IT_FLOW, "revue").ok).toBe(true);
  });

  it("refuse de supprimer la dernière colonne « terminée »", () => {
    expect(canRemoveColumn(IT_FLOW, "done").ok).toBe(false);
  });

  it("refuse de supprimer la dernière colonne « à faire »", () => {
    expect(canRemoveColumn(IT_FLOW, "todo").ok).toBe(false);
  });

  it("autorise de supprimer une colonne « en cours » parmi plusieurs", () => {
    expect(canRemoveColumn(IT_FLOW, "dev").ok).toBe(true);
  });

  it("refuse une colonne inconnue", () => {
    expect(canRemoveColumn(IT_FLOW, "inexistante").ok).toBe(false);
  });
});

describe("sortColumns", () => {
  it("trie par sortOrder puis libellé", () => {
    const cols = [
      { sortOrder: 1, label: "b" },
      { sortOrder: 0, label: "z" },
      { sortOrder: 1, label: "a" },
    ];
    expect(sortColumns(cols).map((c) => c.label)).toEqual(["z", "a", "b"]);
  });

  it("ne mute pas le tableau reçu", () => {
    const cols = [
      { sortOrder: 2, label: "b" },
      { sortOrder: 1, label: "a" },
    ];
    sortColumns(cols);
    expect(cols[0].label).toBe("b");
  });
});

describe("wipState", () => {
  it("ne signale rien sans limite", () => {
    expect(wipState(99, null)).toBe("NONE");
    expect(wipState(99, 0)).toBe("NONE");
  });

  it("distingue sous, à, et au-dessus de la limite", () => {
    expect(wipState(2, 3)).toBe("OK");
    expect(wipState(3, 3)).toBe("AT");
    expect(wipState(4, 3)).toBe("OVER");
  });
});
