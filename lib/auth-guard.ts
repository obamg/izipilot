import { auth } from "./auth";
import type { UserRole } from "@prisma/client";

interface AccessOptions {
  roles?: UserRole[];
  orgId?: string;
  ownerId?: string;
}

/**
 * Object-level access control.
 * Checks session validity, org isolation, role, and ownership.
 * Throws if access is denied.
 */
export async function requireAccess(options: AccessOptions = {}) {
  const session = await auth();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const { roles, orgId, ownerId } = options;

  // Check org isolation
  if (orgId && session.user.orgId !== orgId) {
    throw new Error("Forbidden: organization mismatch");
  }

  // Check role
  if (roles && !roles.includes(session.user.role)) {
    throw new Error("Forbidden: insufficient role");
  }

  // Check ownership (PO can only modify their own resources)
  // CEO and MANAGEMENT bypass ownership checks
  if (
    ownerId &&
    session.user.role === "PO" &&
    session.user.id !== ownerId
  ) {
    throw new Error("Forbidden: not the owner");
  }

  return session;
}

/** Convenience: require at least PO role */
export async function requirePO() {
  return requireAccess({ roles: ["CEO", "MANAGEMENT", "PO"] });
}

/** Convenience: require Management or CEO */
export async function requireManagement() {
  return requireAccess({ roles: ["CEO", "MANAGEMENT"] });
}

/** Convenience: require CEO */
export async function requireCEO() {
  return requireAccess({ roles: ["CEO"] });
}
