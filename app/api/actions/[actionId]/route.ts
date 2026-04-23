import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { updateActionSchema } from "@/lib/validations/actions";
import { getISOWeek } from "@/lib/date";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { actionId } = await params;

  const action = await prisma.action.findFirst({
    where: { id: actionId, orgId: session.user.orgId },
    include: {
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      keyResult: { select: { title: true } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  return Response.json({
    data: {
      id: action.id,
      krId: action.krId,
      krTitle: action.keyResult.title,
      title: action.title,
      description: action.description,
      assigneeId: action.assignee.id,
      assigneeName: action.assignee.name,
      createdById: action.createdBy.id,
      createdByName: action.createdBy.name,
      status: action.status,
      priority: action.priority,
      dueDate: action.dueDate?.toISOString() ?? null,
      completedAt: action.completedAt?.toISOString() ?? null,
      weekCreated: action.weekCreated,
      weekCompleted: action.weekCompleted,
      createdAt: action.createdAt.toISOString(),
      comments: action.comments.map((c) => ({
        id: c.id,
        authorId: c.author.id,
        authorName: c.author.name,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
      })),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { actionId } = await params;
  const body = await request.json();
  const parsed = updateActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Verify action exists and belongs to org
  const existing = await prisma.action.findFirst({
    where: { id: actionId, orgId: session.user.orgId },
    include: { keyResult: { select: { ownerId: true } } },
  });

  if (!existing) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  // PO can only update actions on their own KRs
  if (session.user.role === "PO" && existing.keyResult.ownerId !== session.user.id) {
    return Response.json({ error: "Forbidden: not the owner of this KR" }, { status: 403 });
  }

  const updateData: Record<string, unknown> = { ...parsed.data };

  // Handle status → DONE: set completedAt and weekCompleted
  if (parsed.data.status === "DONE" && existing.status !== "DONE") {
    updateData.completedAt = new Date();
    updateData.weekCompleted = getISOWeek(new Date()).weekNumber;
  }

  // Handle status changed away from DONE: clear completion fields
  if (parsed.data.status && parsed.data.status !== "DONE" && existing.status === "DONE") {
    updateData.completedAt = null;
    updateData.weekCompleted = null;
  }

  // Handle dueDate string → Date
  if (parsed.data.dueDate !== undefined) {
    updateData.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }

  const updated = await prisma.action.update({
    where: { id: actionId },
    data: updateData,
    include: {
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      keyResult: { select: { title: true } },
      _count: { select: { comments: true } },
    },
  });

  return Response.json({
    data: {
      id: updated.id,
      krId: updated.krId,
      krTitle: updated.keyResult.title,
      title: updated.title,
      description: updated.description,
      assigneeId: updated.assignee.id,
      assigneeName: updated.assignee.name,
      createdById: updated.createdBy.id,
      createdByName: updated.createdBy.name,
      status: updated.status,
      priority: updated.priority,
      dueDate: updated.dueDate?.toISOString() ?? null,
      completedAt: updated.completedAt?.toISOString() ?? null,
      weekCreated: updated.weekCreated,
      weekCompleted: updated.weekCompleted,
      createdAt: updated.createdAt.toISOString(),
      commentCount: updated._count.comments,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ actionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { actionId } = await params;

  const action = await prisma.action.findFirst({
    where: { id: actionId, orgId: session.user.orgId },
  });

  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  // Only creator or CEO/MANAGEMENT can delete
  if (session.user.role === "PO" && action.createdById !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.action.delete({ where: { id: actionId } });

  return Response.json({ success: true });
}
