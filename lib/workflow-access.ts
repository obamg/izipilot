/**
 * Qui a le droit de toucher à quel flux de colonnes — helpers purs, testables.
 *
 * Le point sensible : un flux est PARTAGEABLE entre équipes. Laisser un PO
 * éditer un flux utilisé par une équipe qu'il ne pilote pas changerait le
 * tableau de quelqu'un d'autre sans que cette personne l'ait demandé. D'où la
 * règle centrale : un PO n'édite un flux que si TOUTES les équipes qui
 * l'utilisent sont les siennes.
 *
 * Conséquence assumée : si deux PO partagent un flux, plus aucun des deux ne
 * peut l'éditer — seul le CEO / le management le peut. C'est voulu ; l'écran
 * l'explique plutôt que de laisser l'un écraser l'autre.
 */

import type { UserRole } from "@prisma/client";

/** CEO et management pilotent la configuration de bout en bout. */
const FULL_ACCESS: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT"];

/** Qui peut ouvrir l'écran des flux (même en lecture seule sur certains). */
const CAN_VIEW: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT", "PO"];

export interface WorkflowViewer {
  id: string;
  role: UserRole;
  /** Clés des équipes dont la personne est responsable ("P:<id>" / "D:<id>"). */
  ownedTeamKeys: readonly string[];
}

/** Le flux tel qu'il faut le connaître pour trancher les droits. */
export interface WorkflowAccessInput {
  isDefault: boolean;
  createdById: string | null;
  /** Clés des équipes rattachées à ce flux. */
  teamKeys: readonly string[];
}

export function canViewWorkflows(role: UserRole): boolean {
  return CAN_VIEW.includes(role);
}

export function hasFullAccess(role: UserRole): boolean {
  return FULL_ACCESS.includes(role);
}

/** N'importe qui ayant accès à l'écran peut créer son propre flux. */
export function canCreateWorkflow(viewer: WorkflowViewer): boolean {
  return canViewWorkflows(viewer.role);
}

/**
 * Éditer un flux : renommer, ajouter / modifier / supprimer / réordonner ses
 * colonnes. Le flux par défaut est hors de portée d'un PO — c'est le filet de
 * toutes les équipes sans flux dédié, y compris celles qu'il ne pilote pas.
 */
export function canEditWorkflow(
  viewer: WorkflowViewer,
  workflow: WorkflowAccessInput
): boolean {
  if (hasFullAccess(viewer.role)) return true;
  if (!canViewWorkflows(viewer.role)) return false;
  if (workflow.isDefault) return false;

  // Flux encore rattaché à aucune équipe : seul son auteur y touche, sinon
  // « toutes ses équipes m'appartiennent » serait vrai pour tout le monde.
  if (workflow.teamKeys.length === 0) {
    return workflow.createdById != null && workflow.createdById === viewer.id;
  }

  const owned = new Set(viewer.ownedTeamKeys);
  return workflow.teamKeys.every((k) => owned.has(k));
}

/** Supprimer suit exactement les mêmes droits qu'éditer. */
export function canDeleteWorkflow(
  viewer: WorkflowViewer,
  workflow: WorkflowAccessInput
): boolean {
  if (workflow.isDefault) return false; // jamais, pour personne
  return canEditWorkflow(viewer, workflow);
}

/**
 * Rattacher une équipe à un flux. C'est un droit sur L'ÉQUIPE, pas sur le
 * flux : un PO choisit le flux de son produit, quitte à le partager avec une
 * autre équipe — auquel cas il perdra le droit de l'éditer, et l'écran le dit.
 */
export function canAssignTeam(viewer: WorkflowViewer, teamKey: string): boolean {
  if (hasFullAccess(viewer.role)) return true;
  if (!canViewWorkflows(viewer.role)) return false;
  return viewer.ownedTeamKeys.includes(teamKey);
}

/**
 * Pourquoi un flux est en lecture seule — affiché tel quel dans l'écran, pour
 * qu'un PO comprenne le refus au lieu de le subir.
 */
export function readOnlyReason(
  viewer: WorkflowViewer,
  workflow: WorkflowAccessInput
): string | null {
  if (canEditWorkflow(viewer, workflow)) return null;
  if (workflow.isDefault) {
    return "Flux par défaut : il s'applique à toutes les équipes sans flux dédié, seule la direction peut le modifier.";
  }
  if (workflow.teamKeys.length === 0) {
    return "Ce flux a été créé par quelqu'un d'autre.";
  }
  const owned = new Set(viewer.ownedTeamKeys);
  const foreign = workflow.teamKeys.filter((k) => !owned.has(k));
  return `Ce flux est aussi utilisé par ${foreign.length} équipe${
    foreign.length > 1 ? "s" : ""
  } que vous ne pilotez pas — le modifier changerait leur tableau.`;
}
