import { z } from "zod";

// ── Users ────────────────────────────────────────────────────────────────
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.enum(["CEO", "MANAGEMENT", "PO", "VIEWER"]),
  password: z.string().min(8).max(128),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(["CEO", "MANAGEMENT", "PO", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

// ── Organization ─────────────────────────────────────────────────────────
export const updateOrgSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  plan: z.enum(["FREE", "PRO", "ENTERPRISE"]).optional(),
});

// ── Products ─────────────────────────────────────────────────────────────
export const createProductSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(2).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["ACTIVE", "IN_DEVELOPMENT", "PLANNED", "PAUSED"]),
  ownerId: z.string(),
});

export const updateProductSchema = z.object({
  code: z.string().min(1).max(10).optional(),
  name: z.string().min(2).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["ACTIVE", "IN_DEVELOPMENT", "PLANNED", "PAUSED"]).optional(),
  ownerId: z.string().optional(),
  isActive: z.boolean().optional(),
});

// ── Departments ──────────────────────────────────────────────────────────
export const createDepartmentSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(2).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(500).nullable().optional(),
  ownerId: z.string(),
});

export const updateDepartmentSchema = z.object({
  code: z.string().min(1).max(10).optional(),
  name: z.string().min(2).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  description: z.string().max(500).nullable().optional(),
  ownerId: z.string().optional(),
  isActive: z.boolean().optional(),
});

// ── Objectives ───────────────────────────────────────────────────────────
export const createObjectiveSchema = z.object({
  title: z.string().min(2).max(200),
  why: z.string().max(500).nullable().optional(),
  entityType: z.enum(["DEPARTMENT", "PRODUCT"]),
  departmentId: z.string().optional(),
  productId: z.string().optional(),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  year: z.number().int().min(2024).max(2030),
}).refine(
  (data) => {
    if (data.entityType === "DEPARTMENT") return !!data.departmentId;
    if (data.entityType === "PRODUCT") return !!data.productId;
    return false;
  },
  { message: "departmentId or productId must match entityType" }
);

export const updateObjectiveSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  why: z.string().max(500).nullable().optional(),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
  year: z.number().int().min(2024).max(2030).optional(),
  isActive: z.boolean().optional(),
});

// ── Key Results ──────────────────────────────────────────────────────────
export const createKeyResultSchema = z.object({
  objectiveId: z.string(),
  title: z.string().min(2).max(200),
  krType: z.enum(["NUMERIC", "PERCENTAGE", "DATE", "BINARY"]),
  target: z.number().nullable().optional(),
  targetUnit: z.string().max(50).nullable().optional(),
  targetDate: z.string().max(50).nullable().optional(),
  ownerId: z.string(),
});

export const updateKeyResultSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  krType: z.enum(["NUMERIC", "PERCENTAGE", "DATE", "BINARY"]).optional(),
  target: z.number().nullable().optional(),
  targetUnit: z.string().max(50).nullable().optional(),
  targetDate: z.string().max(50).nullable().optional(),
  ownerId: z.string().optional(),
  isActive: z.boolean().optional(),
});
