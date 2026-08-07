import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { updateSprintTaskSchema } from "@/lib/validations/sprints";
import { sprintTaskVisibilityWhere, krVisibilityWhere } from "@/lib/visibility";
import { sprintTaskInclude, serializeSprintTask } from "@/lib/sprint-serialize";
import { validateTeamAndAssignee } from "@/lib/sprint-refs";

// Keys a CONTRIBUTOR may edit on their OWN assigned task: board move
// (status/sortOrder) plus the report link.
const CONTRIBUTOR_KEYS = new Set(["status", "sortOrder", "reportUrl"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { taskId } = await params;
  const body = await request.json();
  const parsed = updateSprintTaskSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.sprintTask.findFirst({
    where: {
      id: taskId,
      orgId: session.user.orgId,
      ...sprintTaskVisibilityWhere(session.user.role),
    },
    select: { id: true, status: true, assigneeId: true, createdById: true },
  });
  if (!existing) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // CONTRIBUTOR may only edit the allowed keys (move + report link) on their
  // own assigned task.
  if (session.user.role === "CONTRIBUTOR") {
    const allowed = Object.keys(parsed.data).every((k) =>
      CONTRIBUTOR_KEYS.has(k)
    );
    if (!allowed || existing.assigneeId !== session.user.id) {
      return Response.json(
        { error: "Forbidden: you can only update tasks assigned to you" },
        { status: 403 }
      );
    }
  }

  const p = parsed.data;

  // Validate references that are being (re)set.
  if (p.sprintId) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: p.sprintId, orgId: session.user.orgId },
      select: { id: true },
    });
    if (!sprint) {
      return Response.json({ error: "Sprint not found" }, { status: 404 });
    }
  }
  if (p.krId) {
    const kr = await prisma.keyResult.findFirst({
      where: {
        id: p.krId,
        orgId: session.user.orgId,
        isActive: true,
        deletedAt: null,
        ...krVisibilityWhere(session.user.role),
      },
      select: { ownerId: true },
    });
    if (!kr) {
      return Response.json({ error: "Key Result not found" }, { status: 404 });
    }
    if (session.user.role === "PO" && kr.ownerId !== session.user.id) {
      return Response.json(
        { error: "Forbidden: not the owner of this KR" },
        { status: 403 }
      );
    }
  }
  const refError = await validateTeamAndAssignee(session.user.orgId, p);
  if (refError) return refError;

  // Build the update payload from provided fields only.
  const data: Record<string, unknown> = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.description !== undefined) data.description = p.description ?? null;
  if (p.reportUrl !== undefined) data.reportUrl = p.reportUrl ?? null;
  if (p.priority !== undefined) data.priority = p.priority;
  if (p.storyPoints !== undefined) data.storyPoints = p.storyPoints ?? null;
  if (p.assigneeId !== undefined) data.assigneeId = p.assigneeId ?? null;
  if (p.departmentId !== undefined) data.departmentId = p.departmentId ?? null;
  if (p.productId !== undefined) data.productId = p.productId ?? null;
  if (p.krId !== undefined) data.krId = p.krId ?? null;
  if (p.sprintId !== undefined) data.sprintId = p.sprintId ?? null;
  if (p.sortOrder !== undefined) data.sortOrder = p.sortOrder;
  if (p.dueDate !== undefined) {
    data.dueDate = p.dueDate ? new Date(p.dueDate) : null;
  }
  if (p.status !== undefined) {
    data.status = p.status;
    if (p.status === "DONE" && existing.status !== "DONE") {
      data.completedAt = new Date();
    } else if (p.status !== "DONE" && existing.status === "DONE") {
      data.completedAt = null;
    }
  }

  const updated = await prisma.sprintTask.update({
    where: { id: taskId },
    data,
    include: sprintTaskInclude,
  });

  return Response.json({ data: serializeSprintTask(updated) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "VIEWER" || session.user.role === "CONTRIBUTOR") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { taskId } = await params;
  const task = await prisma.sprintTask.findFirst({
    where: {
      id: taskId,
      orgId: session.user.orgId,
      ...sprintTaskVisibilityWhere(session.user.role),
    },
    select: { id: true, createdById: true },
  });
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // PO may only delete tasks they created; CEO/MANAGEMENT delete any.
  if (session.user.role === "PO" && task.createdById !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.sprintTask.delete({ where: { id: taskId } });

  return Response.json({ success: true });
}
