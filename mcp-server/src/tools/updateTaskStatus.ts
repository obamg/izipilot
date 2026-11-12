import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAccess } from "../context.js";
import { callApp, errorResult, jsonResult } from "./index.js";

const input = {
  taskId: z.string().min(1),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]),
};

export function registerUpdateTaskStatus(server: McpServer) {
  server.registerTool(
    "update_task_status",
    {
      title: "Update task status",
      description:
        "Changes a sprint task's status; the card moves to the matching column of its team's board, exactly like a drag on the web board. " +
        "CONTRIBUTOR: only tasks assigned to them. VIEWER: never.",
      inputSchema: input,
    },
    async (args) => {
      try {
        requireAccess({ roles: ["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR"] });
        const task = await callApp<{ id: string; title: string; status: string }>(
          "PATCH",
          `/api/sprint-tasks/${encodeURIComponent(args.taskId)}`,
          { status: args.status },
        );
        return jsonResult({ ok: true, id: task.id, title: task.title, status: task.status });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
