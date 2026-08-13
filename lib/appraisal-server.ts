/**
 * Bilans trimestriels — accès DB. La logique pure vit dans lib/appraisal.ts ;
 * les droits (qui peut évaluer qui) sont réutilisés depuis evaluation-server.ts.
 */

import type { Quarter } from "@prisma/client";
import { prisma } from "./prisma";
import { quarterMonths, aggregateMonthlyRollup, type MonthlyRollup } from "./appraisal";

export { evaluableSubjectIds, canEvaluate, type Evaluator } from "./evaluation-server";

/**
 * Moyennes des évaluations mensuelles d'un collègue sur un trimestre — sert de
 * contexte objectif au bilan et de composante de la note globale.
 */
export async function monthlyRollupForQuarter(
  orgId: string,
  subjectId: string,
  quarter: Quarter,
  year: number
): Promise<MonthlyRollup> {
  const months = quarterMonths(quarter);
  const evals = await prisma.evaluation.findMany({
    where: { orgId, subjectId, periodYear: year, periodMonth: { in: months } },
    select: {
      overall: true,
      deliveryScore: true,
      scoreQuality: true,
      scoreCollaboration: true,
      scoreInitiative: true,
    },
  });
  return aggregateMonthlyRollup(
    evals.map((e) => ({
      overall: Number(e.overall),
      deliveryScore: e.deliveryScore == null ? null : Number(e.deliveryScore),
      quality: e.scoreQuality,
      collaboration: e.scoreCollaboration,
      initiative: e.scoreInitiative,
    }))
  );
}
