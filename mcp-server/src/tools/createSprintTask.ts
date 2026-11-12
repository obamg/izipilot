import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAccess } from "../context.js";
import { prisma } from "../prisma.js";
import { callApp, errorResult, jsonResult } from "./index.js";

const input = {
  title: z.string().min(2).max(200),
  team: z.string().min(1).describe('Department or product code, e.g. "D2" (IT) or "P3" (Africapart).'),
  sprintId: z.string().min(1).optional().describe("Sprint id from list_sprint_tasks. Omit to put the task in the backlog."),
  assigneeEmail: z.string().email().optional(),
  description: z.string().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  storyPoints: z.number().int().min(0).max(1000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
  krId: z.string().min(1).optional(),
};

export function registerCreateSprintTask(server: McpServer) {
  server.registerTool(
    "create_sprint_task",
    {
      title: "Create sprint task",
      description:
        "Creates a task in a sprint (or the backlog) for a department or product, exactly like the web board: same permissions " +
        "(CEO/MANAGEMENT/PO: any team; CONTRIBUTOR: only a department they lead; VIEWER: never; a PO may only link a KR they own) " +
        "and the task lands in the team's first « À faire » column.",
      inputSchema: input,
    },
    async (args) => {
      try {
        const caller = requireAccess({ roles: ["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR"] });
        const code = args.team.trim().toUpperCase();

        // The app takes ids; resolve the human-friendly code and email within the org.
        const [department, product, assignee] = await Promise.all([
          prisma.department.findFirst({ where: { orgId: caller.orgId, code }, select: { id: true } }),
          prisma.product.findFirst({ where: { orgId: caller.orgId, code }, select: { id: true } }),
          args.assigneeEmail
            ? prisma.user.findFirst({
                where: { orgId: caller.orgId, email: args.assigneeEmail.toLowerCase(), isActive: true },
                select: { id: true },
              })
            : null,
        ]);
        if (!department && !product) throw new Error(`Unknown team code "${args.team}"`);
        if (args.assigneeEmail && !assignee) throw new Error(`No active user ${args.assigneeEmail} in this organization`);

        const task = await callApp<{ id: string; title: string; status: string; sprintName: string | null; assigneeName: string | null }>(
          "POST",
          "/api/sprint-tasks",
          {
            title: args.title,
            departmentId: department?.id ?? null,
            productId: department ? null : product!.id,
            sprintId: args.sprintId ?? null,
            assigneeId: assignee?.id ?? null,
            description: args.description ?? null,
            priority: args.priority ?? "MEDIUM",
            storyPoints: args.storyPoints ?? null,
            dueDate: args.dueDate ?? null,
            krId: args.krId ?? null,
          },
        );

        return jsonResult({
          ok: true,
          id: task.id,
          title: task.title,
          status: task.status,
          sprint: task.sprintName ?? "Backlog",
          assignee: task.assigneeName,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
