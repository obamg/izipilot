import { getMcpResourceUrl, getOAuthIssuer } from "@/lib/oauth-config";

// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
// The MCP server's WWW-Authenticate header points clients here so they can
// discover which authorization server protects /mcp.

export const dynamic = "force-static";

export function GET() {
  return Response.json({
    resource: getMcpResourceUrl(),
    authorization_servers: [getOAuthIssuer()],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${getOAuthIssuer()}/settings/claude`,
  });
}
