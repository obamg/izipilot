import { z } from "zod";

// ── Rôles du module ──────────────────────────────────────────────────────
const ASSIGNABLE_ROLES = [
  "IT_ACCESS_OPERATOR", "HR", "CISO", "COO", "ASSET_ADMINISTRATOR", "AUDIT_VIEWER",
] as const;

export const upsertRoleAssignmentSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
  userId: z.string().min(1),
  backupUserId: z.string().nullable().optional(),
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
