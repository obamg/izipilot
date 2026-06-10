import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../prisma.js";
import { requireAccess } from "../context.js";
import { errorResult, jsonResult } from "./index.js";

const input = {
  krId: z.string().min(1),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2024).max(2100),
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
        "Records the PO's weekly entry for one KR. PO can only submit for KRs they own; CEO and MANAGEMENT can submit for any KR in their org. Idempotent on (krId, weekNumber, year).",
      inputSchema: input,
    },
    async (args) => {
      try {
        // Coarse role gate first — VIEWER cannot write.
        const caller = requireAccess({ roles: ["CEO", "MANAGEMENT", "PO"] });

        const kr = await prisma.keyResult.findFirst({
          where: {
            id: args.krId,
            orgId: caller.orgId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, ownerId: true, target: true, isInverse: true, krType: true },
        });
        if (!kr) throw new Error("KR not found");

        // Ownership check — PO can only touch their own KRs.
        requireAccess({ ownerId: kr.ownerId });

        // Compute delta against the previous week's entry, if any.
        const previous = await prisma.weeklyEntry.findFirst({
          where: { krId: kr.id, orgId: caller.orgId },
          orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
          select: { scoreAtEntry: true },
        });
        const previousScore = previous ? Number(previous.scoreAtEntry) : 0;
        const delta = args.progress - previousScore;

        const weekStart = mondayOfIsoWeek(args.year, args.weekNumber);

        const entry = await prisma.weeklyEntry.upsert({
          where: {
            krId_weekNumber_year: {
              krId: kr.id,
              weekNumber: args.weekNumber,
              year: args.year,
            },
          },
          create: {
            orgId: caller.orgId,
            krId: kr.id,
            submittedBy: caller.userId,
            weekNumber: args.weekNumber,
            year: args.year,
            weekStart,
            progress: args.progress,
            status: args.status,
            delta,
            scoreAtEntry: args.progress,
            blocker: args.blocker,
            proposedSolution: args.proposedSolution,
            actionNeeded: args.actionNeeded,
            comment: args.comment,
          },
          update: {
            progress: args.progress,
            status: args.status,
            delta,
            scoreAtEntry: args.progress,
            blocker: args.blocker,
            proposedSolution: args.proposedSolution,
            actionNeeded: args.actionNeeded,
            comment: args.comment,
          },
          select: { id: true, scoreAtEntry: true, status: true, delta: true },
        });

        // Roll the KR's current state forward so dashboards stay in sync.
        await prisma.keyResult.update({
          where: { id: kr.id },
          data: {
            score: args.progress,
            status: args.status,
            currentValue:
              kr.target != null ? Number((args.progress * kr.target).toFixed(4)) : 0,
          },
        });

        return jsonResult({
          ok: true,
          entryId: entry.id,
          scorePercent: Math.round(Number(entry.scoreAtEntry) * 100),
          status: entry.status,
          deltaPercent: Math.round(entry.delta * 100),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function mondayOfIsoWeek(year: number, week: number): Date {
  // ISO 8601: week 1 contains January 4. Find that week's Monday, then shift.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}
