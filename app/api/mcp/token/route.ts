import { SignJWT } from "jose";
import { auth } from "@/lib/auth";

// Short-lived bearer token for the IziPilot MCP server.
// The MCP server has no access to the NextAuth JWE session, so we mint a
// dedicated HS256 JWT carrying just userId / orgId / role.
//
// Rotation: tokens live 1h. The user can re-call this endpoint at any time
// from the in-app "Connect Claude" screen to get a fresh one.

const TTL_SECONDS = 60 * 60; // 1h
const ISSUER = process.env.MCP_JWT_ISSUER || "izipilot";
const AUDIENCE = process.env.MCP_JWT_AUDIENCE || "izipilot-mcp";

function secretKey() {
  const raw = process.env.MCP_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("MCP_JWT_SECRET is missing or too short");
  }
  return new TextEncoder().encode(raw);
}

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // VIEWER can read OKRs via MCP; only block accounts that are otherwise
  // disabled. Role-based tool gating happens inside the MCP server itself.
  const token = await new SignJWT({
    org: session.user.orgId,
    role: session.user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretKey());

  return Response.json({
    token,
    expiresIn: TTL_SECONDS,
    tokenType: "Bearer",
  });
}
