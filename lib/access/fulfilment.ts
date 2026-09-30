// lib/access/fulfilment.ts
// Exécution des demandes (phase 3b) — logique pure, sans accès base.
// Machine à états des tâches, effet d'une confirmation sur l'affectation
// courante (spec 3b §5), validation des faits d'exécution, rôle d'un
// propriétaire, drapeaux de navigation et libellés.
import type { Prisma } from "@prisma/client";
import type { ReadScope } from "./scope";

export type TaskAction = "GRANT" | "CHANGE_LEVEL" | "RENEW" | "REVOKE" | "EXPIRY_REMOVAL";
export type TaskState = "READY" | "CLAIMED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
export type TaskTransition =
  | "CLAIM"
  | "HANDOVER"
  | "BLOCK"
  | "PARTIAL_REMOVAL"
  | "RESUME"
  | "COMPLETE"
  | "CANCEL"
  | "RECONCILE";
export type TaskOutcome =
  | "PROVISIONED"
  | "CHANGED"
  | "RENEWED"
  | "REVOKED"
  | "REMOVED"
  | "NOT_PERFORMED"
  | "OLD_LEVEL_REMOVED"
  | "SUPERSEDED"
  | "EXPIRED_BEFORE_FULFILMENT";
export type CompletionMethod = "DIRECT" | "REMOVE_THEN_GRANT";
export type OwnerRole = "ASSET_OWNER" | "ASSET_OWNER_BACKUP";
export type RequestKindForTask = "GRANT" | "UPGRADE" | "RENEW" | "REDUCE" | "REVOKE";

/**
 * Règle unique « octroi / montée / renouvellement » : ces tâches ajoutent ou
 * élèvent un accès, donc revérifient l'employé, l'actif et la période. Une
 * réduction ou un retrait n'est jamais bloqué (FP:110, FP:124).
 */
export function isGrantFamilyTask(action: TaskAction, requestKind: string | null | undefined): boolean {
  return action === "GRANT" || action === "RENEW" || (action === "CHANGE_LEVEL" && requestKind === "UPGRADE");
}

/** Même règle, sous forme de filtre Prisma (devoir 4 du processeur). */
export const GRANT_FAMILY_TASK_WHERE: Prisma.AccessFulfilmentTaskWhereInput = {
  OR: [{ action: { in: ["GRANT", "RENEW"] } }, { action: "CHANGE_LEVEL", requestVersion: { kind: "UPGRADE" } }],
};

export const OPEN_TASK_STATES = ["READY", "CLAIMED", "BLOCKED"] as const;
export const CLOSED_TASK_STATES = ["COMPLETED", "CANCELLED"] as const;

export const EXPIRY_OWNER_REASON = "Fin de période temporaire";
export const PARTIAL_REMOVAL_REASON = "Ancien niveau retiré — nouvel accès pas encore accordé";
export const SUPERSEDED_REASON = "Supplantée par un renouvellement";
export const SUPERSEDED_BY_REMOVAL_REASON = "Supplantée par un retrait confirmé";
export const EXPIRED_BEFORE_FULFILMENT_REASON = "Fin de période dépassée avant exécution";
export const ASSIGNMENT_CHANGED_REASON = "L'affectation a changé depuis l'approbation";

/**
 * Action de la tâche d'exécution pour un type de demande (3a). UPGRADE et
 * REDUCE sont tous deux un remplacement de niveau pour le propriétaire.
 */
export function taskActionForKind(kind: RequestKindForTask): TaskAction {
  switch (kind) {
    case "GRANT":
      return "GRANT";
    case "UPGRADE":
    case "REDUCE":
      return "CHANGE_LEVEL";
    case "RENEW":
      return "RENEW";
    case "REVOKE":
      return "REVOKE";
  }
}

