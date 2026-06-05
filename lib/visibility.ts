import type { UserRole } from "@prisma/client";

/**
 * Department code whose OKRs are confidential — visible only to CEO and
 * MANAGEMENT. Per IziPilot org structure, D7 is the Management department.
 *
 * IMPORTANT: this is *not* a security boundary against another tenant —
 * `orgId` scoping still handles multi-tenant isolation. This module hides
 * a specific *intra-org* slice of OKRs from POs and VIEWERs.
 *
 * All helpers return Prisma `where` fragments designed to be spread into
 * an existing where-clause. They are no-ops for CEO/MANAGEMENT so callers
 * can apply them unconditionally without branching.
 */
export const MANAGEMENT_DEPT_CODE = "D7";

const PRIVILEGED_ROLES: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT"];

export function canSeeManagementOkrs(role: UserRole): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

// Objectives belong to either a product OR a department. We hide only the
// department-OKRs of D7 — product-OKRs and other-department-OKRs stay
// visible. Each helper builds a fresh object so Prisma's mutable
// WhereInput types accept it without `readonly` friction.
function hideD7Objective() {
  return {
    OR: [
      { departmentId: null }, // product-OKR — always visible
      { department: { code: { not: MANAGEMENT_DEPT_CODE } } },
    ],
  };
}

export function objectiveVisibilityWhere(role: UserRole) {
  return canSeeManagementOkrs(role) ? {} : hideD7Objective();
}

export function krVisibilityWhere(role: UserRole) {
  if (canSeeManagementOkrs(role)) return {};
  return { objective: hideD7Objective() };
}

export function actionVisibilityWhere(role: UserRole) {
  if (canSeeManagementOkrs(role)) return {};
  return { keyResult: { objective: hideD7Objective() } };
}

export function alertVisibilityWhere(role: UserRole) {
  if (canSeeManagementOkrs(role)) return {};
  return { keyResult: { objective: hideD7Objective() } };
}

export function departmentVisibilityWhere(role: UserRole) {
  if (canSeeManagementOkrs(role)) return {};
  return { code: { not: MANAGEMENT_DEPT_CODE } };
}
