import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { submitStandupSchema } from "@/lib/validations/sprints";
import { watDateOnly, parseDateKey, toDateKey } from "@/lib/standup";

// GET /api/sprints/[sprintId]/standups?date=yyyy-mm-dd
// Lists every member's standup for the given day (default: WAT today).
// Readable by any active member of the org (sprints are org-wide).
export async function GET(
  request: NextRequest,
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

  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam ? parseDateKey(dateParam) : watDateOnly();
  if (!date) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }

  const standups = await prisma.standupEntry.findMany({
    where: { sprintId, orgId: session.user.orgId, date },
    include: { user: { select: { id: true, name: true } } },
  });

  return Response.json({
    date: toDateKey(date),
    standups: standups.map((s) => ({
      userId: s.user.id,
      userName: s.user.name,
      yesterday: s.yesterday,
      today: s.today,
      blockers: s.blockers,
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

// POST /api/sprints/[sprintId]/standups
// Upserts the CURRENT user's standup for WAT today (you can only edit today).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // VIEWER is read-only.
  if (session.user.role === "VIEWER") {
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
  const parsed = submitStandupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const dateOnly = watDateOnly();
  const yesterday = parsed.data.yesterday?.trim() || null;
  const today = parsed.data.today?.trim() || null;
  const blockers = parsed.data.blockers?.trim() || null;

  const entry = await prisma.standupEntry.upsert({
    where: {
      sprintId_userId_date: { sprintId, userId: session.user.id, date: dateOnly },
    },
    create: {
      orgId: session.user.orgId,
      sprintId,
      userId: session.user.id,
      date: dateOnly,
      yesterday,
      today,
      blockers,
    },
    update: { yesterday, today, blockers },
    include: { user: { select: { id: true, name: true } } },
  });

  return Response.json({
    data: {
      userId: entry.user.id,
      userName: entry.user.name,
      yesterday: entry.yesterday,
      today: entry.today,
      blockers: entry.blockers,
      updatedAt: entry.updatedAt.toISOString(),
      date: toDateKey(dateOnly),
    },
  });
}
