import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetDashboard } from "./getDashboard.js";
import { registerListBlockedKrs } from "./listBlockedKrs.js";
import { registerGetOkrHistory } from "./getOkrHistory.js";
import { registerSubmitWeeklyEntry } from "./submitWeeklyEntry.js";

export function registerTools(server: McpServer) {
  registerGetDashboard(server);
  registerListBlockedKrs(server);
  registerGetOkrHistory(server);
  registerSubmitWeeklyEntry(server);
}

/** Format a JSON payload as an MCP text content block. */
export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Format an error so Claude sees a structured failure rather than a crash. */
export function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
