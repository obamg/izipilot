// Single source of truth for OAuth issuer URLs. The auth server, resource
// server, and consent UI all live on the same origin (the Next.js app). The
// MCP resource is at /mcp on that same origin (nginx routes it to the
// mcp-server container).

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export function getOAuthIssuer(): string {
  const base =
    process.env.OAUTH_ISSUER ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return trimTrailingSlash(base);
}

export function getMcpResourceUrl(): string {
  return `${getOAuthIssuer()}/mcp`;
}

export const OAUTH_SCOPES = ["mcp"] as const;
export const AUTH_CODE_TTL_SECONDS = 10 * 60; // 10 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
