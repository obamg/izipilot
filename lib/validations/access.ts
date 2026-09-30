import { z } from "zod";

// ── Rôles du module ──────────────────────────────────────────────────────
const ASSIGNABLE_ROLES = [
  "IT_ACCESS_OPERATOR", "HR", "CISO", "COO", "ASSET_ADMINISTRATOR", "AUDIT_VIEWER",
] as const;

export const upsertRoleAssignmentSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
  userId: z.string().min(1),
  backupUserId: z.string().min(1).nullable().optional(),
});

export const setPrimaryUnavailableSchema = z.object({
  primaryUnavailable: z.boolean(),
});

export const setPrimaryDepartmentSchema = z.object({
  primaryDepartmentId: z.string().min(1),
});

// ── Catalogue ─────────────────────────────────────────────────────────────
export const createAssetSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(1000).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  backupOwnerId: z.string().nullable().optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  backupOwnerId: z.string().nullable().optional(),
  requestsEnabled: z.boolean().optional(),
});

export const createLevelSchema = z.object({
  name: z.string().min(1).max(100),
  priority: z.number().int().positive().nullable().optional(),
  isAdmin: z.boolean().nullable().optional(),
});

export const updateLevelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  priority: z.number().int().positive().nullable().optional(),
  isAdmin: z.boolean().nullable().optional(),
  enabled: z.boolean().optional(),
});

// ── Registre — vues de lecture (phase 2b) ────────────────────────────────
// Un formulaire GET envoie "" pour l'option « Toutes » : on la traite comme
// absente plutôt que de faire échouer toute la requête.
// (.optional().transform plutôt que z.preprocess : en Zod 4, un preprocess
// autour d'un champ optionnel peut rendre la clé obligatoire.)
const optionalId = z
  .string()
  .max(64)
  .optional()
  .transform((v) => (v ? v : undefined));

export const registerQuerySchema = z.object({
  view: z.enum(["me", "department", "owned-assets"]).default("me"),
  departmentId: optionalId,
  assetId: optionalId,
  levelId: optionalId,
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type RegisterQuery = z.infer<typeof registerQuerySchema>;

// ── Exécution des demandes (phase 3b) ────────────────────────────────────
// Corps des routes /api/access/tasks/**. Les contrôles qui exigent la base
// (date ≥ prise en charge − 1 jour, méthode requise pour un changement de
// niveau) restent dans le service (validateCompletionInput, completeTask).
const expectedRevision = z.number().int().min(1);
const taskReason = z.string().trim().min(3).max(1000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const completedAtField = z
  .string()
  .datetime()
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, {
    message: "La date d'exécution ne peut pas être dans le futur",
  });

const EVIDENCE_REQUIRED = "Une référence ou une note d'exécution est obligatoire";
const hasEvidence = (b: { reference: string | null; note: string | null }) => b.reference !== null || b.note !== null;

const completionFields = z.object({
  completedAt: completedAtField,
  reference: optionalText(200),
  note: optionalText(2000),
  method: z.enum(["DIRECT", "REMOVE_THEN_GRANT"]).optional(),
  expectedRevision,
});

export const taskRevisionSchema = z.object({ expectedRevision });

export const handoverTaskSchema = z.object({
  toUserId: z.string().min(1).max(64),
  reason: taskReason,
  expectedRevision,
});

export const blockTaskSchema = z.object({
  reason: taskReason,
  facts: optionalText(2000),
  expectedRevision,
});

export const reconcileTaskSchema = z.object({ reason: taskReason, expectedRevision });

export const completeTaskSchema = completionFields
  .extend({ partialRemovalOnly: z.boolean().default(false) })
  .refine(hasEvidence, { message: EVIDENCE_REQUIRED, path: ["reference"] });

export const claimBatchSchema = z.object({
  items: z
    .array(z.object({ taskId: z.string().min(1).max(64), expectedRevision }))
    .min(1)
    .max(100),
});

export const completeBatchSchema = z.object({
  items: z
    .array(
      completionFields
        .extend({ taskId: z.string().min(1).max(64) })
        // Strict : `partialRemovalOnly` (ou toute clé inconnue) doit être refusé, pas ignoré en silence.
        .strict()
        .refine(hasEvidence, { message: EVIDENCE_REQUIRED, path: ["reference"] })
    )
    .min(1)
    .max(100),
});

export const taskListQuerySchema = z.object({
  view: z.enum(["mine", "oversight"]).default("mine"),
  state: z.enum(["open", "history"]).default("open"),
  assetId: optionalId,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CompleteTaskBody = z.infer<typeof completeTaskSchema>;
export type TaskListQueryInput = z.infer<typeof taskListQuerySchema>;