// Spec 3b §5 (FP:285). COMPLETED et CANCELLED sont immuables : aucune entrée.
const TRANSITIONS: Record<TaskTransition, Partial<Record<TaskState, TaskState>>> = {
  CLAIM: { READY: "CLAIMED" },
  HANDOVER: { CLAIMED: "CLAIMED", BLOCKED: "BLOCKED" },
  BLOCK: { CLAIMED: "BLOCKED" },
  PARTIAL_REMOVAL: { CLAIMED: "BLOCKED" },
  RESUME: { BLOCKED: "CLAIMED" },
  COMPLETE: { CLAIMED: "COMPLETED" },
  CANCEL: { READY: "CANCELLED" },
  RECONCILE: { CLAIMED: "CANCELLED", BLOCKED: "CANCELLED" },
};

export function nextTaskState(state: TaskState, transition: TaskTransition): TaskState | null {
  return TRANSITIONS[transition][state] ?? null;
}

export function canTransition(state: TaskState, transition: TaskTransition): boolean {
  return nextTaskState(state, transition) !== null;
}

export function outcomeFor(action: TaskAction): TaskOutcome {
  switch (action) {
    case "GRANT":
      return "PROVISIONED";
    case "CHANGE_LEVEL":
      return "CHANGED";
    case "RENEW":
      return "RENEWED";
    case "REVOKE":
      return "REVOKED";
    case "EXPIRY_REMOVAL":
      return "REMOVED";
  }
}

