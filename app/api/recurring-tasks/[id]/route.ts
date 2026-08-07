import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { updateRecurringTaskSchema } from "@/lib/validations/sprints";
import { krVisibilityWhere } from "@/lib/visibility";
import {
  recurringTaskInclude,
  serializeRecurringTask,
} from "@/lib/sprint-serialize";
import { validateTeamAndAssignee } from "@/lib/sprint-refs";
import { canManageRecurring, computeNextRun } from "@/lib/recurring-task";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRecurring(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = session.user.orgId;

  const existing = await prisma.recurringTask.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      frequency: true,
      weekday: true,
      monthDay: true,
      createdById: true,
    },
  });
  if (!existing) {
    return Response.json({ error: "Recurring task not found" }, { status: 404 });
  }

  const parsed = updateRecurringTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const p = parsed.data;

  if (p.krId) {
    const kr = await prisma.keyResult.findFirst({
      where: {
        id: p.krId,
        orgId,
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

  const refError = await validateTeamAndAssignee(orgId, p);
  if (refError) return refError;

  const data: Record<string, unknown> = {};
  if (p.title !== undefined) data.title = p.title;
  if (p.description !== undefined) data.description = p.description ?? null;
  if (p.krId !== undefined) data.krId = p.krId ?? null;
  if (p.departmentId !== undefined) data.departmentId = p.departmentId ?? null;
  if (p.productId !== undefined) data.productId = p.productId ?? null;
  if (p.assigneeId !== undefined) data.assigneeId = p.assigneeId ?? null;
  if (p.priority !== undefined) data.priority = p.priority;
  if (p.storyPoints !== undefined) data.storyPoints = p.storyPoints ?? null;
  if (p.isActive !== undefined) data.isActive = p.isActive;

  // When the cadence changes, recompute the next occurrence from today so the
  // template doesn't keep an obsolete schedule.
  const cadenceTouched =
    p.frequency !== undefined ||
    p.weekday !== undefined ||
    p.monthDay !== undefined;
  if (cadenceTouched) {
    const frequency = p.frequency ?? existing.frequency;
    const weekday = p.weekday !== undefined ? p.weekday : existing.weekday;
    const monthDay = p.monthDay !== undefined ? p.monthDay : existing.monthDay;
    data.frequency = frequency;
    if (frequency === "PER_SPRINT") {
      // Event-driven — no weekday/monthDay/schedule.
      data.weekday = null;
      data.monthDay = null;
      data.nextRunAt = null;
    } else {
      data.weekday = weekday ?? null;
      data.monthDay = monthDay ?? null;
      data.nextRunAt = computeNextRun(
        new Date(),
        frequency,
        weekday ?? null,
        monthDay ?? null
      );
    }
  }

  const updated = await prisma.recurringTask.update({
    where: { id },
    data,
    include: recurringTaskInclude,
  });

  return Response.json({ data: serializeRecurringTask(updated) });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRecurring(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.recurringTask.findFirst({
    where: { id, orgId: session.user.orgId },
    select: { id: true, createdById: true },
  });
  if (!existing) {
    return Response.json({ error: "Recurring task not found" }, { status: 404 });
  }

  // PO may only delete templates they created; CEO/MANAGEMENT delete any.
  if (
    session.user.role === "PO" &&
    existing.createdById !== session.user.id
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.recurringTask.delete({ where: { id } });

  return Response.json({ success: true });
}
