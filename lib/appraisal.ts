/**
 * Bilan trimestriel (performance appraisal) — logique pure, sans accès DB, pour
 * rester testable. Deux côtés notent des compétences /5 ; la note globale mêle
 * l'évaluation du manager et la moyenne des évaluations mensuelles du trimestre
 * (« build on » les évaluations existantes).
 */

import type { Quarter } from "@prisma/client";

// Compétences notées 1–5 (self + manager). Les trois premières reprennent les
// critères de l'évaluation mensuelle pour la continuité.
export const APPRAISAL_COMPETENCIES = [
  { key: "quality", label: "Qualité du travail" },
  { key: "collaboration", label: "Collaboration" },
  { key: "initiative", label: "Initiative & autonomie" },
  { key: "communication", label: "Communication" },
  { key: "reliability", label: "Fiabilité & respect des délais" },
] as const;

export type CompetencyKey = (typeof APPRAISAL_COMPETENCIES)[number]["key"];
export const COMPETENCY_KEYS = APPRAISAL_COMPETENCIES.map((c) => c.key) as CompetencyKey[];

// Part de la moyenne mensuelle (auto/objective) dans la note globale du bilan.
// Le reste vient de l'évaluation du manager (compétences + objectifs).
export const APPRAISAL_MONTHLY_WEIGHT = 0.3;

export type CompetencyScores = Partial<Record<string, number>>;

export interface AppraisalGoal {
  id: string;
  title: string;
  selfRating?: number | null;
  selfComment?: string | null;
  managerRating?: number | null;
  managerComment?: string | null;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Moyenne des nombres définis, arrondie à 1 décimale ; null si aucun. */
export function avgDefined(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return round1(nums.reduce((s, v) => s + v, 0) / nums.length);
}

/** Moyenne des compétences renseignées (1–5) parmi les clés connues. */
export function competencyAverage(scores: CompetencyScores | null | undefined): number | null {
  if (!scores) return null;
  return avgDefined(COMPETENCY_KEYS.map((k) => scores[k]));
}

/** Moyenne des notes manager sur les objectifs. */
export function managerGoalsAverage(goals: AppraisalGoal[] | null | undefined): number | null {
  if (!goals) return null;
  return avgDefined(goals.map((g) => g.managerRating));
}

/**
 * Évaluation du manager = moyenne pondérée-égale de toutes ses notes de
 * compétences et de toutes ses notes d'objectifs (chaque note compte pour une).
 */
export function managerAssessmentAverage(
  managerCompetencies: CompetencyScores | null | undefined,
  goals: AppraisalGoal[] | null | undefined
): number | null {
  const comp = managerCompetencies
    ? COMPETENCY_KEYS.map((k) => managerCompetencies[k])
    : [];
  const goalRatings = goals ? goals.map((g) => g.managerRating) : [];
  return avgDefined([...comp, ...goalRatings]);
}

/**
 * Note globale /5 du bilan. Mêle l'évaluation du manager (compétences +
 * objectifs) et la moyenne mensuelle du trimestre. Si l'un des deux manque, on
 * retombe sur l'autre.
 */
export function overallScore(args: {
  managerCompetencies: CompetencyScores | null | undefined;
  goals: AppraisalGoal[] | null | undefined;
  monthlyAvg: number | null | undefined;
}): number | null {
  const managerAvg = managerAssessmentAverage(args.managerCompetencies, args.goals);
  const monthly = typeof args.monthlyAvg === "number" ? args.monthlyAvg : null;
  if (managerAvg == null) return monthly != null ? round1(monthly) : null;
  if (monthly == null) return round1(managerAvg);
  return round1(
    (1 - APPRAISAL_MONTHLY_WEIGHT) * managerAvg + APPRAISAL_MONTHLY_WEIGHT * monthly
  );
}

// ---------------------------------------------------------------------------
// Trimestres
// ---------------------------------------------------------------------------

export const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"];

/** Mois (1–12) couverts par un trimestre. */
export function quarterMonths(q: Quarter): number[] {
  switch (q) {
    case "Q1":
      return [1, 2, 3];
    case "Q2":
      return [4, 5, 6];
    case "Q3":
      return [7, 8, 9];
    case "Q4":
      return [10, 11, 12];
  }
}

/** Trimestre (1–4 → Q1–Q4) contenant un mois donné. */
export function quarterOfMonth(month1to12: number): Quarter {
  return QUARTERS[Math.floor((month1to12 - 1) / 3)];
}

export function quarterLabel(q: Quarter, year: number): string {
  return `${q} ${year}`;
}

/** Le trimestre précédent (Q1 → Q4 de l'année d'avant). */
export function previousQuarter(q: Quarter, year: number): { quarter: Quarter; year: number } {
  const idx = QUARTERS.indexOf(q);
  if (idx === 0) return { quarter: "Q4", year: year - 1 };
  return { quarter: QUARTERS[idx - 1], year };
}

// ---------------------------------------------------------------------------
// Rappel trimestriel — décompte des actions en attente par personne
// ---------------------------------------------------------------------------

export interface AppraisalTaskCounts {
  toOpen: number; // manager : membres de l'équipe sans bilan ouvert
  toComplete: number; // manager : bilans en attente de mon évaluation (auto-éval soumise)
  selfPending: number; // moi : auto-évaluations à remplir
  signPending: number; // moi : bilans partagés à signer
}

export function totalAppraisalTasks(t: AppraisalTaskCounts): number {
  return t.toOpen + t.toComplete + t.selfPending + t.signPending;
}

// ---------------------------------------------------------------------------
// Rollup des évaluations mensuelles du trimestre
// ---------------------------------------------------------------------------

export interface MonthlyEvalPoint {
  overall: number;
  deliveryScore: number | null;
  quality: number;
  collaboration: number;
  initiative: number;
}

export interface MonthlyRollup {
  count: number; // nombre d'évaluations mensuelles trouvées sur le trimestre
  avgOverall: number | null;
  avgDelivery: number | null;
  avgQuality: number | null;
  avgCollaboration: number | null;
  avgInitiative: number | null;
}

/** Agrège les évaluations mensuelles du trimestre en moyennes /5. */
export function aggregateMonthlyRollup(points: MonthlyEvalPoint[]): MonthlyRollup {
  return {
    count: points.length,
    avgOverall: avgDefined(points.map((p) => p.overall)),
    avgDelivery: avgDefined(points.map((p) => p.deliveryScore)),
    avgQuality: avgDefined(points.map((p) => p.quality)),
    avgCollaboration: avgDefined(points.map((p) => p.collaboration)),
    avgInitiative: avgDefined(points.map((p) => p.initiative)),
  };
}
