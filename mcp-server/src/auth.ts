import { jwtVerify } from "jose";
import type { CallerContext, UserRole } from "./context.js";
import { prisma } from "./prisma.js";

const ROLES: ReadonlySet<UserRole> = new Set([
  "CEO",
  "MANAGEMENT",
  "PO",
  "CONTRIBUTOR",
  "VIEWER",
]);

function secretKey() {
  const raw = process.env.MCP_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "MCP_JWT_SECRET is missing or too short (need ≥ 32 chars). Refusing to start.",
    );
  }
  return new TextEncoder().encode(raw);
}

const ISSUER = process.env.MCP_JWT_ISSUER || "izipilot";
const AUDIENCE = process.env.MCP_JWT_AUDIENCE || "izipilot-mcp";

/**
 * Verify an MCP bearer JWT and extract the caller context.
 * Throws on any failure — never returns a partial / unauthenticated context.
 */
export async function verifyBearer(authHeader: string | undefined): Promise<CallerContext> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new Error("Missing bearer token");
  }
  const token = authHeader.slice(7).trim();

  const { payload } = await jwtVerify(token, secretKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });

  const userId = typeof payload.sub === "string" ? payload.sub : null;
  const orgId = typeof payload.org === "string" ? payload.org : null;
  const role = typeof payload.role === "string" ? (payload.role as UserRole) : null;

  if (!userId || !orgId || !role || !ROLES.has(role)) {
    throw new Error("Invalid JWT claims");
  }

  // Tokens live up to 1h: re-check the account on every request so a
  // deactivated user (or one moved to another org) loses access at once,
  // and a role change applies immediately (the DB role wins over the claim).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, orgId: true, role: true, passwordChangedAt: true },
  });
  if (!user || !user.isActive || user.orgId !== orgId) {
    throw new Error("User no longer authorized");
  }
  // Password changed after this token was minted → revoked (same rule as web
  // sessions in lib/auth.ts). Second granularity: iat is in seconds.
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  if (user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > iat) {
    throw new Error("Token revoked (password changed)");
  }

  return { userId, orgId, role: user.role as UserRole, token };
}
