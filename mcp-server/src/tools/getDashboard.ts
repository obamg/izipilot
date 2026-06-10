import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../prisma.js";
import { requireAccess } from "../context.js";
import { errorResult, jsonResult } from "./index.js";

const input = {
  weekNumber: z.number().int().min(1).max(53).optional(),
  year: z.number().int().min(2024).max(2100).optional(),
};

export function registerGetDashboard(server: McpServer) {
  server.registerTool(
    "get_dashboard",
    {
      title: "Get IziPilot dashboard",
      description:
        "Returns the OKR dashboard for the caller's organization for a given ISO week. Defaults to the current week. Roles: any.",
      inputSchema: input,
    },
    async (args) => {
      try {
        const caller = requireAccess();
        const now = new Date();
        const year = args.year ?? now.getUTCFullYear();
        const weekNumber = args.weekNumber ?? isoWeek(now);

        const [krs, blockedCount, entriesThisWeek] = await Promise.all([
          prisma.keyResult.findMany({
            where: {
              orgId: caller.orgId,
              isActive: true,
              deletedAt: null,
            },
            select: {
              id: true,
              title: true,
              status: true,
              score: true,
              currentValue: true,
              target: true,
              targetUnit: true,
              owner: { select: { id: true, name: true } },
              objective: { select: { id: true, title: true } },
            },
            orderBy: { score: "desc" },
          }),
          prisma.keyResult.count({
            where: {
              orgId: caller.orgId,
              isActive: true,
              deletedAt: null,
              status: "BLOCKED",
            },
          }),
          prisma.weeklyEntry.count({
            where: { orgId: caller.orgId, weekNumber, year },
          }),
        ]);

        const totalKrs = krs.length;
        const avgScore =
          totalKrs === 0
            ? 0
            : Math.round(
                (krs.reduce((acc, kr) => acc + Number(kr.score), 0) / totalKrs) *
                  100,
              );

        return jsonResult({
          weekNumber,
          year,
          summary: {
            totalKrs,
            avgScorePercent: avgScore,
            blockedCount,
            entriesThisWeek,
          },
          keyResults: krs.map((kr) => ({
            id: kr.id,
            title: kr.title,
            objective: kr.objective.title,
            owner: kr.owner.name,
            status: kr.status,
            scorePercent: Math.round(Number(kr.score) * 100),
            currentValue: kr.currentValue,
            target: kr.target,
            unit: kr.targetUnit,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

// ISO week number — UTC, matches Postgres' EXTRACT(WEEK FROM ...).
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
