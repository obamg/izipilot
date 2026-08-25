import { z } from "zod";

// Shared enums (reuse the Action enums — same columns / priorities).
const sprintStatusEnum = z.enum([
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);
const taskStatusEnum = z.enum([
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);
const taskPriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

// Lien vers un rapport de tâche. "" → null pour faciliter le formulaire.
const reportUrlSchema = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().url().max(2048).nullable()
  )
  .optional();

// ── Sprint ─────────────────────────────────────────────────────────────────
export const createSprintSchema = z.object({
  name: z.string().min(2).max(120),
  goal: z.string().max(1000).nullable().optional(),
  startDate: z.string().min(1), // ISO date string — coerced in the route
  endDate: z.string().min(1),
});

export const updateSprintSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  goal: z.string().max(1000).nullable().optional(),
  status: sprintStatusEnum.optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
});

// ── Sprint task ──────────────────────────────────────────────────────────────
export const createSprintTaskSchema = z.object({
  sprintId: z.string().nullable().optional(), // null/absent → backlog
  krId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).nullable().optional(),
  reportUrl: reportUrlSchema,
  assigneeId: z.string().nullable().optional(),
  priority: taskPriorityEnum.default("MEDIUM"),
  storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export const updateSprintTaskSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  reportUrl: reportUrlSchema,
  // Déplacement sur le tableau : columnId est la forme préférée — la route en
  // dérive le statut depuis la catégorie de la colonne, pour que le libellé et
  // la sémantique ne puissent pas diverger. `status` reste accepté pour les
  // tâches sans colonne (flux dépourvu de cette catégorie) et pour l'API.
  columnId: z.string().nullable().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  krId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(), // move between sprint ↔ backlog
  sortOrder: z.number().int().min(0).optional(),
  dueDate: z.string().nullable().optional(),
});

// Lightweight schema for board drag (status + position only).
export const moveSprintTaskSchema = z.object({
  status: taskStatusEnum,
  sortOrder: z.number().int().min(0).optional(),
});

// ── Capacity ─────────────────────────────────────────────────────────────────
export const setCapacitySchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string(),
        capacityPoints: z.number().int().min(0).max(1000),
        notes: z.string().max(300).nullable().optional(),
      })
    )
    .max(100),
});

// ── Comment ──────────────────────────────────────────────────────────────────
export const createSprintTaskCommentSchema = z.object({
  content: z.string().min(1).max(2000),
});

// ── Task request (Demande) ───────────────────────────────────────────────────
const requestKindEnum = z.enum(["INPUT", "REVIEW", "APPROVAL", "DATA", "OTHER"]);

// Exactly one target — a teammate OR a team (dept/product).
export const createTaskRequestSchema = z
  .object({
    kind: requestKindEnum.default("INPUT"),
    message: z.string().min(2).max(2000),
    targetUserId: z.string().nullable().optional(),
    targetDepartmentId: z.string().nullable().optional(),
    targetProductId: z.string().nullable().optional(),
  })
  .refine(
    (d) =>
      [d.targetUserId, d.targetDepartmentId, d.targetProductId].filter(Boolean)
        .length === 1,
    { message: "Exactement une cible (personne, département ou produit) est requise." }
  );

// Target résout/refuse, or requester annule.
export const resolveTaskRequestSchema = z.object({
  status: z.enum(["RESOLVED", "DECLINED", "CANCELLED"]),
  resolutionNote: z.string().max(2000).nullable().optional(),
});

// ── Task step (Étape / checklist) ────────────────────────────────────────────
export const createTaskStepSchema = z.object({
  title: z.string().min(1).max(200),
});

export const updateTaskStepSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  done: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// ── Recurring task (Tâche récurrente) ────────────────────────────────────────
const recurrenceFrequencyEnum = z.enum(["DAILY", "WEEKLY", "MONTHLY", "PER_SPRINT"]);

// WEEKLY needs a weekday (0=dim..6=sam); MONTHLY needs a day-of-month (1..28,
// capped so it exists every month). Enforced by the refine below.
const recurrenceFields = {
  frequency: recurrenceFrequencyEnum,
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  monthDay: z.number().int().min(1).max(28).nullable().optional(),
};

function requireCadenceParams(
  d: { frequency: string; weekday?: number | null; monthDay?: number | null },
  ctx: z.RefinementCtx
) {
  if (d.frequency === "WEEKLY" && (d.weekday === null || d.weekday === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["weekday"],
      message: "Choisissez un jour de la semaine.",
    });
  }
  if (d.frequency === "MONTHLY" && (d.monthDay === null || d.monthDay === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["monthDay"],
      message: "Choisissez un jour du mois.",
    });
  }
}

export const createRecurringTaskSchema = z
  .object({
    title: z.string().min(2).max(200),
    description: z.string().max(2000).nullable().optional(),
    krId: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
    productId: z.string().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    priority: taskPriorityEnum.default("MEDIUM"),
    storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
    ...recurrenceFields,
  })
  .superRefine(requireCadenceParams);

// Update: any field optional, plus isActive to pause/resume. When a recurrence
// field is present the route recomputes nextRunAt.
export const updateRecurringTaskSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    krId: z.string().nullable().optional(),
    departmentId: z.string().nullable().optional(),
    productId: z.string().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    priority: taskPriorityEnum.optional(),
    storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
    frequency: recurrenceFrequencyEnum.optional(),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    monthDay: z.number().int().min(1).max(28).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    // Only enforce cadence params when the frequency itself is being set.
    if (d.frequency) requireCadenceParams({ ...d, frequency: d.frequency }, ctx);
  });

// ── Daily standup ────────────────────────────────────────────────────────────
export const submitStandupSchema = z.object({
  yesterday: z.string().max(2000).nullable().optional(),
  today: z.string().max(2000).nullable().optional(),
  blockers: z.string().max(2000).nullable().optional(),
});
