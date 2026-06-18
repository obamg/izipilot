import { getMcpResourceUrl, getOAuthIssuer } from "@/lib/oauth-config";

// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
// The MCP server's WWW-Authenticate header points clients here so they can
// discover which authorization server protects /mcp.
//
// Must stay dynamic — resource and authorization_servers URLs are read
// from env at request time so the metadata always matches the actual
// public origin without requiring a rebuild after env changes.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    resource: getMcpResourceUrl(),
    authorization_servers: [getOAuthIssuer()],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${getOAuthIssuer()}/settings/claude`,
  });
}
