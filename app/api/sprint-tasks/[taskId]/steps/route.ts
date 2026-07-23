import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createTaskStepSchema } from "@/lib/validations/sprints";
import { sprintTaskVisibilityWhere } from "@/lib/visibility";
import { sprintTaskStepSelect, serializeTaskStep } from "@/lib/sprint-serialize";
import { canAddStep } from "@/lib/sprint-step";

// POST — add a step (sous-tâche) to a task.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { taskId } = await params;
  const orgId = session.user.orgId;
  const role = session.user.role;

  const task = await prisma.sprintTask.findFirst({
    where: { id: taskId, orgId, ...sprintTaskVisibilityWhere(role) },
    select: { id: true, assigneeId: true },
  });
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (!canAddStep(task, { userId: session.user.id, role })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createTaskStepSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  if (d.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: d.assigneeId, orgId, isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      return Response.json(
        { error: "Assignee not found in your organization" },
        { status: 400 }
      );
    }
  }

  // Append at the end of the current list.
  const last = await prisma.sprintTaskStep.findFirst({
    where: { taskId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.sprintTaskStep.create({
    data: {
      orgId,
      taskId,
      title: d.title,
      assigneeId: d.assigneeId ?? null,
      storyPoints: d.storyPoints ?? null,
      createdById: session.user.id,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: sprintTaskStepSelect,
  });

  return Response.json({ data: serializeTaskStep(created) }, { status: 201 });
}
