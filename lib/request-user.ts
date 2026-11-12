import { auth } from "@/lib/auth";
import { verifyMcpBearer } from "@/lib/mcp-token";

/**
 * Caller of an API route: web session, or an MCP access token forwarded by
 * the MCP server. A Bearer header means MCP ONLY: the middleware lets Bearer
 * requests skip its session gates (incl. mustChangePassword), so the cookie
 * must never be honoured on that path.
 */
export async function requestUser(request: Request) {
  const authz = request.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return verifyMcpBearer(authz);
  return (await auth())?.user ?? null;
}
