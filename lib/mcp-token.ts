import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

// Shared HS256 access-token minter for both the legacy "Connecter Claude"
// paste-token flow (/api/mcp/token) and the OAuth 2.1 token endpoint
// (/api/oauth/token). The MCP server only knows how to verify HS256 JWTs
// with this exact issuer/audience pair, so all paths must go through here.

export const MCP_TOKEN_TTL_SECONDS = 60 * 60; // 1h
export const MCP_ISSUER = process.env.MCP_JWT_ISSUER || "izipilot";
export const MCP_AUDIENCE = process.env.MCP_JWT_AUDIENCE || "izipilot-mcp";

export function mcpSecretKey(): Uint8Array {
  const raw = process.env.MCP_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("MCP_JWT_SECRET is missing or too short (need ≥ 32 chars)");
  }
  return new TextEncoder().encode(raw);
}

export interface MintMcpTokenInput {
  userId: string;
  orgId: string;
  role: UserRole;
  ttlSeconds?: number;
}

export async function mintMcpAccessToken(input: MintMcpTokenInput): Promise<string> {
  const ttl = input.ttlSeconds ?? MCP_TOKEN_TTL_SECONDS;
  return new SignJWT({
    org: input.orgId,
    role: input.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuer(MCP_ISSUER)
    .setAudience(MCP_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(mcpSecretKey());
}

/**
 * Verify an MCP access token presented as `Authorization: Bearer …` to an app
 * route (the MCP server forwards writes here so they run the exact same code
 * as the web form). Same rules as mcp-server/src/auth.ts: signature, active
 * account, same org, not issued before the last password change. Returns the
 * caller with the role read from the DB, or null.
 */
export async function verifyMcpBearer(
  authHeader: string | null
): Promise<{ id: string; orgId: string; role: UserRole } | null> {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7).trim(), mcpSecretKey(), {
      issuer: MCP_ISSUER,
      audience: MCP_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.org !== "string") return null;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        orgId: true,
        role: true,
        isActive: true,
        passwordChangedAt: true,
        mustChangePassword: true,
      },
    });
    if (!user || !user.isActive || user.orgId !== payload.org) return null;
    // Same rule as the web middleware: no writes while on a default password.
    if (user.mustChangePassword) return null;
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    if (user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > iat) {
      return null;
    }
    return { id: user.id, orgId: user.orgId, role: user.role };
  } catch {
    return null;
  }
}
