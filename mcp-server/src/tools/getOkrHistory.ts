import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../prisma.js";
import { requireAccess } from "../context.js";
import { errorResult, jsonResult } from "./index.js";

const input = {
  krId: z.string().min(1),
  weeks: z.number().int().min(1).max(52).default(13),
};

export function registerGetOkrHistory(server: McpServer) {
  server.registerTool(
    "get_okr_history",
    {
      title: "Get KR history",
      description:
        "Returns the weekly entries for a KR (default 13 weeks). The KR must belong to the caller's org. Roles: any.",
      inputSchema: input,
    },
    async (args) => {
      try {
        const caller = requireAccess();

        // Confirm the KR is in the caller's org before reading entries.
        // Avoids leaking timing info about KRs in other orgs.
        const kr = await prisma.keyResult.findFirst({
          where: { id: args.krId, orgId: caller.orgId },
          select: { id: true, title: true, krType: true, target: true, targetUnit: true },
        });
        if (!kr) throw new Error("KR not found");

        const entries = await prisma.weeklyEntry.findMany({
          where: { krId: kr.id, orgId: caller.orgId },
          orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
          take: args.weeks,
          select: {
            weekNumber: true,
            year: true,
            progress: true,
            status: true,
            delta: true,
            scoreAtEntry: true,
            blocker: true,
            actionNeeded: true,
            submittedAt: true,
            isLate: true,
            submitter: { select: { id: true, name: true } },
          },
        });

        return jsonResult({
          kr,
          weeks: entries
            .reverse()
            .map((e) => ({
              weekNumber: e.weekNumber,
              year: e.year,
              scorePercent: Math.round(Number(e.scoreAtEntry) * 100),
              progressPercent: Math.round(e.progress * 100),
              status: e.status,
              delta: e.delta,
              blocker: e.blocker,
              actionNeeded: e.actionNeeded,
              submittedBy: e.submitter.name,
              submittedAt: e.submittedAt,
              isLate: e.isLate,
            })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
