/**
 * Évaluations mensuelles — logique de notation (pure, sans accès DB pour rester
 * testable). Score hybride /5, moyenne pondérée de trois composantes :
 *   50 % livraison (auto) + 15 % point du jour (auto) + 35 % moyenne(manuels)
 * Quand une composante auto manque, les poids restants sont renormalisés.
 * La livraison est dérivée du ratio « points livrés ÷ points engagés » sur les
 * sprints du mois (voir computeDelivery) ; le point du jour du ratio « jours
 * remplis ÷ jours attendus » (voir standupRatio). Les deux passent par la même
 * échelle /5, ancrée sur la philosophie OKR (70 % ≈ réussite).
 */

import type { ActionStatus, UserRole } from "@prisma/client";
import { taskPoints } from "./sprint";

// Poids des composantes dans la note globale.
export const WEIGHTS = { delivery: 0.5, standup: 0.15, manual: 0.35 } as const;

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
 * Note globale /5 : moyenne pondérée des composantes disponibles. Une
 * composante auto absente (null) est ignorée et les poids restants sont
 * renormalisés — sans aucune des deux, on retombe sur les critères manuels.
 */
export function overallScore(
  deliveryScore: number | null,
  manual: ManualScores,
  standupScore: number | null = null
): number {
  let sum = WEIGHTS.manual * manualAverage(manual);
  let weight = WEIGHTS.manual;
  if (deliveryScore != null) {
    sum += WEIGHTS.delivery * deliveryScore;
    weight += WEIGHTS.delivery;
  }
  if (standupScore != null) {
    sum += WEIGHTS.standup * standupScore;
    weight += WEIGHTS.standup;
  }
  return round1(sum / weight);
}

// ---------------------------------------------------------------------------
// Point du jour (standup) : jours remplis ÷ jours attendus.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Jours (clés yyyy-mm-dd) où un standup était attendu : jours ouvrés du mois
 * couverts par au moins un des sprints fournis, jusqu'à `lastDay` inclus.
 * `ranges` et `lastDay` sont des dates calendaires à minuit UTC.
 */
export function expectedStandupDays(
  ranges: { start: Date; end: Date }[],
  year: number,
  month1to12: number,
  lastDay: Date
): Set<string> {
  const { start, end } = monthRange(year, month1to12);
  const days = new Set<string>();
  for (let t = start.getTime(); t < end.getTime() && t <= lastDay.getTime(); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (ranges.some((r) => r.start.getTime() <= t && t <= r.end.getTime())) {
      days.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  return days;
}

/**
 * Taux de remplissage : jours remplis ÷ (jours attendus − absences justifiées),
 * plafonné à 1. `null` s'il ne reste aucun jour attendu.
 */
export function standupRatio(filed: number, expected: number, excusedDays: number): number | null {
  const due = expected - excusedDays;
  if (due <= 0) return null;
  return Math.min(1, filed / due);
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

export interface MonthRef {
  month: number; // 1–12
  year: number;
  label: string; // "MM/YY"
}

/**
 * The `count` months ending at (year, month), oldest → newest. Used to build
 * the evaluation trend axis.
 */
export function recentMonths(year: number, month: number, count: number): MonthRef[] {
  const out: MonthRef[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    out.push({ month: m, year: y, label: `${String(m).padStart(2, "0")}/${String(y).slice(2)}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse();
}

/** Mean of the defined numbers, rounded to 1 decimal; null if none. */
export function avgDefined(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return round1(nums.reduce((s, v) => s + v, 0) / nums.length);
}

// ---------------------------------------------------------------------------
// Filtres du tableau de notation (département / statut / rôle).
// ---------------------------------------------------------------------------

export interface EvaluationFilterSubject {
  role: UserRole;
  isRated: boolean;
  departmentIds: string[];
}

export interface EvaluationFilters {
  department: string; // "ALL" ou un departmentId
  status: "ALL" | "RATED" | "UNRATED";
  role: "ALL" | UserRole;
}

export function matchesEvaluationFilters(
  subject: EvaluationFilterSubject,
  filters: EvaluationFilters
): boolean {
  if (filters.department !== "ALL" && !subject.departmentIds.includes(filters.department)) {
    return false;
  }
  if (filters.status === "RATED" && !subject.isRated) return false;
  if (filters.status === "UNRATED" && subject.isRated) return false;
  if (filters.role !== "ALL" && subject.role !== filters.role) return false;
  return true;
}
