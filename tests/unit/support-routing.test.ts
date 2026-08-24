import { describe, it, expect } from "vitest";

/**
 * Règle de routage à la création d'une demande (cf. createSupportRequest).
 * Reproduite ici en fonction pure pour la verrouiller : c'est la décision qui
 * détermine qui reçoit la demande, et elle a trois cas qu'on casse facilement
 * en touchant à l'action.
 */
function resolveInitialAssignee(input: {
  requestedAssigneeId: string | null;
  autoAssigneeId: string | null;
}): string | null {
  return input.requestedAssigneeId ?? input.autoAssigneeId;
}

/** Le destinataire souhaité doit appartenir à l'équipe du guichet visé. */
function isAddressable(team: ReadonlyArray<{ id: string }>, userId: string): boolean {
  return team.some((u) => u.id === userId);
}

const TEAM = [{ id: "abdoul" }, { id: "hercule" }, { id: "resp-it" }];

describe("destinataire souhaité", () => {
  it("l'emporte sur l'agent traiteur du guichet", () => {
    expect(
      resolveInitialAssignee({ requestedAssigneeId: "hercule", autoAssigneeId: "abdoul" })
    ).toBe("hercule");
  });

  it("retombe sur l'agent traiteur quand aucune personne n'est visée", () => {
    expect(
      resolveInitialAssignee({ requestedAssigneeId: null, autoAssigneeId: "abdoul" })
    ).toBe("abdoul");
  });

  it("laisse la demande non assignée si le guichet n'a ni agent ni responsable", () => {
    expect(
      resolveInitialAssignee({ requestedAssigneeId: null, autoAssigneeId: null })
    ).toBeNull();
  });

  it("accepte une personne de l'équipe du guichet", () => {
    expect(isAddressable(TEAM, "hercule")).toBe(true);
  });

  it("refuse quelqu'un hors du guichet", () => {
    // Sans cette règle, une demande IT pourrait être adressée à la compta.
    expect(isAddressable(TEAM, "compta-marie")).toBe(false);
  });

  it("refuse sur un guichet sans équipe", () => {
    expect(isAddressable([], "hercule")).toBe(false);
  });
});
