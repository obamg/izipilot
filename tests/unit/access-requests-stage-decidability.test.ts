import { describe, it, expect } from "vitest";
import { isStageDecidable } from "@/lib/access/stage-decidability";

describe("isStageDecidable", () => {
  const initiatorId = "user-initiator";
  const beneficiaryId = "user-beneficiary";
  const actorId = "user-actor";

  it("décidable quand aucune étape antérieure n'est en attente et l'acteur est indépendant", () => {
    const stage = { id: "stage-2", sequence: 2 };
    const allStages = [
      { id: "stage-1", sequence: 1, decision: "APPROVE", actorId: "someone-else" },
      { id: "stage-2", sequence: 2, decision: null, actorId: null },
    ];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, actorId);
    expect(result).toEqual({ decidable: true });
  });

  it("ordre des étapes : refuse tant qu'une étape de séquence inférieure n'est pas APPROVE", () => {
    const stage = { id: "stage-2", sequence: 2 };
    const allStages = [
      { id: "stage-1", sequence: 1, decision: null, actorId: null },
      { id: "stage-2", sequence: 2, decision: null, actorId: null },
    ];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, actorId);
    expect(result).toEqual({ decidable: false, reason: "SEQUENCE_NOT_REACHED" });
  });

  it("ordre des étapes : une étape antérieure CLARIFY (decision null) bloque aussi", () => {
    const stage = { id: "stage-2", sequence: 2 };
    const allStages = [
      { id: "stage-1", sequence: 1, decision: null, actorId: "dept-head" }, // CLARIFY laisse decision null
      { id: "stage-2", sequence: 2, decision: null, actorId: null },
    ];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, actorId);
    expect(result).toEqual({ decidable: false, reason: "SEQUENCE_NOT_REACHED" });
  });

  it("indépendance : l'initiateur ne peut pas décider sa propre demande", () => {
    const stage = { id: "stage-1", sequence: 1 };
    const allStages = [{ id: "stage-1", sequence: 1, decision: null, actorId: null }];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, initiatorId);
    expect(result).toEqual({ decidable: false, reason: "ACTOR_IS_INITIATOR" });
  });

  it("indépendance : le bénéficiaire ne peut pas décider sa propre demande", () => {
    const stage = { id: "stage-1", sequence: 1 };
    const allStages = [{ id: "stage-1", sequence: 1, decision: null, actorId: null }];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, beneficiaryId);
    expect(result).toEqual({ decidable: false, reason: "ACTOR_IS_BENEFICIARY" });
  });

  it("indépendance : un acteur ayant déjà décidé une AUTRE étape de la même version est refusé", () => {
    const stage = { id: "stage-2", sequence: 2 };
    const allStages = [
      { id: "stage-1", sequence: 1, decision: "APPROVE", actorId },
      { id: "stage-2", sequence: 2, decision: null, actorId: null },
    ];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, actorId);
    expect(result).toEqual({ decidable: false, reason: "ACTOR_ALREADY_DECIDED_ANOTHER_STAGE" });
  });

  it("indépendance : l'acteur déjà assigné à CETTE MÊME étape (id identique) n'est pas considéré comme une double signature", () => {
    const stage = { id: "stage-1", sequence: 1 };
    const allStages = [{ id: "stage-1", sequence: 1, decision: null, actorId }];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, actorId);
    expect(result).toEqual({ decidable: true });
  });

  it("priorité des motifs : l'ordre des étapes est vérifié avant l'indépendance", () => {
    // L'acteur est aussi l'initiateur, MAIS une étape antérieure n'est pas
    // encore approuvée — le motif remonté doit rester SEQUENCE_NOT_REACHED,
    // pas ACTOR_IS_INITIATOR (même ordre de contrôle que `decideStage`).
    const stage = { id: "stage-2", sequence: 2 };
    const allStages = [
      { id: "stage-1", sequence: 1, decision: null, actorId: null },
      { id: "stage-2", sequence: 2, decision: null, actorId: null },
    ];
    const result = isStageDecidable(stage, allStages, initiatorId, beneficiaryId, initiatorId);
    expect(result).toEqual({ decidable: false, reason: "SEQUENCE_NOT_REACHED" });
  });
});
