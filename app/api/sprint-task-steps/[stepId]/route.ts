import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { updateTaskStepSchema } from "@/lib/validations/sprints";
import { sprintTaskVisibilityWhere } from "@/lib/visibility";
import { sprintTaskStepSelect, serializeTaskStep } from "@/lib/sprint-serialize";
import {
  canUpdateStepStatus,
  canEditStepDetails,
  canDeleteStep,
} from "@/lib/sprint-step";

// Keys a "move" touches — a CONTRIBUTOR assigned to the task or the step may
// change these without being the step's creator.
const MOVE_KEYS = new Set(["status", "sortOrder"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ stepId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { stepId } = await params;
  const viewer = { userId: session.user.id, role: session.user.role };

  const step = await prisma.sprintTaskStep.findFirst({
    where: {
      id: stepId,
      orgId: session.user.orgId,
      task: { ...sprintTaskVisibilityWhere(session.user.role) },
    },
    select: {
      id: true,
      status: true,
      assigneeId: true,
      createdById: true,
      task: { select: { assigneeId: true } },
    },
  });
  if (!step) {
    return Response.json({ error: "Step not found" }, { status: 404 });
  }

  const parsed = updateTaskStepSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const p = parsed.data;

  // Moves (status/sortOrder) have a looser rule than detail edits.
  const moveOnly = Object.keys(p).every((k) => MOVE_KEYS.has(k));
  const allowed = moveOnly
    ? canUpdateStepStatus(step, step.task, viewer)
    : canEditStepDetails(step, step.task, viewer);
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (p.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: p.assigneeId, orgId: session.user.orgId, isActive: true },
      select: { id: true },
    });
    if (!assignee) {
      return Response.json(
        { error: "Assignee not found in your organization" },
        { status: 400 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.assigneeId !== undefined) data.assigneeId = p.assigneeId ?? null;
  if (p.storyPoints !== undefined) data.storyPoints = p.storyPoints ?? null;
  if (p.sortOrder !== undefined) data.sortOrder = p.sortOrder;
  if (p.status !== undefined) {
    data.status = p.status;
    if (p.status === "DONE" && step.status !== "DONE") {
      data.completedAt = new Date();
    } else if (p.status !== "DONE" && step.status === "DONE") {
      data.completedAt = null;
    }
  }

  const updated = await prisma.sprintTaskStep.update({
    where: { id: stepId },
    data,
    select: sprintTaskStepSelect,
  });

  return Response.json({ data: serializeTaskStep(updated) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ stepId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { stepId } = await params;

  const step = await prisma.sprintTaskStep.findFirst({
    where: {
      id: stepId,
      orgId: session.user.orgId,
      task: { ...sprintTaskVisibilityWhere(session.user.role) },
    },
    select: { id: true, assigneeId: true, createdById: true },
  });
  if (!step) {
    return Response.json({ error: "Step not found" }, { status: 404 });
  }
  if (!canDeleteStep(step, { userId: session.user.id, role: session.user.role })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.sprintTaskStep.delete({ where: { id: stepId } });

  return Response.json({ success: true });
}
