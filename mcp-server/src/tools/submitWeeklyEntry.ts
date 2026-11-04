import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCaller } from "../context.js";
import { errorResult, jsonResult } from "./index.js";

const input = {
  krId: z.string().min(1),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2024).max(2030),
  progress: z.number().min(0).max(1),
  status: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED", "NOT_STARTED"]),
  blocker: z.string().max(2000).optional(),
  proposedSolution: z.string().max(2000).optional(),
  actionNeeded: z.string().max(2000).optional(),
  comment: z.string().max(4000).optional(),
};

// Prod: http://izipilot-app-1:3000 — explicit container name, because the
// "app" alias on the shared web network also matches the staging app.
const APP_URL = process.env.MCP_APP_URL?.replace(/\/$/, "");

export function registerSubmitWeeklyEntry(server: McpServer) {
  server.registerTool(
    "submit_weekly_entry",
    {
      title: "Submit weekly entry",
      description:
        "Records the weekly entry for one KR, exactly like the web form: same score calculation (inverse/binary/date KRs), same deadline (PO and CONTRIBUTOR locked after Monday 23:59), same permissions (PO: own KRs; CONTRIBUTOR: own department; CEO/MANAGEMENT: any), same alerts when a KR turns red. progress is 0–1. Idempotent on (krId, weekNumber, year).",
      inputSchema: input,
    },
    async (args) => {
      try {
        if (!APP_URL) throw new Error("MCP_APP_URL is not configured on the MCP server");
        const caller = getCaller();
        // Forward to the app so the write runs lib/weekly-entry.ts — no
        // duplicated score / deadline / alert logic in this package.
        const res = await fetch(`${APP_URL}/api/weekly-entries`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${caller.token}`,
          },
          body: JSON.stringify(args),
        });
        const body = (await res.json().catch(() => ({}))) as {
          data?: { id: string; scoreAtEntry: number; status: string; delta: number };
          error?: string;
        };
        if (!res.ok || !body.data) {
          throw new Error(body.error ?? `App returned HTTP ${res.status}`);
        }
        return jsonResult({
          ok: true,
          entryId: body.data.id,
          scorePercent: body.data.scoreAtEntry,
          status: body.data.status,
          deltaPercent: Math.round(body.data.delta * 100),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
