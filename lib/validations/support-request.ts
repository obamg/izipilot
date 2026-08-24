import { z } from "zod";

const CATEGORIES = [
  "INCIDENT",
  "ACCESS",
  "EQUIPMENT",
  "SOFTWARE",
  "DATA",
  "IMPROVEMENT",
  "OTHER",
] as const;

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

const STATUSES = [
  "SUBMITTED",
  "TRIAGED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RESOLVED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;

export const createSupportRequestSchema = z.object({
  departmentId: z.string().min(1),
  category: z.enum(CATEGORIES).default("OTHER"),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  title: z.string().trim().min(4, "Titre trop court").max(160),
  description: z.string().trim().min(10, "Décrivez le besoin en quelques mots").max(8000),
});

/** Champs de qualification, réservés au support. */
export const triageSupportRequestSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  // Chaîne ISO ; null efface l'échéance.
  dueAt: z.string().datetime().nullable().optional(),
});

export const assignSupportRequestSchema = z.object({
  id: z.string().min(1),
  // null = remettre la demande dans la file non assignée.
  assigneeId: z.string().min(1).nullable(),
});

export const changeSupportRequestStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(STATUSES),
  // Obligatoire côté serveur pour RESOLVED et REJECTED (voir l'action).
  resolutionNote: z.string().trim().max(4000).nullable().optional(),
});

export const commentSupportRequestSchema = z.object({
  id: z.string().min(1),
  content: z.string().trim().min(1, "Message vide").max(4000),
  // Note interne au support : jamais renvoyée au demandeur.
  isInternal: z.boolean().default(false),
});

export const convertSupportRequestToTaskSchema = z.object({
  id: z.string().min(1),
  // Sprint cible ; absent = backlog.
  sprintId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

export const deleteSupportAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
});

/** Filtres de la file support (query params). */
export const supportQueueFilterSchema = z.object({
  status: z.enum([...STATUSES, "OPEN", "ALL"]).default("OPEN"),
  category: z.enum([...CATEGORIES, "ALL"]).default("ALL"),
  priority: z.enum([...PRIORITIES, "ALL"]).default("ALL"),
  assignee: z.string().min(1).default("ALL"),
  q: z.string().trim().max(120).optional(),
});

export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;
export type TriageSupportRequestInput = z.infer<typeof triageSupportRequestSchema>;
export type AssignSupportRequestInput = z.infer<typeof assignSupportRequestSchema>;
export type ChangeSupportRequestStatusInput = z.infer<typeof changeSupportRequestStatusSchema>;
export type CommentSupportRequestInput = z.infer<typeof commentSupportRequestSchema>;
export type ConvertSupportRequestToTaskInput = z.infer<
  typeof convertSupportRequestToTaskSchema
>;
export type SupportQueueFilter = z.infer<typeof supportQueueFilterSchema>;
