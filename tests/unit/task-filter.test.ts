import { describe, it, expect } from "vitest";
import {
  EMPTY_SCOPE,
  filterTasks,
  isFilterActive,
  isScopeActive,
  matchesScope,
  matchesSearch,
  type FilterableTask,
  type TaskScope,
} from "@/lib/task-filter";

function task(over: Partial<FilterableTask> = {}): FilterableTask {
  return {
    title: "Corriger le webhook",
    description: null,
    krTitle: null,
    assigneeId: "u1",
    assigneeName: "Awa",
    priority: "MEDIUM",
    productId: null,
    departmentId: "d2",
    ...over,
  };
}

function scope(over: Partial<TaskScope> = {}): TaskScope {
  return { ...EMPTY_SCOPE, ...over };
}

describe("isScopeActive / isFilterActive", () => {
  it("un scope vide n'est pas actif", () => {
    expect(isScopeActive(EMPTY_SCOPE)).toBe(false);
    expect(isFilterActive(EMPTY_SCOPE)).toBe(false);
  });

  it("chaque filtre de portée suffit à activer", () => {
    expect(isScopeActive(scope({ team: "D:d2" }))).toBe(true);
    expect(isScopeActive(scope({ assignee: "u1" }))).toBe(true);
    expect(isScopeActive(scope({ priority: "HIGH" }))).toBe(true);
  });

  it("la recherche n'entre pas dans la portée mais bien dans le filtre global", () => {
    // Le burndown se recalcule sur la portée seule : une recherche texte ne
    // doit pas déclencher son recalcul.
    const s = scope({ search: "webhook" });
    expect(isScopeActive(s)).toBe(false);
    expect(isFilterActive(s)).toBe(true);
  });

  it("une recherche d'espaces seuls n'active rien", () => {
    expect(isFilterActive(scope({ search: "   " }))).toBe(false);
  });
});

describe("matchesScope — équipe", () => {
  it("garde la tâche du produit visé", () => {
    const t = task({ productId: "p1", departmentId: null });
    expect(matchesScope(t, scope({ team: "P:p1" }))).toBe(true);
    expect(matchesScope(t, scope({ team: "P:p2" }))).toBe(false);
  });

  it("garde la tâche du département visé", () => {
    const t = task({ departmentId: "d2" });
    expect(matchesScope(t, scope({ team: "D:d2" }))).toBe(true);
    expect(matchesScope(t, scope({ team: "D:d3" }))).toBe(false);
  });

  it("un filtre produit écarte une tâche de département", () => {
    expect(matchesScope(task({ productId: null }), scope({ team: "P:p1" }))).toBe(false);
  });

  it("ALL laisse passer une tâche sans équipe", () => {
    const t = task({ productId: null, departmentId: null });
    expect(matchesScope(t, EMPTY_SCOPE)).toBe(true);
  });
});

describe("matchesScope — personne", () => {
  it("UNASSIGNED ne garde que les tâches sans assigné", () => {
    expect(matchesScope(task({ assigneeId: null }), scope({ assignee: "UNASSIGNED" }))).toBe(true);
    expect(matchesScope(task({ assigneeId: "u1" }), scope({ assignee: "UNASSIGNED" }))).toBe(false);
  });

  it("un userId ne garde que ses tâches", () => {
    expect(matchesScope(task({ assigneeId: "u1" }), scope({ assignee: "u1" }))).toBe(true);
    expect(matchesScope(task({ assigneeId: "u2" }), scope({ assignee: "u1" }))).toBe(false);
    // Une tâche non assignée ne doit jamais tomber dans "Mes tâches".
    expect(matchesScope(task({ assigneeId: null }), scope({ assignee: "u1" }))).toBe(false);
  });
});

describe("matchesScope — priorité et cumul", () => {
  it("filtre sur la priorité exacte", () => {
    expect(matchesScope(task({ priority: "URGENT" }), scope({ priority: "URGENT" }))).toBe(true);
    expect(matchesScope(task({ priority: "LOW" }), scope({ priority: "URGENT" }))).toBe(false);
  });

  it("les filtres se cumulent en ET", () => {
    const t = task({ departmentId: "d2", assigneeId: "u1", priority: "HIGH" });
    const all = scope({ team: "D:d2", assignee: "u1", priority: "HIGH" });
    expect(matchesScope(t, all)).toBe(true);
    expect(matchesScope(t, { ...all, priority: "LOW" })).toBe(false);
  });
});

describe("matchesSearch", () => {
  const t = task({
    title: "Corriger le webhook",
    description: "Retry exponentiel",
    krTitle: "Taux de succès des paiements",
    assigneeName: "Awa",
  });

  it("une recherche vide laisse tout passer", () => {
    expect(matchesSearch(t, "")).toBe(true);
    expect(matchesSearch(t, "   ")).toBe(true);
  });

  it("cherche dans le titre, la description, le KR et la personne", () => {
    expect(matchesSearch(t, "webhook")).toBe(true);
    expect(matchesSearch(t, "exponentiel")).toBe(true);
    expect(matchesSearch(t, "paiements")).toBe(true);
    expect(matchesSearch(t, "Awa")).toBe(true);
  });

  it("ignore la casse et les espaces autour", () => {
    expect(matchesSearch(t, "  WEBHOOK ")).toBe(true);
  });

  it("écarte ce qui ne correspond pas", () => {
    expect(matchesSearch(t, "facture")).toBe(false);
  });

  it("tolère les champs nuls", () => {
    const bare = task({ description: null, krTitle: null, assigneeName: null });
    expect(matchesSearch(bare, "webhook")).toBe(true);
    expect(matchesSearch(bare, "null")).toBe(false);
  });
});

describe("filterTasks", () => {
  const list = [
    task({ title: "Alpha", departmentId: "d2", assigneeId: "u1", priority: "HIGH" }),
    task({ title: "Bravo", departmentId: "d3", assigneeId: "u1", priority: "HIGH" }),
    task({ title: "Charlie", departmentId: "d2", assigneeId: null, priority: "LOW" }),
  ];

  it("sans filtre, rend la liste entière", () => {
    expect(filterTasks(list, EMPTY_SCOPE)).toHaveLength(3);
  });

  it("croise portée et recherche", () => {
    // "Bravo" correspond à la recherche mais pas à l'équipe : les deux doivent
    // tenir ensemble, pas l'une OU l'autre.
    const got = filterTasks(list, scope({ team: "D:d2", search: "a" }));
    expect(got.map((t) => t.title)).toEqual(["Alpha", "Charlie"]);
    expect(filterTasks(list, scope({ team: "D:d2", search: "bravo" }))).toEqual([]);
  });

  it("peut ne rien rendre", () => {
    expect(filterTasks(list, scope({ team: "P:p9" }))).toEqual([]);
  });

  it("préserve l'ordre d'entrée", () => {
    const got = filterTasks(list, scope({ team: "D:d2" }));
    expect(got.map((t) => t.title)).toEqual(["Alpha", "Charlie"]);
  });

  it("ne mute pas la liste source", () => {
    const before = [...list];
    filterTasks(list, scope({ team: "D:d2" }));
    expect(list).toEqual(before);
  });
});
