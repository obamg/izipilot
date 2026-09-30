import { describe, it, expect } from "vitest";
import { cancelActionFor, requestStateLabel, type RequestStateLabelInput } from "@/lib/access/request-labels";

function input(over: Partial<RequestStateLabelInput>): RequestStateLabelInput {
  return { state: "PENDING_APPROVAL", periodStart: "2026-10-05T10:00:00.000Z", completedAt: null, taskReason: null, cancelRequested: false, ...over };
}

describe("requestStateLabel", () => {
  it("libellés des états d'exécution (spec 3b §8)", () => {
    expect(requestStateLabel(input({ state: "AUTHORIZED_WAITING_START" }))).toBe("Autorisée — début le 05/10/2026");
    expect(requestStateLabel(input({ state: "READY_FOR_FULFILMENT" }))).toBe("Prête — en attente du propriétaire");
    expect(requestStateLabel(input({ state: "IN_PROGRESS" }))).toBe("En cours d'exécution");
    expect(requestStateLabel(input({ state: "BLOCKED", taskReason: "Compte verrouillé" }))).toBe("Bloquée : Compte verrouillé");
    expect(requestStateLabel(input({ state: "BLOCKED" }))).toBe("Bloquée : motif non précisé");
    expect(requestStateLabel(input({ state: "COMPLETED", completedAt: "2026-10-07T09:00:00.000Z" }))).toBe("Exécutée le 07/10/2026");
    expect(requestStateLabel(input({ state: "CANCELLED" }))).toBe("Annulée");
  });

  it("signale une annulation demandée pendant l'exécution", () => {
    expect(requestStateLabel(input({ state: "IN_PROGRESS", cancelRequested: true }))).toBe("En cours d'exécution · annulation demandée");
  });

  it("états d'approbation et état inconnu", () => {
    expect(requestStateLabel(input({ state: "PENDING_APPROVAL" }))).toBe("En attente d'approbation");
    expect(requestStateLabel(input({ state: "REVISION_REQUIRED" }))).toBe("À réviser");
    expect(requestStateLabel(input({ state: "FUTUR_ETAT" }))).toBe("FUTUR_ETAT");
  });
});

describe("cancelActionFor (D-19)", () => {
  it("annulation avant réclamation, demande d'annulation après, rien une fois terminée ou déjà demandée", () => {
    expect(cancelActionFor("READY_FOR_FULFILMENT", false)).toBe("CANCEL");
    expect(cancelActionFor("PENDING_APPROVAL", false)).toBe("CANCEL");
    expect(cancelActionFor("IN_PROGRESS", false)).toBe("REQUEST_CANCEL");
    expect(cancelActionFor("BLOCKED", false)).toBe("REQUEST_CANCEL");
    expect(cancelActionFor("BLOCKED", true)).toBeNull();
    expect(cancelActionFor("COMPLETED", false)).toBeNull();
    expect(cancelActionFor("CANCELLED", false)).toBeNull();
    expect(cancelActionFor("REJECTED", false)).toBeNull();
  });
});
