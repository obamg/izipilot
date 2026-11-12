import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetDashboard } from "./getDashboard.js";
import { registerListBlockedKrs } from "./listBlockedKrs.js";
import { registerGetOkrHistory } from "./getOkrHistory.js";
import { registerSubmitWeeklyEntry } from "./submitWeeklyEntry.js";
import { registerSubmitDailyReport } from "./submitDailyReport.js";
import { registerListSprintTasks } from "./listSprintTasks.js";
import { registerCreateSprintTask } from "./createSprintTask.js";
import { registerUpdateTaskStatus } from "./updateTaskStatus.js";
import { getCaller } from "../context.js";

export function registerTools(server: McpServer) {
  registerGetDashboard(server);
  registerListBlockedKrs(server);
  registerGetOkrHistory(server);
  registerSubmitWeeklyEntry(server);
  registerSubmitDailyReport(server);
  registerListSprintTasks(server);
  registerCreateSprintTask(server);
  registerUpdateTaskStatus(server);
}

// Prod: http://izipilot-app-1:3000 — explicit container name, because the
// "app" alias on the shared web network also matches the staging app.
const APP_URL = process.env.MCP_APP_URL?.replace(/\/$/, "");

/**
 * Calls an app API route with the caller's Bearer token, so writes run the
 * app's own code (permissions, scores, alerts) instead of a copy here.
 * Returns the route's `data`, or throws its error message.
 */
export async function callApp<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!APP_URL) throw new Error("MCP_APP_URL is not configured on the MCP server");
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      Authorization: `Bearer ${getCaller().token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
    details?: Record<string, string[]>;
  };
  if (!res.ok || json.data === undefined) {
    const details = json.details ? ` ${JSON.stringify(json.details)}` : "";
    throw new Error((json.error ?? `App returned HTTP ${res.status}`) + details);
  }
  return json.data;
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
