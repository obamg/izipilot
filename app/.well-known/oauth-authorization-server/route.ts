import { getOAuthIssuer } from "@/lib/oauth-config";

// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// claude.ai (and the official Anthropic Connector flow) hit this URL
// to discover where to register, authorize, and exchange tokens.

export const dynamic = "force-static";

export function GET() {
  const issuer = getOAuthIssuer();
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    scopes_supported: ["mcp"],
    service_documentation: `${issuer}/settings/claude`,
  });
}
