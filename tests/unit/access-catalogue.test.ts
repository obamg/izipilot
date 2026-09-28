import { describe, it, expect } from "vitest";
import {
  isReadyForRequests,
  catalogueChangeRequiresVersionBump,
  nextCatalogueVersion,
} from "@/lib/access/catalogue";

describe("isReadyForRequests", () => {
  const readyLevel = { enabled: true, archivedAt: null, priority: 1, isAdmin: false };

  it("prêt : propriétaire renseigné et au moins un niveau sélectionnable complet", () => {
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [readyLevel])).toBe(true);
  });

  it("pas prêt sans propriétaire", () => {
    expect(isReadyForRequests({ ownerId: null, archivedAt: null }, [readyLevel])).toBe(false);
  });

  it("pas prêt si l'actif est archivé", () => {
    expect(
      isReadyForRequests({ ownerId: "u1", archivedAt: new Date() }, [readyLevel])
    ).toBe(false);
  });

  it("pas prêt sans aucun niveau sélectionnable", () => {
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [])).toBe(false);
  });

  it("pas prêt si un niveau sélectionnable a une priorité ou un isAdmin manquant (brouillon d'import)", () => {
    const draft = { enabled: true, archivedAt: null, priority: null, isAdmin: null };
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [draft])).toBe(false);
  });

  it("ignore les niveaux désactivés ou archivés dans le calcul", () => {
    const disabled = { enabled: false, archivedAt: null, priority: null, isAdmin: null };
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [readyLevel, disabled])).toBe(
      true
    );
  });
});

describe("catalogueChangeRequiresVersionBump", () => {
  it("une priorité changée impose une montée de version", () => {
    expect(catalogueChangeRequiresVersionBump(["priority"])).toBe(true);
  });

  it("un isAdmin changé impose une montée de version", () => {
    expect(catalogueChangeRequiresVersionBump(["isAdmin"])).toBe(true);
  });

  it("aucun changement pertinent ne l'impose pas", () => {
    expect(catalogueChangeRequiresVersionBump([])).toBe(false);
  });
});

describe("nextCatalogueVersion", () => {
  it("incrémente simplement", () => {
    expect(nextCatalogueVersion(1)).toBe(2);
    expect(nextCatalogueVersion(7)).toBe(8);
  });
});
