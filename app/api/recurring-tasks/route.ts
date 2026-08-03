import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createRecurringTaskSchema } from "@/lib/validations/sprints";
import { krVisibilityWhere } from "@/lib/visibility";
import {
  recurringTaskInclude,
  serializeRecurringTask,
} from "@/lib/sprint-serialize";
import { validateTeamAndAssignee } from "@/lib/sprint-refs";
import { canManageRecurring, computeNextRun } from "@/lib/recurring-task";
import { spawnPerSprintTask } from "@/lib/recurring-spawn";

// GET — list the org's recurring-task templates (active first, then by next run).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRecurring(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const templates = await prisma.recurringTask.findMany({
    where: { orgId: session.user.orgId },
    include: recurringTaskInclude,
    orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }],
  });

  return Response.json({ data: templates.map(serializeRecurringTask) });
}

// POST — create a recurring-task template.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRecurring(session.user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createRecurringTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const orgId = session.user.orgId;

  // A PO may only link a KR they own (mirrors the sprint-task rules).
  if (d.krId) {
    const kr = await prisma.keyResult.findFirst({
      where: {
        id: d.krId,
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

  const refError = await validateTeamAndAssignee(orgId, d);
  if (refError) return refError;

  // PER_SPRINT is event-driven (spawned on sprint activation), so it has no
  // scheduled date; date-based cadences seed their first run from today.
  const nextRunAt =
    d.frequency === "PER_SPRINT"
      ? null
      : computeNextRun(new Date(), d.frequency, d.weekday ?? null, d.monthDay ?? null);

  const created = await prisma.recurringTask.create({
    data: {
      orgId,
      title: d.title,
      description: d.description ?? null,
      krId: d.krId ?? null,
      departmentId: d.departmentId ?? null,
      productId: d.productId ?? null,
      assigneeId: d.assigneeId ?? null,
      priority: d.priority ?? "MEDIUM",
      storyPoints: d.storyPoints ?? null,
      createdById: session.user.id,
      frequency: d.frequency,
      weekday: d.weekday ?? null,
      monthDay: d.monthDay ?? null,
      nextRunAt,
    },
    include: recurringTaskInclude,
  });

  // A PER_SPRINT template created while a sprint is running drops an instance
  // into it immediately (idempotent), so it's usable now rather than only from
  // the next sprint's activation.
  if (created.frequency === "PER_SPRINT") {
    const active = await prisma.sprint.findFirst({
      where: { orgId, status: "ACTIVE" },
      orderBy: { startDate: "desc" },
      select: { id: true },
    });
    if (active) {
      try {
        await spawnPerSprintTask(created, active.id);
      } catch {
        // Best-effort — the template is created regardless of spawn outcome.
      }
    }
  }

  return Response.json({ data: serializeRecurringTask(created) }, { status: 201 });
}
