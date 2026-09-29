export type AccessModuleRole =
  | "IT_ACCESS_OPERATOR"
  | "HR"
  | "CISO"
  | "COO"
  | "ASSET_ADMINISTRATOR"
  | "AUDIT_VIEWER"
  | "DEPARTMENT_HEAD";

export interface RoleAssignmentLike {
  role: AccessModuleRole;
  userId: string | null;
  departmentId: string | null;
  backupUserId: string | null;
  primaryUnavailable: boolean;
}

export interface UserAvailability {
  userId: string;
  isActive: boolean;
  lifecycle: "ACTIVE" | "OFFBOARDING" | "DEPARTED" | null; // null = pas de profil (traité comme ACTIVE)
}

export interface ActingUser {
  userId: string;
  actsAsPrimary: boolean; // false = agit en tant que suppléant
}
