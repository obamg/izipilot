import { describe, it, expect } from "vitest";
import { computeGrantRoute, computeReductionRoute, classifyRequest, InvalidRequestError } from "@/lib/access/routing";

describe("computeGrantRoute", () => {
  it("titulaire COO demandant son propre accès : aucune approbation", () => {
    const result = computeGrantRoute([{ role: "COO", actsAsPrimary: true }], false);
    expect(result).toEqual({ stages: [], exceptionReason: "COO_SELF_REQUEST" });
  });

  it("titulaire CISO demandant son propre accès : COO uniquement, même pour un niveau non-admin", () => {
    const result = computeGrantRoute([{ role: "CISO", actsAsPrimary: true }], false);
    expect(result).toEqual({ stages: ["COO"], exceptionReason: null });
  });

  it("titulaire chef de département demandant son propre accès, niveau non-admin : CISO seul", () => {
    const result = computeGrantRoute([{ role: "DEPARTMENT_HEAD", actsAsPrimary: true }], false);
    expect(result).toEqual({ stages: ["CISO"], exceptionReason: null });
  });

  it("titulaire chef de département demandant son propre accès, niveau admin : CISO puis COO", () => {
    const result = computeGrantRoute([{ role: "DEPARTMENT_HEAD", actsAsPrimary: true }], true);
    expect(result).toEqual({ stages: ["CISO", "COO"], exceptionReason: null });
  });

  it("autre employé, niveau non-admin : chef de département puis CISO", () => {
    const result = computeGrantRoute([], false);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO"], exceptionReason: null });
  });

  it("autre employé, niveau admin : chef de département, CISO, puis COO", () => {
    const result = computeGrantRoute([], true);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO", "COO"], exceptionReason: null });
  });

  it("un SUPPLÉANT agissant comme COO n'hérite jamais de l'exemption personnelle", () => {
    const result = computeGrantRoute([{ role: "COO", actsAsPrimary: false }], false);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO"], exceptionReason: null });
  });

  it("un SUPPLÉANT agissant comme CISO n'hérite jamais du saut direct à COO", () => {
    const result = computeGrantRoute([{ role: "CISO", actsAsPrimary: false }], false);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO"], exceptionReason: null });
  });
});

describe("computeReductionRoute", () => {
  it("chef de département initie : CISO", () => {
    expect(computeReductionRoute("DEPARTMENT_HEAD", false)).toEqual(["CISO"]);
  });

  it("IT Access Operator initie : CISO", () => {
    expect(computeReductionRoute("IT_ACCESS_OPERATOR", false)).toEqual(["CISO"]);
  });

  it("CISO initie : COO (jamais auto-approbation)", () => {
    expect(computeReductionRoute("CISO", false)).toEqual(["COO"]);
  });

  it("bénéficiaire est le CISO titulaire, quel que soit l'initiateur : COO", () => {
    expect(computeReductionRoute("DEPARTMENT_HEAD", true)).toEqual(["COO"]);
  });

  it("réduction vers un niveau administrateur : toujours CISO seul (jamais COO ajouté automatiquement)", () => {
    // computeReductionRoute ne prend jamais targetLevelIsAdmin en paramètre : l'appelant
    // ne doit JAMAIS le lui passer ni ajouter COO lui-même pour ce motif — seule une
    // escalade CISO explicite (Tâche 5) ajoute COO à une réduction.
    expect(computeReductionRoute("DEPARTMENT_HEAD", false)).toEqual(["CISO"]);
  });
});

describe("classifyRequest", () => {
  it("aucune affectation actuelle : GRANT", () => {
    expect(classifyRequest(null, "level-1", 10, null)).toBe("GRANT");
  });

  it("affectation REVOKED existante : traitée comme aucune affectation, GRANT", () => {
    const current = { levelId: "level-1", status: "REVOKED" as const, priority: 10, periodEnd: null };
    expect(classifyRequest(current, "level-2", 20, null)).toBe("GRANT");
  });

  it("cible null avec affectation active existante : REVOKE", () => {
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd: null };
    expect(classifyRequest(current, null, null, null)).toBe("REVOKE");
  });

  it("cible null sans affectation existante : rejeté", () => {
    expect(() => classifyRequest(null, null, null, null)).toThrow(InvalidRequestError);
  });

  it("même niveau, période différente : RENEW", () => {
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd: null };
    const targetEnd = new Date("2027-01-01");
    expect(classifyRequest(current, "level-1", 10, targetEnd)).toBe("RENEW");
  });

  it("même niveau, même période : doublon invalide, rejeté", () => {
    const periodEnd = new Date("2027-01-01");
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd };
    expect(() => classifyRequest(current, "level-1", 10, new Date("2027-01-01"))).toThrow(InvalidRequestError);
  });

  it("priorité cible supérieure : UPGRADE", () => {
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd: null };
    expect(classifyRequest(current, "level-2", 20, null)).toBe("UPGRADE");
  });

  it("priorité cible inférieure : REDUCE", () => {
    const current = { levelId: "level-2", status: "ACTIVE" as const, priority: 20, periodEnd: null };
    expect(classifyRequest(current, "level-1", 10, null)).toBe("REDUCE");
  });
});
