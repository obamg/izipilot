import { z } from "zod";

const scoreField = z.number().int().min(1).max(5);

export const evaluationInputSchema = z.object({
  subjectId: z.string().min(1),
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2020).max(2100),
  scoreQuality: scoreField,
  scoreCollaboration: scoreField,
  scoreInitiative: scoreField,
  comment: z.string().max(2000).nullish(),
});

export type EvaluationInput = z.infer<typeof evaluationInputSchema>;
