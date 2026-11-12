import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAccess } from "../context.js";
import { prisma } from "../prisma.js";
import { callApp, errorResult, jsonResult } from "./index.js";

const input = {
  sprintId: z.string().min(1).optional().describe('A sprint id, or "backlog" for tasks outside any sprint. Omit for all tasks.'),
  mine: z.boolean().optional().describe("Only tasks assigned to the caller."),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
};

interface AppTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  storyPoints: number | null;
  sprintId: string | null;
  sprintName: string | null;
  assigneeName: string | null;
  krTitle: string | null;
  team: { code: string; name: string } | null;
  dueDate: string | null;
}

export function registerListSprintTasks(server: McpServer) {
  server.registerTool(
    "list_sprint_tasks",
    {
      title: "List sprint tasks",
      description:
        "Lists sprint tasks visible to the caller (same rules as the web board), filtered by sprint, assignee and status. " +
        "Also returns the org's active and planned sprints, with the ids to pass to create_sprint_task. Roles: any.",
      inputSchema: input,
    },
    async (args) => {
      try {
        const caller = requireAccess();
        const qs = new URLSearchParams();
        if (args.sprintId) qs.set("sprintId", args.sprintId);
        if (args.mine) qs.set("assignee", "me");
        if (args.status) qs.set("status", args.status);

        const [tasks, sprints] = await Promise.all([
          callApp<AppTask[]>("GET", `/api/sprint-tasks?${qs}`),
          prisma.sprint.findMany({
            where: { orgId: caller.orgId, status: { in: ["ACTIVE", "PLANNED"] } },
            select: { id: true, number: true, name: true, status: true },
            orderBy: { startDate: "asc" },
          }),
        ]);

        return jsonResult({
          sprints,
          count: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            storyPoints: t.storyPoints,
            sprint: t.sprintName,
            sprintId: t.sprintId,
            team: t.team ? `${t.team.code} ${t.team.name}` : null,
            assignee: t.assigneeName,
            kr: t.krTitle,
            dueDate: t.dueDate,
          })),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
