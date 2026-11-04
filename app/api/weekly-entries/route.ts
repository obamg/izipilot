import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent } from "@/lib/score";
import { krVisibilityWhere } from "@/lib/visibility";
import { verifyMcpBearer } from "@/lib/mcp-token";
import {
  upsertWeeklyEntry,
  fireWeeklyEntrySideEffects,
  WeeklyEntryError,
  revalidateWeeklyEntryPaths,
} from "@/lib/weekly-entry";

const createEntrySchema = z.object({
  krId: z.string(),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2024).max(2030),
  progress: z.number().min(0).max(1),
  currentValue: z.number().optional(),
  status: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED", "NOT_STARTED"]),
  blocker: z.string().nullable().optional(),
  proposedSolution: z.string().nullable().optional(),
  actionNeeded: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const weekNumber = searchParams.get("weekNumber");
  const year = searchParams.get("year");
  const krId = searchParams.get("krId");
  const submittedBy = searchParams.get("submittedBy");

  const entries = await prisma.weeklyEntry.findMany({
    where: {
      orgId: session.user.orgId,
      ...(weekNumber && { weekNumber: parseInt(weekNumber) }),
      ...(year && { year: parseInt(year) }),
      ...(krId && { krId }),
      ...(submittedBy && { submittedBy }),
      keyResult: krVisibilityWhere(session.user.role),
    },
    include: {
      submitter: { select: { name: true } },
      keyResult: { select: { title: true, krType: true, target: true, targetUnit: true } },
    },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
  });

  return Response.json({
    data: entries.map((e) => ({
      id: e.id,
      krId: e.krId,
      krTitle: e.keyResult.title,
      weekNumber: e.weekNumber,
      year: e.year,
      progress: e.progress,
      status: e.status,
      delta: e.delta,
      blocker: e.blocker,
      proposedSolution: e.proposedSolution,
      actionNeeded: e.actionNeeded,
      comment: e.comment,
      scoreAtEntry: scoreToPercent(e.scoreAtEntry),
      submittedAt: e.submittedAt.toISOString(),
      submitterName: e.submitter.name,
    })),
  });
}

export async function POST(request: NextRequest) {
  // Web session, or an MCP access token forwarded by the MCP server's
  // submit_weekly_entry tool (one code path for score, deadline, alerts).
  // A Bearer header means MCP ONLY: the middleware lets Bearer requests skip
  // its session gates (incl. mustChangePassword), so the cookie must never be
  // honoured on that path.
  const authz = request.headers.get("authorization");
  const user = authz?.toLowerCase().startsWith("bearer ")
    ? await verifyMcpBearer(authz)
    : (await auth())?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // VIEWER is read-only
  if (user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const sessionUser = { id: user.id, orgId: user.orgId, role: user.role };

  try {
    const upsertResult = await prisma.$transaction((tx) =>
      upsertWeeklyEntry(tx, parsed.data, sessionUser)
    );

    await fireWeeklyEntrySideEffects([upsertResult], sessionUser);
    revalidateWeeklyEntryPaths();

    const { entry } = upsertResult;
    return Response.json(
      {
        data: {
          id: entry.id,
          krId: entry.krId,
          weekNumber: entry.weekNumber,
          year: entry.year,
          progress: entry.progress,
          status: entry.status,
          delta: entry.delta,
          scoreAtEntry: scoreToPercent(entry.scoreAtEntry),
          submittedAt: entry.submittedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof WeeklyEntryError) {
      const status = err.code === "NOT_FOUND" ? 404 : 403;
      return Response.json({ error: err.message }, { status });
    }
    throw err;
  }
}
