import { auth } from "@/lib/api-auth";
import { MCP_TOKEN_TTL_SECONDS, mintMcpAccessToken } from "@/lib/mcp-token";

// Legacy "Connecter Claude" paste-token endpoint.
// The OAuth 2.1 flow at /api/oauth/token is the supported path for claude.ai.
// This endpoint stays for Claude Code CLI users who copy-paste the token.

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await mintMcpAccessToken({
    userId: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
  });

  return Response.json({
    token,
    expiresIn: MCP_TOKEN_TTL_SECONDS,
    tokenType: "Bearer",
  });
}
