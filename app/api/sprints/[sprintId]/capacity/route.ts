import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { setCapacitySchema } from "@/lib/validations/sprints";

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
    select: { id: true },
  });
  if (!sprint) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }

  const capacities = await prisma.sprintCapacity.findMany({
    where: { sprintId, orgId: session.user.orgId },
    include: { user: { select: { id: true, name: true } } },
  });

  return Response.json({
    data: capacities.map((c) => ({
      userId: c.user.id,
      userName: c.user.name,
      capacityPoints: c.capacityPoints,
      notes: c.notes,
    })),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "CEO" && session.user.role !== "MANAGEMENT") {
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

  const body = await request.json();
  const parsed = setCapacitySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Every referenced user must belong to the org.
  const userIds = parsed.data.entries.map((e) => e.userId);
  if (userIds.length > 0) {
    const valid = await prisma.user.count({
      where: { id: { in: userIds }, orgId: session.user.orgId },
    });
    if (valid !== new Set(userIds).size) {
      return Response.json(
        { error: "One or more users are not in your organization" },
        { status: 400 }
      );
    }
  }

  await prisma.$transaction(
    parsed.data.entries.map((e) =>
      prisma.sprintCapacity.upsert({
        where: { sprintId_userId: { sprintId, userId: e.userId } },
        create: {
          orgId: session.user.orgId,
          sprintId,
          userId: e.userId,
          capacityPoints: e.capacityPoints,
          notes: e.notes ?? null,
        },
        update: {
          capacityPoints: e.capacityPoints,
          notes: e.notes ?? null,
        },
      })
    )
  );

  const capacities = await prisma.sprintCapacity.findMany({
    where: { sprintId, orgId: session.user.orgId },
    include: { user: { select: { id: true, name: true } } },
  });

  return Response.json({
    data: capacities.map((c) => ({
      userId: c.user.id,
      userName: c.user.name,
      capacityPoints: c.capacityPoints,
      notes: c.notes,
    })),
  });
}
