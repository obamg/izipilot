import { describe, it, expect } from "vitest";
import {
  blockTaskSchema,
  claimBatchSchema,
  completeBatchSchema,
  completeTaskSchema,
  handoverTaskSchema,
  reconcileTaskSchema,
  taskListQuerySchema,
  taskRevisionSchema,
} from "@/lib/validations/access";

const nowIso = () => new Date().toISOString();

describe("completeTaskSchema", () => {
  it("accepte une date passée avec une référence, convertit en Date, partialRemovalOnly=false par défaut", () => {
    const r = completeTaskSchema.safeParse({ completedAt: nowIso(), reference: " TICKET-42 ", expectedRevision: 2 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.completedAt).toBeInstanceOf(Date);
    expect(r.data.reference).toBe("TICKET-42");
    expect(r.data.note).toBeNull();
    expect(r.data.partialRemovalOnly).toBe(false);
  });

  it("refuse ni référence ni note, y compris des espaces seuls (Review Focus #5)", () => {
    const r = completeTaskSchema.safeParse({ completedAt: nowIso(), reference: "   ", note: "  ", expectedRevision: 1 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0].message).toBe("Une référence ou une note d'exécution est obligatoire");
  });

  it("refuse une date à plus de 5 minutes dans le futur (Review Focus #5)", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(completeTaskSchema.safeParse({ completedAt: future, note: "fait", expectedRevision: 1 }).success).toBe(false);
  });

  it("refuse une date non ISO, une révision < 1, une méthode inconnue, des textes trop longs", () => {
    expect(completeTaskSchema.safeParse({ completedAt: "hier", note: "x", expectedRevision: 1 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), note: "x", expectedRevision: 0 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), note: "x", method: "AUTRE", expectedRevision: 1 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), reference: "r".repeat(201), expectedRevision: 1 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), note: "n".repeat(2001), expectedRevision: 1 }).success).toBe(false);
  });
});

describe("motifs (passation, blocage, réconciliation)", () => {
  it("motif de 3 à 1000 caractères après trim", () => {
    expect(handoverTaskSchema.safeParse({ toUserId: "u", reason: "  ab ", expectedRevision: 1 }).success).toBe(false);
    expect(handoverTaskSchema.safeParse({ toUserId: "u", reason: "congés", expectedRevision: 1 }).success).toBe(true);
    expect(blockTaskSchema.safeParse({ reason: "x".repeat(1001), expectedRevision: 1 }).success).toBe(false);
    expect(reconcileTaskSchema.safeParse({ reason: "rien fait", expectedRevision: 1 }).success).toBe(true);
  });
  it("les faits d'un blocage sont optionnels ; vide → null", () => {
    const r = blockTaskSchema.safeParse({ reason: "compte verrouillé", facts: "", expectedRevision: 1 });
    expect(r.success && r.data.facts).toBeNull();
  });
  it("expectedRevision obligatoire", () => {
    expect(taskRevisionSchema.safeParse({}).success).toBe(false);
  });
});

describe("lots", () => {
  it("1 à 100 éléments", () => {
    expect(claimBatchSchema.safeParse({ items: [] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({ taskId: `t${i}`, expectedRevision: 1 }));
    expect(claimBatchSchema.safeParse({ items: many }).success).toBe(false);
    expect(claimBatchSchema.safeParse({ items: many.slice(0, 100) }).success).toBe(true);
  });
  it("chaque élément de confirmation porte sa propre preuve", () => {
    const ok = { taskId: "t1", completedAt: nowIso(), reference: "R1", expectedRevision: 2 };
    const missing = { taskId: "t2", completedAt: nowIso(), expectedRevision: 2 };
    expect(completeBatchSchema.safeParse({ items: [ok] }).success).toBe(true);
    expect(completeBatchSchema.safeParse({ items: [ok, missing] }).success).toBe(false);
  });
});

describe("taskListQuerySchema", () => {
  it("valeurs par défaut et assetId vide = pas de filtre", () => {
    const r = taskListQuerySchema.parse({ assetId: "" });
    expect(r).toEqual({ view: "mine", state: "open", assetId: undefined, page: 1, pageSize: 25 });
  });
  it("refuse une vue inconnue", () => {
    expect(taskListQuerySchema.safeParse({ view: "tout" }).success).toBe(false);
  });
});
