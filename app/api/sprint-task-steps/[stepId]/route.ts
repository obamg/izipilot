import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { updateTaskStepSchema } from "@/lib/validations/sprints";
import { sprintTaskVisibilityWhere } from "@/lib/visibility";
import { sprintTaskStepSelect, serializeTaskStep } from "@/lib/sprint-serialize";
import { canToggleStep, canEditStep, canDeleteStep } from "@/lib/sprint-step";

// Keys a check/reorder touches — a CONTRIBUTOR assigned to the task may
// change these without being the step's creator.
const TOGGLE_KEYS = new Set(["done", "sortOrder"]);

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

  // Checking / reordering has a looser rule than renaming.
  const toggleOnly = Object.keys(p).every((k) => TOGGLE_KEYS.has(k));
  const allowed = toggleOnly
    ? canToggleStep(step.task, viewer)
    : canEditStep(step, step.task, viewer);
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.done !== undefined) data.done = p.done;
  if (p.sortOrder !== undefined) data.sortOrder = p.sortOrder;

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
    select: { id: true, createdById: true },
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
