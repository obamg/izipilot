import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { createTaskRequestSchema } from "@/lib/validations/sprints";
import {
  sprintTaskVisibilityWhere,
  departmentVisibilityWhere,
} from "@/lib/visibility";
import {
  sprintTaskRequestInclude,
  serializeTaskRequest,
} from "@/lib/sprint-serialize";
import { canRaiseRequest } from "@/lib/sprint-request";

// GET — all requests raised on a task (history for the modal).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { taskId } = await params;

  const task = await prisma.sprintTask.findFirst({
    where: {
      id: taskId,
      orgId: session.user.orgId,
      ...sprintTaskVisibilityWhere(session.user.role),
    },
    select: { id: true },
  });
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const requests = await prisma.sprintTaskRequest.findMany({
    where: { taskId, orgId: session.user.orgId },
    include: sprintTaskRequestInclude,
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ data: requests.map(serializeTaskRequest) });
}

// POST — raise a request directed at a teammate OR a team.
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
  if (!canRaiseRequest(task, { userId: session.user.id, role })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createTaskRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;

  // Validate the chosen target exists in the org and is visible to the caller.
  if (d.targetUserId) {
    const u = await prisma.user.findFirst({
      where: { id: d.targetUserId, orgId, isActive: true },
      select: { id: true },
    });
    if (!u) return Response.json({ error: "Cible introuvable" }, { status: 404 });
  } else if (d.targetDepartmentId) {
    const dept = await prisma.department.findFirst({
      where: {
        id: d.targetDepartmentId,
        orgId,
        isActive: true,
        ...departmentVisibilityWhere(role),
      },
      select: { id: true },
    });
    if (!dept)
      return Response.json({ error: "Département introuvable" }, { status: 404 });
  } else if (d.targetProductId) {
    const prod = await prisma.product.findFirst({
      where: { id: d.targetProductId, orgId, isActive: true },
      select: { id: true },
    });
    if (!prod)
      return Response.json({ error: "Produit introuvable" }, { status: 404 });
  }

  const created = await prisma.sprintTaskRequest.create({
    data: {
      orgId,
      taskId,
      requestedById: session.user.id,
      kind: d.kind,
      message: d.message,
      targetUserId: d.targetUserId ?? null,
      targetDepartmentId: d.targetDepartmentId ?? null,
      targetProductId: d.targetProductId ?? null,
    },
    include: sprintTaskRequestInclude,
  });

  return Response.json({ data: serializeTaskRequest(created) }, { status: 201 });
}
