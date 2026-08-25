import { describe, it, expect } from "vitest";
import {
  canAssignTeam,
  canCreateWorkflow,
  canDeleteWorkflow,
  canEditWorkflow,
  canViewWorkflows,
  hasFullAccess,
  readOnlyReason,
  type WorkflowViewer,
} from "@/lib/workflow-access";

const CEO: WorkflowViewer = { id: "ceo", role: "CEO", ownedTeamKeys: [] };
const MGMT: WorkflowViewer = { id: "mgmt", role: "MANAGEMENT", ownedTeamKeys: [] };
// Deux PO, chacun sur son produit — le cas qui motive toute la règle.
const PO_A: WorkflowViewer = { id: "po-a", role: "PO", ownedTeamKeys: ["P:p1"] };
const PO_B: WorkflowViewer = { id: "po-b", role: "PO", ownedTeamKeys: ["P:p2"] };
const CONTRIB: WorkflowViewer = { id: "c", role: "CONTRIBUTOR", ownedTeamKeys: [] };
const VIEWER: WorkflowViewer = { id: "v", role: "VIEWER", ownedTeamKeys: [] };

const DEFAULT_WF = { isDefault: true, createdById: null, teamKeys: [] };

describe("accès à l'écran", () => {
  it("est ouvert au CEO, au management et aux PO", () => {
    expect(canViewWorkflows("CEO")).toBe(true);
    expect(canViewWorkflows("MANAGEMENT")).toBe(true);
    expect(canViewWorkflows("PO")).toBe(true);
  });

  it("est fermé aux contributeurs et aux viewers", () => {
    expect(canViewWorkflows("CONTRIBUTOR")).toBe(false);
    expect(canViewWorkflows("VIEWER")).toBe(false);
  });

  it("réserve l'accès total au CEO et au management", () => {
    expect(hasFullAccess("CEO")).toBe(true);
    expect(hasFullAccess("MANAGEMENT")).toBe(true);
    expect(hasFullAccess("PO")).toBe(false);
  });
});

describe("flux par défaut", () => {
  it("est éditable par le CEO et le management", () => {
    expect(canEditWorkflow(CEO, DEFAULT_WF)).toBe(true);
    expect(canEditWorkflow(MGMT, DEFAULT_WF)).toBe(true);
  });

  it("est verrouillé pour un PO — il s'applique aussi aux équipes qu'il ne pilote pas", () => {
    expect(canEditWorkflow(PO_A, DEFAULT_WF)).toBe(false);
  });

  it("n'est supprimable par personne, pas même le CEO", () => {
    expect(canDeleteWorkflow(CEO, DEFAULT_WF)).toBe(false);
    expect(canDeleteWorkflow(PO_A, DEFAULT_WF)).toBe(false);
  });
});

describe("flux d'une seule équipe", () => {
  const wf = { isDefault: false, createdById: "po-a", teamKeys: ["P:p1"] };

  it("est éditable par le PO qui pilote cette équipe", () => {
    expect(canEditWorkflow(PO_A, wf)).toBe(true);
    expect(canDeleteWorkflow(PO_A, wf)).toBe(true);
  });

  it("est verrouillé pour un PO qui ne la pilote pas", () => {
    expect(canEditWorkflow(PO_B, wf)).toBe(false);
  });

  it("reste ouvert au CEO", () => {
    expect(canEditWorkflow(CEO, wf)).toBe(true);
  });
});

describe("flux partagé entre deux équipes", () => {
  // Le cas dangereux : éditer changerait le tableau de l'autre PO.
  const shared = { isDefault: false, createdById: "po-a", teamKeys: ["P:p1", "P:p2"] };

  it("est verrouillé pour les DEUX PO, même pour son créateur", () => {
    expect(canEditWorkflow(PO_A, shared)).toBe(false);
    expect(canEditWorkflow(PO_B, shared)).toBe(false);
  });

  it("reste éditable par le CEO, qui arbitre", () => {
    expect(canEditWorkflow(CEO, shared)).toBe(true);
  });

  it("s'ouvre au PO qui pilote toutes les équipes concernées", () => {
    const poBoth: WorkflowViewer = {
      id: "po-both",
      role: "PO",
      ownedTeamKeys: ["P:p1", "P:p2"],
    };
    expect(canEditWorkflow(poBoth, shared)).toBe(true);
  });
});

describe("flux sans aucune équipe", () => {
  const orphan = { isDefault: false, createdById: "po-a", teamKeys: [] };

  it("appartient à son créateur", () => {
    expect(canEditWorkflow(PO_A, orphan)).toBe(true);
  });

  it("échappe aux autres PO — sinon « toutes ses équipes m'appartiennent » serait vrai pour tous", () => {
    expect(canEditWorkflow(PO_B, orphan)).toBe(false);
  });

  it("reste verrouillé si l'auteur est inconnu", () => {
    expect(
      canEditWorkflow(PO_A, { isDefault: false, createdById: null, teamKeys: [] })
    ).toBe(false);
  });
});

describe("rôles sans accès", () => {
  const wf = { isDefault: false, createdById: "c", teamKeys: [] };

  it("ne peuvent ni voir, ni créer, ni éditer", () => {
    for (const who of [CONTRIB, VIEWER]) {
      expect(canCreateWorkflow(who)).toBe(false);
      expect(canEditWorkflow(who, wf)).toBe(false);
      expect(canAssignTeam(who, "P:p1")).toBe(false);
    }
  });
});

describe("rattacher une équipe", () => {
  it("est un droit sur l'équipe, pas sur le flux", () => {
    expect(canAssignTeam(PO_A, "P:p1")).toBe(true);
    expect(canAssignTeam(PO_A, "P:p2")).toBe(false);
  });

  it("est toujours permis au CEO et au management", () => {
    expect(canAssignTeam(CEO, "P:p2")).toBe(true);
    expect(canAssignTeam(MGMT, "D:d5")).toBe(true);
  });

  it("couvre les départements comme les produits", () => {
    const poDept: WorkflowViewer = { id: "x", role: "PO", ownedTeamKeys: ["D:d2"] };
    expect(canAssignTeam(poDept, "D:d2")).toBe(true);
    expect(canAssignTeam(poDept, "D:d3")).toBe(false);
  });
});

describe("readOnlyReason", () => {
  it("ne dit rien quand l'édition est permise", () => {
    expect(readOnlyReason(CEO, DEFAULT_WF)).toBeNull();
  });

  it("explique le cas du flux par défaut", () => {
    expect(readOnlyReason(PO_A, DEFAULT_WF)).toMatch(/défaut/i);
  });

  it("compte les équipes étrangères pour un flux partagé", () => {
    const reason = readOnlyReason(PO_A, {
      isDefault: false,
      createdById: "po-a",
      teamKeys: ["P:p1", "P:p2", "P:p3"],
    });
    // p2 et p3 ne sont pas à PO_A → « 2 équipes », au pluriel.
    expect(reason).toMatch(/2 équipes/);
  });

  it("accorde au singulier pour une seule équipe étrangère", () => {
    const reason = readOnlyReason(PO_A, {
      isDefault: false,
      createdById: "po-a",
      teamKeys: ["P:p1", "P:p2"],
    });
    expect(reason).toMatch(/1 équipe /);
  });

  it("explique le flux créé par quelqu'un d'autre", () => {
    const reason = readOnlyReason(PO_B, {
      isDefault: false,
      createdById: "po-a",
      teamKeys: [],
    });
    expect(reason).toMatch(/quelqu'un d'autre/);
  });
});
