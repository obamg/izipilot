"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_CODE_TTL_SECONDS, OAUTH_SCOPES } from "@/lib/oauth-config";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function buildRedirect(base: string, params: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Server action for the consent form. We accept the OAuth params as hidden
// inputs because the page-level GET already validated them; we re-check the
// client + redirect_uri here as defense in depth.
export async function approveAuthorization(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/oauth/authorize");
  }

  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const codeChallengeMethod = String(formData.get("code_challenge_method") ?? "");
  const scopeRaw = String(formData.get("scope") ?? "mcp");
  const state = String(formData.get("state") ?? "");
  const decision = String(formData.get("decision") ?? "deny");

  // Validate redirect_uri matches the registered set so an attacker can't
  // submit a tampered form payload pointing to an external URL.
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });
  if (!client || !client.redirectUris.includes(redirectUri)) {
    // No safe redirect — fall back to a server-rendered error page.
    redirect("/oauth/authorize/error?reason=invalid_client");
  }

  if (decision !== "approve") {
    const params: Record<string, string> = {
      error: "access_denied",
      error_description: "The user denied the authorization request.",
    };
    if (state) params.state = state;
    redirect(buildRedirect(redirectUri!, params));
  }

  // Filter scopes to those we support (MCP is currently the only scope).
  const requestedScopes = scopeRaw.split(/\s+/).filter(Boolean);
  const grantedScopes = requestedScopes.filter((s) =>
    (OAUTH_SCOPES as readonly string[]).includes(s)
  );
  if (grantedScopes.length === 0) grantedScopes.push("mcp");

  // Code is opaque random + sha256-at-rest. Short TTL (10min) so leaking a
  // browser-history URL has narrow blast radius.
  const rawCode = randomBytes(32).toString("base64url");
  const codeHash = sha256(rawCode);

  await prisma.oAuthAuthCode.create({
    data: {
      codeHash,
      clientId,
      userId: session!.user.id,
      orgId: session!.user.orgId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod || "S256",
      scope: grantedScopes.join(" "),
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
    },
  });

  const params: Record<string, string> = { code: rawCode };
  if (state) params.state = state;
  redirect(buildRedirect(redirectUri!, params));
}
