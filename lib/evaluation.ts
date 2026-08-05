/**
 * Évaluations mensuelles — logique de notation (pure, sans accès DB pour rester
 * testable). Score hybride /5 :
 *   global = DELIVERY_WEIGHT · livraison(auto) + (1-DELIVERY_WEIGHT) · moyenne(manuels)
 * La livraison est dérivée du ratio « points livrés ÷ points engagés » sur les
 * sprints du mois (voir computeDelivery), converti en note /5 par une échelle
 * ancrée sur la philosophie OKR (70 % ≈ réussite).
 */

import type { ActionStatus } from "@prisma/client";
import { taskPoints } from "./sprint";

// Poids de la composante livraison dans la note globale (le reste = manuels).
export const DELIVERY_WEIGHT = 0.6;

// Critères manuels notés 1–5 par l'évaluateur.
export const MANUAL_CRITERIA = [
  { key: "quality", label: "Qualité du travail" },
  { key: "collaboration", label: "Collaboration" },
  { key: "initiative", label: "Initiative / valeur ajoutée" },
] as const;

export type ManualCriterionKey = (typeof MANUAL_CRITERIA)[number]["key"];

export interface ManualScores {
  quality: number;
  collaboration: number;
  initiative: number;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Échelle ratio de livraison → note /5. Transparente et ajustable ; les seuils
 * correspondent à ceux montrés dans l'UI. `null` si aucune donnée de livraison.
 */
export function deliveryScoreFromRatio(ratio: number | null): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio >= 1.0) return 5.0;
  if (ratio >= 0.85) return 4.0;
  if (ratio >= 0.7) return 3.5;
  if (ratio >= 0.5) return 2.5;
  if (ratio >= 0.25) return 2.0;
  return 1.0;
}

export function manualAverage(m: ManualScores): number {
  return (m.quality + m.collaboration + m.initiative) / 3;
}

/**
 * Note globale /5. Sans donnée de livraison (deliveryScore null), on retombe
 * sur la moyenne des critères manuels.
 */
export function overallScore(deliveryScore: number | null, manual: ManualScores): number {
  const avg = manualAverage(manual);
  if (deliveryScore == null) return round1(avg);
  return round1(DELIVERY_WEIGHT * deliveryScore + (1 - DELIVERY_WEIGHT) * avg);
}

// ---------------------------------------------------------------------------
// Livraison mensuelle à partir des tâches de sprint + capacité engagée.
// ---------------------------------------------------------------------------

export interface DeliveryTaskLike {
  status: ActionStatus;
  storyPoints: number | null;
  completedAt: Date | null;
  dueDate: Date | null;
}

export interface DeliveryStats {
  deliveredPoints: number; // points des tâches TERMINÉES
  committedPoints: number; // capacité engagée, ou points assignés en repli
  assignedPoints: number; // points de toutes les tâches non annulées
  ratio: number | null; // deliveredPoints ÷ committedPoints (null si engagé = 0)
  tasksDone: number;
  tasksTotal: number;
  onTimeRate: number | null; // part des tâches finies à temps (null si aucune échéance)
}

/**
 * Agrège la livraison d'une personne sur les tâches fournies (celles des sprints
 * du mois). `capacityPoints` = capacité engagée déclarée ; si 0/absente on
 * retombe sur les points assignés pour ne pas pénaliser l'absence de capacité.
 */
export function computeDelivery(
  tasks: DeliveryTaskLike[],
  capacityPoints: number
): DeliveryStats {
  const counted = tasks.filter((t) => t.status !== "CANCELLED");
  const assignedPoints = counted.reduce((s, t) => s + taskPoints(t), 0);
  const done = counted.filter((t) => t.status === "DONE");
  const deliveredPoints = done.reduce((s, t) => s + taskPoints(t), 0);

  const committedPoints = capacityPoints > 0 ? capacityPoints : assignedPoints;
  const ratio = committedPoints > 0 ? deliveredPoints / committedPoints : null;

  const withDue = done.filter((t) => t.dueDate != null);
  const onTime = withDue.filter(
    (t) => t.completedAt != null && t.completedAt.getTime() <= (t.dueDate as Date).getTime()
  );
  const onTimeRate = withDue.length > 0 ? onTime.length / withDue.length : null;

  return {
    deliveredPoints,
    committedPoints,
    assignedPoints,
    ratio,
    tasksDone: done.length,
    tasksTotal: counted.length,
    onTimeRate,
  };
}

// Bornes d'un mois (UTC) — utilisé côté serveur pour filtrer les sprints/tâches.
export function monthRange(year: number, month1to12: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month1to12 - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month1to12, 1, 0, 0, 0, 0)); // exclusif
  return { start, end };
}

export const MONTH_LABELS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
