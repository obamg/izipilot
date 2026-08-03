import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createSprintSchema } from "@/lib/validations/sprints";
import { computeSprintStats, displaySprintStats } from "@/lib/sprint";
import { sprintTaskVisibilityWhere } from "@/lib/visibility";

const taskStatSelect = {
  status: true,
  storyPoints: true,
  completedAt: true,
  assigneeId: true,
} as const;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");

  const sprints = await prisma.sprint.findMany({
    where: {
      orgId: session.user.orgId,
      ...(status && { status: status as never }),
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      tasks: {
        where: { ...sprintTaskVisibilityWhere(session.user.role) },
        select: taskStatSelect,
      },
    },
    orderBy: { number: "desc" },
  });

  return Response.json({
    data: sprints.map((s) => ({
      id: s.id,
      number: s.number,
      name: s.name,
      goal: s.goal,
      status: s.status,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      createdById: s.createdBy.id,
      createdByName: s.createdBy.name,
      stats: displaySprintStats(s, s.tasks),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only CEO / MANAGEMENT manage the sprint cadence.
  if (session.user.role !== "CEO" && session.user.role !== "MANAGEMENT") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createSprintSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const start = new Date(parsed.data.startDate);
  const end = new Date(parsed.data.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json({ error: "Invalid start or end date" }, { status: 400 });
  }
  if (end.getTime() < start.getTime()) {
    return Response.json({ error: "endDate must be after startDate" }, { status: 400 });
  }

  // Auto-increment sprint number per org. Retry once on the unique race.
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = await prisma.sprint.findFirst({
      where: { orgId: session.user.orgId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;
    try {
      const sprint = await prisma.sprint.create({
        data: {
          orgId: session.user.orgId,
          number,
          name: parsed.data.name,
          goal: parsed.data.goal ?? null,
          startDate: start,
          endDate: end,
          createdById: session.user.id,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      return Response.json(
        {
          data: {
            id: sprint.id,
            number: sprint.number,
            name: sprint.name,
            goal: sprint.goal,
            status: sprint.status,
            startDate: sprint.startDate.toISOString(),
            endDate: sprint.endDate.toISOString(),
            completedAt: null,
            createdById: sprint.createdBy.id,
            createdByName: sprint.createdBy.name,
            stats: computeSprintStats([]),
          },
        },
        { status: 201 }
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        attempt === 0
      ) {
        continue; // another sprint grabbed this number — recompute
      }
      throw e;
    }
  }

  return Response.json({ error: "Could not allocate sprint number" }, { status: 409 });
}
