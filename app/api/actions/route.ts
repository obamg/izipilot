import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { createActionSchema } from "@/lib/validations/actions";
import { getISOWeek } from "@/lib/date";
import { actionVisibilityWhere, krVisibilityWhere } from "@/lib/visibility";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const krId = searchParams.get("krId");
  const assigneeId = searchParams.get("assigneeId");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");

  const actions = await prisma.action.findMany({
    where: {
      orgId: session.user.orgId,
      ...(krId && { krId }),
      ...(assigneeId && { assigneeId }),
      ...(status && { status: status as never }),
      ...(priority && { priority: priority as never }),
      ...actionVisibilityWhere(session.user.role),
    },
    include: {
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      keyResult: {
        select: {
          id: true,
          title: true,
          objective: {
            select: {
              title: true,
              product: { select: { code: true, name: true } },
              department: { select: { code: true, name: true } },
            },
          },
        },
      },
      _count: { select: { comments: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return Response.json({
    data: actions.map((a) => ({
      id: a.id,
      krId: a.krId,
      krTitle: a.keyResult.title,
      objectiveTitle: a.keyResult.objective.title,
      entityCode: a.keyResult.objective.product?.code ?? a.keyResult.objective.department?.code ?? "",
      entityName: a.keyResult.objective.product?.name ?? a.keyResult.objective.department?.name ?? "",
      title: a.title,
      description: a.description,
      assigneeId: a.assignee.id,
      assigneeName: a.assignee.name,
      createdById: a.createdBy.id,
      createdByName: a.createdBy.name,
      status: a.status,
      priority: a.priority,
      dueDate: a.dueDate?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
      weekCreated: a.weekCreated,
      weekCompleted: a.weekCompleted,
      createdAt: a.createdAt.toISOString(),
      commentCount: a._count.comments,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "VIEWER" || session.user.role === "CONTRIBUTOR") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { krId, title, description, assigneeId, priority, dueDate } = parsed.data;

  // Verify KR belongs to user's org AND is visible to them. A PO/VIEWER
  // creating an action on a D7 KR via API would otherwise bypass the UI.
  const kr = await prisma.keyResult.findFirst({
    where: {
      id: krId,
      orgId: session.user.orgId,
      isActive: true,
      deletedAt: null,
      ...krVisibilityWhere(session.user.role),
    },
  });

  if (!kr) {
    return Response.json({ error: "Key Result not found" }, { status: 404 });
  }

  // PO can only create actions on their own KRs
  if (session.user.role === "PO" && kr.ownerId !== session.user.id) {
    return Response.json({ error: "Forbidden: not the owner of this KR" }, { status: 403 });
  }

  // Assignee must be an active member of the same org — never another tenant's user
  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, orgId: session.user.orgId, isActive: true },
    select: { id: true },
  });
  if (!assignee) {
    return Response.json(
      { error: "Assignee not found in your organization" },
      { status: 400 }
    );
  }

  const { weekNumber } = getISOWeek(new Date());

  const action = await prisma.action.create({
    data: {
      orgId: session.user.orgId,
      krId,
      title,
      description: description ?? null,
      assigneeId,
      createdById: session.user.id,
      priority: priority ?? "MEDIUM",
      dueDate: dueDate ? new Date(dueDate) : null,
      weekCreated: weekNumber,
    },
    include: {
      assignee: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      keyResult: { select: { title: true } },
    },
  });

  return Response.json(
    {
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
        completedAt: null,
        weekCreated: action.weekCreated,
        weekCompleted: null,
        createdAt: action.createdAt.toISOString(),
        commentCount: 0,
      },
    },
    { status: 201 }
  );
}
