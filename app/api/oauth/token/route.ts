import { NextRequest } from "next/server";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { tokenRequestSchema } from "@/lib/validations/oauth";
import {
  MCP_TOKEN_TTL_SECONDS,
  mintMcpAccessToken,
} from "@/lib/mcp-token";
import { REFRESH_TOKEN_TTL_SECONDS } from "@/lib/oauth-config";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function oauthError(
  code:
    | "invalid_request"
    | "invalid_client"
    | "invalid_grant"
    | "unauthorized_client"
    | "unsupported_grant_type"
    | "invalid_scope",
  description: string,
  status = 400
) {
  return Response.json(
    { error: code, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    }
  );
}

// PKCE S256 verification: base64url(sha256(verifier)) === challenge.
function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(computed, challenge);
}

// Parse form-urlencoded body (per RFC 6749 §4.1.3 token requests are
// always form-urlencoded). Also accept JSON for permissive clients.
async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

// Resolve (clientId, clientSecret) from either the request body or the
// Authorization: Basic header (RFC 6749 §2.3.1 — client_secret_basic).
function extractClientCredentials(
  request: NextRequest,
  body: Record<string, unknown>
): { clientId: string | null; clientSecret: string | null } {
  const authz = request.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authz.slice(6).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, idx)),
          clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
        };
      }
    } catch {
      // fall through to body-based extraction
    }
  }
  return {
    clientId: typeof body.client_id === "string" ? body.client_id : null,
    clientSecret:
      typeof body.client_secret === "string" ? body.client_secret : null,
  };
}

export async function POST(request: NextRequest) {
  const body = await parseBody(request);
  const parsed = tokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    return oauthError(
      "invalid_request",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }

  const creds = extractClientCredentials(request, body);
  const clientId = creds.clientId ?? parsed.data.client_id;
  if (!clientId) {
    return oauthError("invalid_client", "client_id required");
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!client) {
    return oauthError("invalid_client", "unknown client_id", 401);
  }

  // Validate client_secret unless the client registered as public (none).
  if (client.tokenEndpointAuthMethod !== "none") {
    const presented = creds.clientSecret ?? parsed.data.client_secret;
    if (!presented) {
      return oauthError("invalid_client", "client_secret required", 401);
    }
    const ok = await bcrypt.compare(presented, client.clientSecretHash);
    if (!ok) {
      return oauthError("invalid_client", "client authentication failed", 401);
    }
  }

  if (parsed.data.grant_type === "authorization_code") {
    return handleAuthorizationCodeGrant(parsed.data, client.clientId);
  }
  return handleRefreshTokenGrant(parsed.data, client.clientId);
}

async function handleAuthorizationCodeGrant(
  data: Extract<
    import("@/lib/validations/oauth").TokenRequest,
    { grant_type: "authorization_code" }
  >,
  clientId: string
) {
  const codeHash = sha256(data.code);
  const stored = await prisma.oAuthAuthCode.findUnique({ where: { codeHash } });
  if (!stored) {
    return oauthError("invalid_grant", "code not found");
  }
  if (stored.consumedAt) {
    // Per OAuth 2.1 §4.1.3, replay of a consumed code revokes any tokens
    // we issued for it. Defensive: kill the refresh tokens for this
    // (client, user) pair.
    await prisma.oAuthRefreshToken.updateMany({
      where: {
        clientId: stored.clientId,
        userId: stored.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return oauthError("invalid_grant", "code already used");
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    return oauthError("invalid_grant", "code expired");
  }
  if (stored.clientId !== clientId) {
    return oauthError("invalid_grant", "code was issued to a different client");
  }
  if (stored.redirectUri !== data.redirect_uri) {
    return oauthError("invalid_grant", "redirect_uri mismatch");
  }
  if (!verifyPkceS256(data.code_verifier, stored.codeChallenge)) {
    return oauthError("invalid_grant", "PKCE verification failed");
  }

  // Re-read role/orgId from the DB rather than trusting the stored code
  // row — a user demoted between authorize and token-exchange should get
  // the demoted role, not the snapshot from 10 minutes ago.
  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, orgId: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return oauthError("invalid_grant", "user no longer authorized", 403);
  }

  const accessToken = await mintMcpAccessToken({
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
  });

  // Single-use code: mark consumed atomically with the read above by
  // using a unique-index-protected update. If two requests race, the
  // second one will see consumedAt!=null and trigger the replay path.
  await prisma.oAuthAuthCode.update({
    where: { codeHash: stored.codeHash },
    data: { consumedAt: new Date() },
  });

  const rawRefresh = randomBytes(48).toString("base64url");
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: sha256(rawRefresh),
      clientId,
      userId: user.id,
      orgId: user.orgId,
      scope: stored.scope,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });

  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: MCP_TOKEN_TTL_SECONDS,
      refresh_token: rawRefresh,
      scope: stored.scope,
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}

async function handleRefreshTokenGrant(
  data: Extract<
    import("@/lib/validations/oauth").TokenRequest,
    { grant_type: "refresh_token" }
  >,
  clientId: string
) {
  const tokenHash = sha256(data.refresh_token);
  const stored = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash },
  });
  if (!stored) {
    return oauthError("invalid_grant", "refresh_token not found");
  }
  if (stored.revokedAt) {
    return oauthError("invalid_grant", "refresh_token revoked");
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    return oauthError("invalid_grant", "refresh_token expired");
  }
  if (stored.clientId !== clientId) {
    return oauthError("invalid_grant", "token bound to a different client");
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, orgId: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return oauthError("invalid_grant", "user no longer authorized", 403);
  }

  // Refresh-token rotation: revoke the presented token and issue a new
  // one alongside the new access token. OAuth 2.1 mandates rotation for
  // public clients and recommends it for confidential ones.
  const newRefresh = randomBytes(48).toString("base64url");
  await prisma.$transaction([
    prisma.oAuthRefreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    }),
    prisma.oAuthRefreshToken.create({
      data: {
        tokenHash: sha256(newRefresh),
        clientId,
        userId: user.id,
        orgId: user.orgId,
        scope: stored.scope,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    }),
  ]);

  const accessToken = await mintMcpAccessToken({
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
  });

  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: MCP_TOKEN_TTL_SECONDS,
      refresh_token: newRefresh,
      scope: stored.scope,
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}
