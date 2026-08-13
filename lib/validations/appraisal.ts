import { z } from "zod";

const rating = z.number().int().min(1).max(5);
const nullableRating = rating.nullable().optional();
const longText = z.string().max(4000).nullable().optional();

// Compétences : objet { clé -> note 1–5 } (sous-ensemble autorisé).
export const competencyScoresSchema = z.record(z.string().max(40), rating);

export const goalSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  selfRating: nullableRating,
  selfComment: z.string().max(2000).nullable().optional(),
  managerRating: nullableRating,
  managerComment: z.string().max(2000).nullable().optional(),
});

export const createAppraisalSchema = z.object({
  subjectId: z.string().min(1),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  year: z.number().int().min(2020).max(2100),
});

export const selfAssessmentSchema = z.object({
  id: z.string().min(1),
  competencies: competencyScoresSchema,
  goals: z.array(goalSchema).max(20),
  comment: longText,
  submit: z.boolean().optional(),
});

export const managerAssessmentSchema = z.object({
  id: z.string().min(1),
  competencies: competencyScoresSchema,
  goals: z.array(goalSchema).max(20),
  strengths: longText,
  improvements: longText,
  developmentPlan: longText,
  comment: longText,
  finalize: z.boolean().optional(),
});

export const acknowledgeAppraisalSchema = z.object({
  id: z.string().min(1),
  comment: z.string().max(2000).nullable().optional(),
});

export type CreateAppraisalInput = z.infer<typeof createAppraisalSchema>;
export type SelfAssessmentInput = z.infer<typeof selfAssessmentSchema>;
export type ManagerAssessmentInput = z.infer<typeof managerAssessmentSchema>;
export type AcknowledgeAppraisalInput = z.infer<typeof acknowledgeAppraisalSchema>;
