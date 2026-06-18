import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { dcrRequestSchema } from "@/lib/validations/oauth";

// RFC 7591 — Dynamic Client Registration. Unauthenticated by design:
// any caller (claude.ai's connector, Claude Code's MCP client) can self-
// register. Per-user binding happens later at the consent step in
// /oauth/authorize — at registration time we have no user context.

function makeOpaqueId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = dcrRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_client_metadata",
        error_description: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 }
    );
  }

  const meta = parsed.data;
  const clientId = makeOpaqueId(24); // ~32 chars base64url
  const clientSecret = makeOpaqueId(48); // ~64 chars base64url
  const clientSecretHash = await bcrypt.hash(clientSecret, 12);

  // claude.ai DCR omits `client_name` in some flows — fall back to a label
  // that still identifies the registration in admin tooling.
  const clientName = meta.client_name?.trim() || "Claude MCP client";

  const created = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash,
      clientName,
      redirectUris: meta.redirect_uris,
      tokenEndpointAuthMethod: meta.token_endpoint_auth_method ?? "client_secret_post",
      grantTypes: meta.grant_types ?? ["authorization_code", "refresh_token"],
      responseTypes: meta.response_types ?? ["code"],
      scope: meta.scope ?? "mcp",
    },
  });

  return Response.json(
    {
      client_id: created.clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
      // 0 = never expires; we revoke by deleting the client row.
      client_secret_expires_at: 0,
      client_name: created.clientName,
      redirect_uris: created.redirectUris,
      token_endpoint_auth_method: created.tokenEndpointAuthMethod,
      grant_types: created.grantTypes,
      response_types: created.responseTypes,
      scope: created.scope,
    },
    { status: 201 }
  );
}
