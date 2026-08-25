import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { updateActionSchema } from "@/lib/validations/actions";
import { getISOWeek } from "@/lib/date";
import { actionVisibilityWhere } from "@/lib/visibility";
import { resolveActionColumn } from "@/lib/board-column-server";

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
    where: { id: actionId, orgId: session.user.orgId, ...actionVisibilityWhere(session.user.role) },
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
    where: { id: actionId, orgId: session.user.orgId, ...actionVisibilityWhere(session.user.role) },
    include: { keyResult: { select: { ownerId: true } } },
  });

  if (!existing) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  // PO can only update actions on their own KRs
  if (session.user.role === "PO" && existing.keyResult.ownerId !== session.user.id) {
    return Response.json({ error: "Forbidden: not the owner of this KR" }, { status: 403 });
  }

  // CONTRIBUTOR can only update actions assigned to them
  if (session.user.role === "CONTRIBUTOR" && existing.assigneeId !== session.user.id) {
    return Response.json({ error: "Forbidden: you can only update actions assigned to you" }, { status: 403 });
  }

  // Reassigning to another org's user would leak the action across tenants
  if (parsed.data.assigneeId && parsed.data.assigneeId !== existing.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: parsed.data.assigneeId,
        orgId: session.user.orgId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!assignee) {
      return Response.json(
        { error: "Assignee not found in your organization" },
        { status: 400 }
      );
    }
  }

  const updateData: Record<string, unknown> = { ...parsed.data };

  // ── Colonne du tableau et statut ───────────────────────────────────────────
  // Le statut est la projection de la catégorie de la colonne. Quand le client
  // envoie une colonne, c'est elle qui fait foi : on relit la catégorie en base
  // plutôt que de faire confiance au statut envoyé, sinon un client obsolète
  // pourrait poser un statut qui contredit la colonne affichée.
  if (parsed.data.columnId) {
    const column = await prisma.boardColumn.findFirst({
      where: { id: parsed.data.columnId, orgId: session.user.orgId },
      select: { id: true, category: true },
    });
    if (!column) {
      return Response.json({ error: "Colonne introuvable" }, { status: 404 });
    }
    updateData.columnId = column.id;
    updateData.status = column.category;
  } else if (parsed.data.status !== undefined) {
    // Statut sans colonne : on replace la carte dans la colonne équivalente du
    // flux de son équipe (null si ce flux n'a pas cette catégorie — l'action
    // atterrit alors dans « Hors flux » plutôt que dans la mauvaise colonne).
    updateData.columnId = await resolveActionColumn(
      session.user.orgId,
      existing.krId,
      parsed.data.status
    );
  }

  const nextStatus = (updateData.status as typeof existing.status) ?? existing.status;

  // Handle status → DONE: set completedAt and weekCompleted
  if (nextStatus === "DONE" && existing.status !== "DONE") {
    updateData.completedAt = new Date();
    updateData.weekCompleted = getISOWeek(new Date()).weekNumber;
  }

  // Handle status changed away from DONE: clear completion fields
  if (nextStatus !== "DONE" && existing.status === "DONE") {
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

  // VIEWER and CONTRIBUTOR are blocked from deleting actions.
  if (session.user.role === "VIEWER" || session.user.role === "CONTRIBUTOR") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { actionId } = await params;

  const action = await prisma.action.findFirst({
    where: { id: actionId, orgId: session.user.orgId, ...actionVisibilityWhere(session.user.role) },
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
