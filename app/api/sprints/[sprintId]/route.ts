import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { updateSprintSchema } from "@/lib/validations/sprints";
import {
  computeSprintStats,
  displaySprintStats,
  pickCarryTarget,
  UNFINISHED_STATUSES,
} from "@/lib/sprint";
import {
  spawnPerSprintTask,
  spawnableTemplateSelect,
} from "@/lib/recurring-spawn";
import { sprintTaskVisibilityWhere } from "@/lib/visibility";
import {
  sprintTaskInclude,
  serializeSprintTask,
} from "@/lib/sprint-serialize";

function isManagement(role: string) {
  return role === "CEO" || role === "MANAGEMENT";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sprintId } = await params;

  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, orgId: session.user.orgId },
    include: {
      createdBy: { select: { id: true, name: true } },
      tasks: {
        where: { ...sprintTaskVisibilityWhere(session.user.role) },
        include: sprintTaskInclude,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      capacities: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  if (!sprint) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }

  return Response.json({
    data: {
      id: sprint.id,
      number: sprint.number,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate.toISOString(),
      endDate: sprint.endDate.toISOString(),
      completedAt: sprint.completedAt?.toISOString() ?? null,
      createdById: sprint.createdBy.id,
      createdByName: sprint.createdBy.name,
      stats: displaySprintStats(sprint, sprint.tasks),
      tasks: sprint.tasks.map(serializeSprintTask),
      capacities: sprint.capacities.map((c) => ({
        userId: c.user.id,
        userName: c.user.name,
        capacityPoints: c.capacityPoints,
        notes: c.notes,
      })),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagement(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sprintId } = await params;
  const body = await request.json();
  const parsed = updateSprintSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const existing = await prisma.sprint.findFirst({
    where: { id: sprintId, orgId: session.user.orgId },
  });
  if (!existing) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.goal !== undefined) data.goal = parsed.data.goal ?? null;

  if (parsed.data.startDate !== undefined) {
    const d = new Date(parsed.data.startDate);
    if (isNaN(d.getTime())) {
      return Response.json({ error: "Invalid startDate" }, { status: 400 });
    }
    data.startDate = d;
  }
  if (parsed.data.endDate !== undefined) {
    const d = new Date(parsed.data.endDate);
    if (isNaN(d.getTime())) {
      return Response.json({ error: "Invalid endDate" }, { status: 400 });
    }
    data.endDate = d;
  }
  const finalStart = (data.startDate as Date) ?? existing.startDate;
  const finalEnd = (data.endDate as Date) ?? existing.endDate;
  if (finalEnd.getTime() < finalStart.getTime()) {
    return Response.json({ error: "endDate must be after startDate" }, { status: 400 });
  }

  const completing =
    parsed.data.status === "COMPLETED" && existing.status !== "COMPLETED";
  const activating =
    parsed.data.status === "ACTIVE" && existing.status !== "ACTIVE";

  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    // Only one ACTIVE sprint per org.
    if (parsed.data.status === "ACTIVE") {
      const otherActive = await prisma.sprint.findFirst({
        where: { orgId: session.user.orgId, status: "ACTIVE", id: { not: sprintId } },
        select: { id: true, name: true },
      });
      if (otherActive) {
        return Response.json(
          { error: `Another sprint is already active (${otherActive.name}). Close it first.` },
          { status: 409 }
        );
      }
    }
    data.status = parsed.data.status;
    data.completedAt = parsed.data.status === "COMPLETED" ? new Date() : null;
  }

  // Closing a sprint freezes its stats (so velocity survives the carry) then
  // auto-moves the unfinished tasks to the next open sprint, else the backlog.
  let carry: {
    count: number;
    toSprintId: string | null;
    toSprintName: string | null;
    toBacklog: boolean;
  } | null = null;

  let updated;
  if (completing) {
    const tasksNow = await prisma.sprintTask.findMany({
      where: { orgId: session.user.orgId, sprintId },
      select: {
        status: true,
        storyPoints: true,
        completedAt: true,
        assigneeId: true,
      },
    });
    data.statsSnapshot = computeSprintStats(tasksNow);

    const candidates = await prisma.sprint.findMany({
      where: {
        orgId: session.user.orgId,
        id: { not: sprintId },
        status: { in: ["PLANNED", "ACTIVE"] },
        number: { gt: existing.number },
      },
      select: { id: true, number: true, name: true, status: true },
    });
    const target = pickCarryTarget(candidates, existing.number);

    const [moved, u] = await prisma.$transaction([
      prisma.sprintTask.updateMany({
        where: {
          orgId: session.user.orgId,
          sprintId,
          status: { in: UNFINISHED_STATUSES },
        },
        data: { sprintId: target?.id ?? null },
      }),
      prisma.sprint.update({
        where: { id: sprintId },
        data,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
    ]);
    updated = u;
    carry = {
      count: moved.count,
      toSprintId: target?.id ?? null,
      toSprintName: target?.name ?? null,
      toBacklog: moved.count > 0 && !target,
    };
  } else {
    updated = await prisma.sprint.update({
      where: { id: sprintId },
      data,
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  // Starting a sprint drops one task from each active PER_SPRINT template into
  // it (idempotent — a template already present, e.g. carried over, is skipped).
  let spawnedRecurring = 0;
  if (activating) {
    const perSprint = await prisma.recurringTask.findMany({
      where: {
        orgId: session.user.orgId,
        isActive: true,
        frequency: "PER_SPRINT",
      },
      select: spawnableTemplateSelect,
    });
    for (const t of perSprint) {
      try {
        if (await spawnPerSprintTask(t, sprintId)) spawnedRecurring++;
      } catch {
        // Best-effort — one bad template must not fail the activation.
      }
    }
  }

  return Response.json({
    data: {
      id: updated.id,
      number: updated.number,
      name: updated.name,
      goal: updated.goal,
      status: updated.status,
      startDate: updated.startDate.toISOString(),
      endDate: updated.endDate.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
      createdById: updated.createdBy.id,
      createdByName: updated.createdBy.name,
    },
    spawned: spawnedRecurring,
    carry,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManagement(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sprintId } = await params;
  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, orgId: session.user.orgId },
    select: { id: true },
  });
  if (!sprint) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }

  // Tasks fall back to the backlog (sprintId → null via SetNull); capacities cascade.
  await prisma.sprint.delete({ where: { id: sprintId } });

  return Response.json({ success: true });
}
