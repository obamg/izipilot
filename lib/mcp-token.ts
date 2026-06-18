import { SignJWT } from "jose";
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
