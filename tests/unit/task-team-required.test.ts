import { describe, it, expect } from "vitest";
import {
  createSprintTaskSchema,
  updateSprintTaskSchema,
  createRecurringTaskSchema,
  updateRecurringTaskSchema,
} from "@/lib/validations/sprints";

// L'équipe (produit OU département) est le seul rattachement que lisent le
// filtre d'équipe, le flux de colonnes et la pastille de la carte. Sans elle
// une tâche n'apparaît nulle part — c'est ce qui rendait invisibles les treize
// tâches de P6 « Carte Virtuelle ».

const BASE = { title: "Vérifier les notifications tchat" };

describe("création d'une tâche", () => {
  it("refuse une tâche sans équipe", () => {
    const r = createSprintTaskSchema.safeParse(BASE);
    expect(r.success).toBe(false);
  });

  it("refuse une tâche dont l'équipe est explicitement vide", () => {
    const r = createSprintTaskSchema.safeParse({
      ...BASE,
      productId: null,
      departmentId: null,
    });
    expect(r.success).toBe(false);
  });

  it("refuse même quand un KR est lié — le KR ne remplace pas l'équipe", () => {
    const r = createSprintTaskSchema.safeParse({ ...BASE, krId: "kr1" });
    expect(r.success).toBe(false);
  });

  it("accepte un produit", () => {
    const r = createSprintTaskSchema.safeParse({ ...BASE, productId: "p6" });
    expect(r.success).toBe(true);
  });

  it("accepte un département", () => {
    const r = createSprintTaskSchema.safeParse({ ...BASE, departmentId: "d1" });
    expect(r.success).toBe(true);
  });
});

describe("modification d'une tâche", () => {
  it("laisse passer un déplacement de carte, qui ne touche pas à l'équipe", () => {
    // Le glisser-déposer n'envoie que la colonne : il ne doit pas se heurter à
    // une règle qui ne le concerne pas, y compris sur les tâches héritées sans
    // équipe qui restent en base.
    const r = updateSprintTaskSchema.safeParse({ columnId: "col1" });
    expect(r.success).toBe(true);
  });

  it("laisse passer un passage au backlog", () => {
    expect(updateSprintTaskSchema.safeParse({ sprintId: null }).success).toBe(true);
  });

  it("refuse de retirer son équipe à une tâche", () => {
    const r = updateSprintTaskSchema.safeParse({
      productId: null,
      departmentId: null,
    });
    expect(r.success).toBe(false);
  });

  it("accepte un changement d'équipe", () => {
    const r = updateSprintTaskSchema.safeParse({
      productId: "p6",
      departmentId: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("modèles récurrents", () => {
  const CADENCE = { title: "Point hebdomadaire", frequency: "WEEKLY", weekday: 1 };

  it("refuse un modèle sans équipe — il engendrerait des tâches sans équipe", () => {
    expect(createRecurringTaskSchema.safeParse(CADENCE).success).toBe(false);
  });

  it("accepte un modèle rattaché à un produit", () => {
    const r = createRecurringTaskSchema.safeParse({ ...CADENCE, productId: "p6" });
    expect(r.success).toBe(true);
  });

  it("refuse de vider l'équipe d'un modèle, laisse passer une simple pause", () => {
    expect(
      updateRecurringTaskSchema.safeParse({ productId: null, departmentId: null })
        .success
    ).toBe(false);
    expect(updateRecurringTaskSchema.safeParse({ isActive: false }).success).toBe(true);
  });
});
