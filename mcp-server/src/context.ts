import { AsyncLocalStorage } from "node:async_hooks";

export type UserRole = "CEO" | "MANAGEMENT" | "PO" | "VIEWER";

export interface CallerContext {
  userId: string;
  orgId: string;
  role: UserRole;
}

const storage = new AsyncLocalStorage<CallerContext>();

export function runWithCaller<T>(ctx: CallerContext, fn: () => Promise<T>) {
  return storage.run(ctx, fn);
}

export function getCaller(): CallerContext {
  const ctx = storage.getStore();
  if (!ctx) {
    // This should never happen — every tool runs inside runWithCaller.
    // If it does, fail closed rather than leaking data.
    throw new Error("No caller context — refusing to run tool");
  }
  return ctx;
}

interface AccessOptions {
  roles?: UserRole[];
  ownerId?: string;
}

/**
 * Mirrors lib/auth-guard.ts on the Next.js side. Validates that the caller
 * has one of the allowed roles and, when ownerId is provided, that a PO is
 * acting on their own resource. CEO and MANAGEMENT bypass ownership.
 * Throws if access is denied.
 */
export function requireAccess(opts: AccessOptions = {}): CallerContext {
  const caller = getCaller();

  if (opts.roles && !opts.roles.includes(caller.role)) {
    throw new Error("Forbidden: insufficient role");
  }

  if (
    opts.ownerId &&
    caller.role === "PO" &&
    caller.userId !== opts.ownerId
  ) {
    throw new Error("Forbidden: not the owner");
  }

  return caller;
}
