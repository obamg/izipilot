import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../prisma.js";
import { requireAccess } from "../context.js";
import { errorResult, jsonResult } from "./index.js";

export function registerListBlockedKrs(server: McpServer) {
  server.registerTool(
    "list_blocked_krs",
    {
      title: "List blocked KRs",
      description:
        "Lists every KR currently in BLOCKED status (score < 40%) for the caller's org, with owner, blocker text from the latest entry, and any open alerts. Roles: any.",
    },
    async () => {
      try {
        const caller = requireAccess();
        const krs = await prisma.keyResult.findMany({
          where: {
            orgId: caller.orgId,
            isActive: true,
            deletedAt: null,
            status: "BLOCKED",
          },
          select: {
            id: true,
            title: true,
            score: true,
            owner: { select: { id: true, name: true, email: true } },
            objective: { select: { id: true, title: true } },
            weeklyEntries: {
              orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
              take: 1,
              select: {
                weekNumber: true,
                year: true,
                blocker: true,
                actionNeeded: true,
                proposedSolution: true,
              },
            },
            alerts: {
              where: { resolvedAt: null },
              select: { id: true, type: true, severity: true, createdAt: true },
            },
          },
        });

        return jsonResult({
          count: krs.length,
          items: krs.map((kr) => ({
            id: kr.id,
            title: kr.title,
            objective: kr.objective.title,
            scorePercent: Math.round(Number(kr.score) * 100),
            owner: kr.owner,
            latestEntry: kr.weeklyEntries[0] ?? null,
            openAlerts: kr.alerts,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
