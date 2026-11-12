import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callApp, errorResult, jsonResult } from "./index.js";

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
        // Forward to the app so the write runs lib/weekly-entry.ts — no
        // duplicated score / deadline / alert logic in this package.
        const data = await callApp<{ id: string; scoreAtEntry: number; status: string; delta: number }>(
          "POST",
          "/api/weekly-entries",
          args,
        );
        return jsonResult({
          ok: true,
          entryId: data.id,
          scorePercent: data.scoreAtEntry,
          status: data.status,
          deltaPercent: Math.round(data.delta * 100),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
