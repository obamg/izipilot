import { z } from "zod";

// ── Create Action ───────────────────────────────────────────────────────
export const createActionSchema = z.object({
  krId: z.string(),
  title: z.string().min(2).max(200),
  description: z.string().max(500).nullable().optional(),
  assigneeId: z.string(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().nullable().optional(),
});

// ── Update Action ───────────────────────────────────────────────────────
export const updateActionSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  assigneeId: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().nullable().optional(),
});

// ── Bulk Status Update (weekly form) ────────────────────────────────────
export const bulkActionStatusSchema = z.object({
  updates: z.array(
    z.object({
      actionId: z.string(),
      status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]),
    })
  ).min(1).max(50),
});

// ── Action Comment ──────────────────────────────────────────────────────
export const createActionCommentSchema = z.object({
  content: z.string().min(1).max(2000),
});
