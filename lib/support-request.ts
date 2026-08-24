/**
 * Demandes internes — logique pure (aucun accès DB, testable directement).
 * Les accès et l'auto-affectation vivent dans lib/support-request-server.ts.
 */

import type {
  SupportRequestCategory,
  SupportRequestPriority,
  SupportRequestStatus,
} from "@prisma/client";

// Qui agit sur la demande : le guichet (support/assigné/CODIR) ou la personne
// qui l'a déposée. Les transitions autorisées diffèrent.
export type SupportActorKind = "SUPPORT" | "REQUESTER";

export const SUPPORT_CATEGORY_META: Record<
  SupportRequestCategory,
  { label: string; hint: string }
> = {
  INCIDENT: { label: "Panne / incident", hint: "Quelque chose ne marche plus" },
  ACCESS: { label: "Accès & comptes", hint: "Création de compte, droits, mot de passe" },
  EQUIPMENT: { label: "Matériel", hint: "Poste, écran, téléphone, imprimante" },
  SOFTWARE: { label: "Logiciel & licence", hint: "Installation, licence, mise à jour" },
  DATA: { label: "Données & rapports", hint: "Extraction, correction, export" },
  IMPROVEMENT: { label: "Évolution", hint: "Nouvelle fonctionnalité, amélioration" },
  OTHER: { label: "Autre", hint: "Tout le reste" },
};

export const SUPPORT_PRIORITY_META: Record<
  SupportRequestPriority,
  { label: string; color: string; bg: string; slaHours: number }
> = {
  LOW: { label: "Basse", color: "var(--gray)", bg: "var(--gray-lt)", slaHours: 120 },
  NORMAL: { label: "Normale", color: "var(--teal)", bg: "var(--teal-lt)", slaHours: 72 },
  HIGH: { label: "Haute", color: "var(--gold)", bg: "var(--gold-lt)", slaHours: 24 },
  URGENT: { label: "Urgente", color: "var(--red)", bg: "var(--red-lt)", slaHours: 4 },
};

export const SUPPORT_STATUS_META: Record<
  SupportRequestStatus,
  { label: string; color: string; bg: string }
> = {
  SUBMITTED: { label: "Déposée", color: "var(--gray)", bg: "var(--gray-lt)" },
  TRIAGED: { label: "Prise en charge", color: "var(--teal)", bg: "var(--teal-lt)" },
  IN_PROGRESS: { label: "En cours", color: "var(--teal-dk)", bg: "var(--teal-lt)" },
  ON_HOLD: { label: "En attente", color: "var(--gold)", bg: "var(--gold-lt)" },
  RESOLVED: { label: "Résolue", color: "var(--green)", bg: "var(--green-lt)" },
  CLOSED: { label: "Clôturée", color: "var(--gray)", bg: "var(--gray-lt)" },
  REJECTED: { label: "Refusée", color: "var(--red)", bg: "var(--red-lt)" },
  CANCELLED: { label: "Annulée", color: "var(--gray)", bg: "var(--gray-lt)" },
};

/** Statuts encore actifs côté support — ce qui compose la file d'attente. */
export const OPEN_STATUSES: readonly SupportRequestStatus[] = [
  "SUBMITTED",
  "TRIAGED",
  "IN_PROGRESS",
  "ON_HOLD",
] as const;

