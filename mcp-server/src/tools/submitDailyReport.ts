import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../prisma.js";
import { requireAccess } from "../context.js";
import { errorResult, jsonResult } from "./index.js";

// Same limits as submitStandupSchema (lib/validations/sprints.ts).
const field = z.string().max(2000).nullable().optional();
const input = {
  sprintId: z.string().min(1).optional(),
  yesterday: field,
  today: field,
  blockers: field,
};

// Copy of watDateOnly (lib/standup.ts) — the MCP package can't import the app.
// Standups are keyed by the WAT (UTC+1, no DST) calendar day as UTC midnight.
function watDateOnly(now: Date = new Date()): Date {
  const wat = new Date(now.getTime() + 60 * 60 * 1000);
  return new Date(Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()));
}

// undefined = leave as is; null/"" = clear; otherwise trimmed text.
function clean(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v?.trim() || null;
}

export function registerSubmitDailyReport(server: McpServer) {
  server.registerTool(
    "submit_daily_report",
    {
      title: "Submit daily report (point du jour)",
      description:
        "Records the caller's daily report for TODAY (WAT): yesterday (« Hier »), today (« Aujourd'hui »), blockers (« Blocage »). " +
        "Only today can be written. Omitted fields keep their current value; null or empty clears them. " +
        "sprintId is optional when the caller belongs to exactly one ACTIVE sprint; otherwise the error lists the sprints to choose from. VIEWER cannot write.",
      inputSchema: input,
    },
    async (args) => {
      try {
        const caller = requireAccess({ roles: ["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR"] });

        const yesterday = clean(args.yesterday);
        const today = clean(args.today);
        const blockers = clean(args.blockers);
        if (yesterday === undefined && today === undefined && blockers === undefined) {
          throw new Error("Provide at least one of yesterday, today, blockers");
        }

        let sprint: { id: string; name: string } | null;
        if (args.sprintId) {
          sprint = await prisma.sprint.findFirst({
            where: { id: args.sprintId, orgId: caller.orgId },
            select: { id: true, name: true },
          });
          if (!sprint) throw new Error("Sprint not found");
        } else {
          // Membership = task assignee or capacity member (same roster as the reminder cron).
          const mine = await prisma.sprint.findMany({
            where: {
              orgId: caller.orgId,
              status: "ACTIVE",
              OR: [
                { capacities: { some: { userId: caller.userId } } },
                { tasks: { some: { assigneeId: caller.userId } } },
              ],
            },
            select: { id: true, name: true },
            orderBy: { startDate: "asc" },
          });
          if (mine.length === 0) {
            throw new Error("You are not a member of any active sprint — pass sprintId explicitly");
          }
          if (mine.length > 1) {
            throw new Error(
              `You belong to ${mine.length} active sprints, pass sprintId: ` +
                mine.map((s) => `${s.name} (${s.id})`).join(", "),
            );
          }
          sprint = mine[0];
        }

        const date = watDateOnly();
        const entry = await prisma.standupEntry.upsert({
          where: { sprintId_userId_date: { sprintId: sprint.id, userId: caller.userId, date } },
          create: {
            orgId: caller.orgId,
            sprintId: sprint.id,
            userId: caller.userId,
            date,
            yesterday: yesterday ?? null,
            today: today ?? null,
            blockers: blockers ?? null,
          },
          update: { yesterday, today, blockers },
          select: { yesterday: true, today: true, blockers: true, updatedAt: true },
        });

        return jsonResult({
          ok: true,
          sprint: sprint.name,
          date: date.toISOString().slice(0, 10),
          ...entry,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
