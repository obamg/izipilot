import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ConnectClaudeCard } from "./ConnectClaudeCard";

export default async function ConnectClaudePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL ?? "https://mcp.izipilot.com/mcp";

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="font-serif text-[20px] text-dark">Connecter Claude</h1>
        <p className="text-[11px] text-izi-gray mt-0.5">
          G&eacute;n&eacute;rez un jeton MCP pour brancher Claude Desktop ou
          Claude Code &agrave; IziPilot. Le jeton expire au bout d&rsquo;1h
          &mdash; vous pouvez en regenerer un &agrave; tout moment.
        </p>
      </div>

      <ConnectClaudeCard mcpUrl={mcpUrl} />
    </div>
  );
}