/** Statuts figés : plus de traitement attendu. */
export const TERMINAL_STATUSES: readonly SupportRequestStatus[] = [
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;

export function isOpenStatus(status: SupportRequestStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function isTerminalStatus(status: SupportRequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Transitions autorisées depuis un statut, selon qui agit.
 *
 * Le support pilote le traitement. Le demandeur ne peut qu'annuler tant que ce
 * n'est pas traité, puis accepter (CLOSED) ou refuser la résolution (retour en
 * IN_PROGRESS) — c'est ce qui évite qu'une demande soit clôturée d'office alors
 * que le problème persiste.
 */
export function allowedTransitions(
  status: SupportRequestStatus,
  actor: SupportActorKind
): SupportRequestStatus[] {
  if (actor === "REQUESTER") {
    if (isOpenStatus(status)) return ["CANCELLED"];
    if (status === "RESOLVED") return ["CLOSED", "IN_PROGRESS"];
    return [];
  }

  switch (status) {
    case "SUBMITTED":
      return ["TRIAGED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "REJECTED"];
    case "TRIAGED":
      return ["IN_PROGRESS", "ON_HOLD", "RESOLVED", "REJECTED"];
    case "IN_PROGRESS":
      return ["ON_HOLD", "RESOLVED", "REJECTED"];
    case "ON_HOLD":
      return ["TRIAGED", "IN_PROGRESS", "RESOLVED", "REJECTED"];
    case "RESOLVED":
      return ["CLOSED", "IN_PROGRESS"];
    // Réouverture possible : un incident refermé trop vite revient souvent.
    case "CLOSED":
    case "REJECTED":
      return ["IN_PROGRESS"];
    case "CANCELLED":
      return [];
  }
}

export function canTransition(
  from: SupportRequestStatus,
  to: SupportRequestStatus,
  actor: SupportActorKind
): boolean {
  return allowedTransitions(from, actor).includes(to);
}

/** Échéance cible dérivée de la priorité (heures calendaires depuis le dépôt). */
export function computeDueAt(priority: SupportRequestPriority, from: Date): Date {
  const { slaHours } = SUPPORT_PRIORITY_META[priority];
  return new Date(from.getTime() + slaHours * 3_600_000);
}

/**
 * En retard = échéance dépassée sur une demande encore ouverte. Une demande
 * résolue ou close n'est jamais en retard, même si elle l'a été.
 */
export function isOverdue(
  request: { status: SupportRequestStatus; dueAt: Date | string | null },
  now: Date
): boolean {
  if (!request.dueAt) return false;
  if (!isOpenStatus(request.status)) return false;
  const due = request.dueAt instanceof Date ? request.dueAt : new Date(request.dueAt);
  return due.getTime() < now.getTime();
}

/** Référence lisible, ex "IT-2026-0042" (séquence annuelle par département). */
export function formatReference(deptCode: string, year: number, sequence: number): string {
  return `${deptCode.toUpperCase()}-${year}-${String(sequence).padStart(4, "0")}`;
}

/** Écart en heures entre deux dates, arrondi au dixième. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}

export interface SupportStats {
  total: number;
  open: number;
  overdue: number;
  unassigned: number;
  resolvedThisPeriod: number;
  /** Délai moyen de résolution en heures (null si rien de résolu). */
  avgResolutionHours: number | null;
  /** Délai moyen de première réponse en heures (null si aucune réponse). */
  avgFirstResponseHours: number | null;
  byCategory: Array<{ category: SupportRequestCategory; count: number }>;
  byPriority: Array<{ priority: SupportRequestPriority; count: number }>;
}

export interface StatsInput {
  status: SupportRequestStatus;
  priority: SupportRequestPriority;
  category: SupportRequestCategory;
  assigneeId: string | null;
  dueAt: Date | null;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
}

/**
 * Agrégats de la file support. Les moyennes ignorent les demandes sans date
 * correspondante plutôt que de les compter comme zéro — une demande jamais
 * résolue ne doit pas tirer le délai moyen vers le bas.
 */
export function computeStats(requests: ReadonlyArray<StatsInput>, now: Date): SupportStats {
  const byCategory = new Map<SupportRequestCategory, number>();
  const byPriority = new Map<SupportRequestPriority, number>();

  let open = 0;
  let overdue = 0;
  let unassigned = 0;
  let resolvedThisPeriod = 0;
  let resolutionSum = 0;
  let resolutionCount = 0;
  let firstResponseSum = 0;
  let firstResponseCount = 0;

  for (const r of requests) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    byPriority.set(r.priority, (byPriority.get(r.priority) ?? 0) + 1);

    if (isOpenStatus(r.status)) {
      open++;
      if (!r.assigneeId) unassigned++;
      if (isOverdue(r, now)) overdue++;
    }

    if (r.resolvedAt) {
      resolvedThisPeriod++;
      resolutionSum += hoursBetween(r.createdAt, r.resolvedAt);
      resolutionCount++;
    }
    if (r.firstResponseAt) {
      firstResponseSum += hoursBetween(r.createdAt, r.firstResponseAt);
      firstResponseCount++;
    }
  }

  const avg = (sum: number, count: number) =>
    count === 0 ? null : Math.round((sum / count) * 10) / 10;

  return {
    total: requests.length,
    open,
    overdue,
    unassigned,
    resolvedThisPeriod,
    avgResolutionHours: avg(resolutionSum, resolutionCount),
    avgFirstResponseHours: avg(firstResponseSum, firstResponseCount),
    byCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    byPriority: [...byPriority.entries()]
      .map(([priority, count]) => ({ priority, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Tri de la file : urgent d'abord, puis les plus anciennes. */
const PRIORITY_RANK: Record<SupportRequestPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export function compareQueue(
  a: { priority: SupportRequestPriority; createdAt: Date },
  b: { priority: SupportRequestPriority; createdAt: Date }
): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/** Libellé court d'un délai en heures, pour l'affichage ("3 h", "2 j 4 h"). */
export function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest === 0 ? `${days} j` : `${days} j ${rest} h`;
}