export interface AssignmentSnapshot {
  status: "ACTIVE" | "EXPIRED_REMOVAL_PENDING" | "REVOKED";
  levelId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface TaskTerms {
  fromLevelId: string | null;
  toLevelId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Étape 1 d'un REMOVE_THEN_GRANT déjà enregistrée (D-10). */
  oldRemoved: boolean;
}

export interface AssignmentWrite {
  status: "ACTIVE" | "REVOKED";
  levelId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Absent = inchangé (renouvellement : le niveau courant n'est pas ré-accordé). */
  grantedAt?: Date;
  revokedAt: Date | null;
}

export type AssignmentEffect = { ok: true; write: AssignmentWrite } | { ok: false; reason: string };

const changed: AssignmentEffect = { ok: false, reason: ASSIGNMENT_CHANGED_REASON };

/**
 * Effet d'une confirmation sur l'affectation courante (spec 3b §5, tableau
 * « Affectation »). `ok: false` = l'état courant ne correspond pas à ce que
 * l'approbation supposait : la confirmation est refusée (409), jamais
 * appliquée sur un état inattendu.
 */
export function assignmentEffect(
  action: TaskAction,
  current: AssignmentSnapshot | null,
  task: TaskTerms,
  completedAt: Date
): AssignmentEffect {
  switch (action) {
    case "GRANT": {
      const free = current === null || current.status !== "ACTIVE" || current.levelId === null;
      if (!free || task.toLevelId === null) return changed;
      return {
        ok: true,
        write: {
          status: "ACTIVE",
          levelId: task.toLevelId,
          periodStart: task.periodStart ?? completedAt,
          periodEnd: task.periodEnd,
          grantedAt: completedAt,
          revokedAt: null,
        },
      };
    }
    case "CHANGE_LEVEL": {
      if (task.toLevelId === null || current === null) return changed;
      const expected = task.oldRemoved
        ? current.status === "REVOKED" && current.levelId === null
        : current.status === "ACTIVE" && current.levelId !== null && current.levelId === task.fromLevelId;
      if (!expected) return changed;
      return {
        ok: true,
        write: {
          status: "ACTIVE",
          levelId: task.toLevelId,
          periodStart: task.periodStart ?? completedAt,
          periodEnd: task.periodEnd,
          grantedAt: completedAt,
          revokedAt: null,
        },
      };
    }
    case "RENEW": {
      if (current === null || current.status === "REVOKED" || current.levelId === null) return changed;
      if (current.levelId !== task.toLevelId) return changed;
      return {
        ok: true,
        write: {
          status: "ACTIVE",
          levelId: current.levelId,
          periodStart: current.periodStart,
          periodEnd: task.periodEnd,
          revokedAt: null,
        },
      };
    }
    case "REVOKE":
    case "EXPIRY_REMOVAL": {
      if (current === null || current.status === "REVOKED") return changed;
      return {
        ok: true,
        write: {
          status: "REVOKED",
          levelId: null,
          periodStart: current.periodStart,
          periodEnd: current.periodEnd,
          revokedAt: completedAt,
        },
      };
    }
  }
}

/**
 * Étape 1 d'un remplacement REMOVE_THEN_GRANT (D-10, FP:243) : l'ancien
 * niveau est retiré, le nouveau pas encore accordé → « aucun accès courant »,
 * jamais deux niveaux ni un faux succès (A18).
 */
export function partialRemovalEffect(
  current: AssignmentSnapshot | null,
  task: TaskTerms,
  completedAt: Date
): AssignmentEffect {
  if (task.oldRemoved || current === null) return changed;
  if (current.status !== "ACTIVE" || current.levelId === null || current.levelId !== task.fromLevelId) return changed;
  return {
    ok: true,
    write: {
      status: "REVOKED",
      levelId: null,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      revokedAt: completedAt,
    },
  };
}

export interface CompletionFacts {
  completedAt: Date;
  reference: string | null;
  note: string | null;
}

const FIVE_MINUTES_MS = 5 * 60_000;
const ONE_DAY_MS = 24 * 3_600_000;

/** Message d'erreur (français) ou null si les faits d'exécution sont recevables. */
export function validateCompletionInput(
  facts: CompletionFacts,
  ctx: { now: Date; claimedAt: Date | null }
): string | null {
  if (Number.isNaN(facts.completedAt.getTime())) return "Date d'exécution invalide";
  if (facts.completedAt.getTime() > ctx.now.getTime() + FIVE_MINUTES_MS) {
    return "La date d'exécution ne peut pas être dans le futur";
  }
  if (ctx.claimedAt && facts.completedAt.getTime() < ctx.claimedAt.getTime() - ONE_DAY_MS) {
    return "La date d'exécution précède de plus d'un jour la prise en charge de la tâche";
  }
  const reference = facts.reference?.trim() ?? "";
  const note = facts.note?.trim() ?? "";
  if (!reference && !note) return "Une référence ou une note d'exécution est obligatoire";
  if (reference.length > 200) return "La référence dépasse 200 caractères";
  if (note.length > 2000) return "La note dépasse 2000 caractères";
  return null;
}

/** Rôle de l'utilisateur sur l'actif (le propriétaire principal prime), ou null. */
export function ownerRoleFor(
  asset: { ownerId: string | null; backupOwnerId: string | null },
  userId: string
): OwnerRole | null {
  if (asset.ownerId === userId) return "ASSET_OWNER";
  if (asset.backupOwnerId === userId) return "ASSET_OWNER_BACKUP";
  return null;
}

/** Date ISO de l'étape 1 d'un REMOVE_THEN_GRANT, lue dans `progress` (Json). */
export function readOldRemovedAt(progress: unknown): string | null {
  if (progress && typeof progress === "object" && !Array.isArray(progress)) {
    const value = (progress as Record<string, unknown>).oldRemovedAt;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Drapeaux de navigation de l'écran « Exécution » (D-15), calculés côté
 * serveur depuis les portées — même principe que `registerNavFlags`.
 */
export function fulfilmentNavFlags(
  scopes: ReadScope[],
  fulfilmentAssetIds: string[]
): { hasFulfilmentView: boolean; hasMineView: boolean; canOversee: boolean } {
  const hasMineView = fulfilmentAssetIds.length > 0;
  const canOversee = scopes.some((s) => s.kind === "ALL");
  return { hasFulfilmentView: hasMineView || canOversee, hasMineView, canOversee };
}

export const TASK_ACTION_LABELS: Record<TaskAction, string> = {
  GRANT: "Accorder",
  CHANGE_LEVEL: "Changer de niveau",
  RENEW: "Renouveler",
  REVOKE: "Retirer",
  EXPIRY_REMOVAL: "Retirer — fin de période",
};

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  READY: "À réclamer",
  CLAIMED: "En cours",
  BLOCKED: "Bloquée",
  COMPLETED: "Exécutée",
  CANCELLED: "Annulée",
};

/** Référence courte affichée sur la carte (« EX-XXXXXX »). */
export function shortTaskReference(taskId: string): string {
  return `EX-${taskId.slice(-6).toUpperCase()}`;
}
