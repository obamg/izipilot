import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createSprintTaskSchema } from "@/lib/validations/sprints";
import { sprintTaskVisibilityWhere, krVisibilityWhere } from "@/lib/visibility";
import {
  sprintTaskInclude,
  serializeSprintTask,
} from "@/lib/sprint-serialize";
import { validateTeamAndAssignee } from "@/lib/sprint-refs";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const sprintId = sp.get("sprintId"); // "backlog" → unassigned tasks
  const assignee = sp.get("assignee"); // "me" → current user
  const status = sp.get("status");
  const priority = sp.get("priority");
  const productId = sp.get("productId");
  const departmentId = sp.get("departmentId");
  const krId = sp.get("krId");

  const tasks = await prisma.sprintTask.findMany({
    where: {
      orgId: session.user.orgId,
      ...(sprintId === "backlog"
        ? { sprintId: null }
        : sprintId
        ? { sprintId }
        : {}),
      ...(assignee === "me"
        ? { assigneeId: session.user.id }
        : assignee
        ? { assigneeId: assignee }
        : {}),
      ...(status && { status: status as never }),
      ...(priority && { priority: priority as never }),
      ...(productId && { productId }),
      ...(departmentId && { departmentId }),
      ...(krId && { krId }),
      ...sprintTaskVisibilityWhere(session.user.role),
    },
    include: sprintTaskInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return Response.json({ data: tasks.map(serializeSprintTask) });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // VIEWER and CONTRIBUTOR cannot create tasks (CONTRIBUTOR may only move
  // their own assigned tasks — see PATCH).
  if (session.user.role === "VIEWER" || session.user.role === "CONTRIBUTOR") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createSprintTaskSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const orgId = session.user.orgId;

  // Validate the (optional) sprint belongs to the org.
  if (d.sprintId) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: d.sprintId, orgId },
      select: { id: true },
    });
    if (!sprint) {
      return Response.json({ error: "Sprint not found" }, { status: 404 });
    }
  }

  // Validate the (optional) KR is in the org and visible. A PO may only link a
  // KR they own (mirrors the Action rules).
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

  // Place at the end of its column.
  const count = await prisma.sprintTask.count({
    where: { orgId, sprintId: d.sprintId ?? null },
  });

  const task = await prisma.sprintTask.create({
    data: {
      orgId,
      sprintId: d.sprintId ?? null,
      krId: d.krId ?? null,
      departmentId: d.departmentId ?? null,
      productId: d.productId ?? null,
      title: d.title,
      description: d.description ?? null,
      priority: d.priority ?? "MEDIUM",
      storyPoints: d.storyPoints ?? null,
      assigneeId: d.assigneeId ?? null,
      createdById: session.user.id,
      sortOrder: count,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
    },
    include: sprintTaskInclude,
  });

  return Response.json({ data: serializeSprintTask(task) }, { status: 201 });
}
