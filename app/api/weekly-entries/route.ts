import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { calculateScore, scoreToPercent, deriveStatus, calculateDelta } from "@/lib/score";
import { checkKrAlerts } from "@/lib/alerts";
import { getISOWeekStart } from "@/lib/date";
import { escalateActionsOnBlock } from "@/lib/actions";

const createEntrySchema = z.object({
  krId: z.string(),
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2024).max(2030),
  progress: z.number().min(0).max(1),
  currentValue: z.number().optional(),
  status: z.enum(["ON_TRACK", "AT_RISK", "BLOCKED", "NOT_STARTED"]),
  blocker: z.string().nullable().optional(),
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
      actionNeeded: e.actionNeeded,
      comment: e.comment,
      scoreAtEntry: scoreToPercent(e.scoreAtEntry),
      submittedAt: e.submittedAt.toISOString(),
      submitterName: e.submitter.name,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only CEO, MANAGEMENT, PO can create entries
  if (session.user.role === "VIEWER") {
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

  const { krId, weekNumber, year, progress, currentValue: submittedValue, status, blocker, actionNeeded, comment } = parsed.data;

  // Verify KR exists and belongs to user's org
  const kr = await prisma.keyResult.findFirst({
    where: { id: krId, orgId: session.user.orgId, isActive: true, deletedAt: null },
  });

  if (!kr) {
    return Response.json({ error: "Key Result not found" }, { status: 404 });
  }

  // PO can only submit for their own KRs
  if (session.user.role === "PO" && kr.ownerId !== session.user.id) {
    return Response.json({ error: "Forbidden: not the owner of this KR" }, { status: 403 });
  }

  // Use submitted currentValue for NUMERIC/PERCENTAGE, fall back to DB value
  const effectiveValue = submittedValue ?? kr.currentValue;

  // Calculate score using the submitted value, not the stale DB value
  const newScore = calculateScore(kr.krType, effectiveValue, kr.target, progress, kr.isInverse);
  const newScorePercent = scoreToPercent(newScore);

  // Get previous week entry for delta
  const previousEntry = await prisma.weeklyEntry.findFirst({
    where: {
      krId,
      OR: [
        { year, weekNumber: weekNumber - 1 },
        { year: year - 1, weekNumber: 52 },
      ],
    },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
  });

  const delta = calculateDelta(newScore, previousEntry ? Number(previousEntry.scoreAtEntry) : null);
  const derivedStatus = deriveStatus(newScorePercent, true);

  // Compute weekStart (Monday of the ISO week)
  const weekStart = getISOWeekStart(year, weekNumber);

  // Use transaction for atomicity
  const result = await prisma.$transaction(async (tx) => {
    // Upsert the weekly entry
    const entry = await tx.weeklyEntry.upsert({
      where: { krId_weekNumber_year: { krId, weekNumber, year } },
      create: {
        orgId: session.user.orgId,
        krId,
        submittedBy: session.user.id,
        weekNumber,
        year,
        weekStart,
        progress,
        status: status ?? derivedStatus,
        delta,
        blocker: blocker ?? null,
        actionNeeded: actionNeeded ?? null,
        comment: comment ?? null,
        scoreAtEntry: newScore,
      },
      update: {
        progress,
        status: status ?? derivedStatus,
        delta,
        blocker: blocker ?? null,
        actionNeeded: actionNeeded ?? null,
        comment: comment ?? null,
        scoreAtEntry: newScore,
        submittedBy: session.user.id,
      },
    });

    // Update the KR with new score, status, and current value
    await tx.keyResult.update({
      where: { id: krId },
      data: {
        score: newScore,
        status: derivedStatus,
        currentValue: kr.krType === "DATE" || kr.krType === "BINARY"
          ? progress * (kr.target ?? 1)
          : effectiveValue,
      },
    });

    return entry;
  });

  // Check for alerts (outside transaction)
  await checkKrAlerts(krId, session.user.orgId, session.user.id);

  // Auto-escalate actions if KR is now BLOCKED
  if (derivedStatus === "BLOCKED") {
    await escalateActionsOnBlock(krId, session.user.orgId);
  }

  return Response.json(
    {
      data: {
        id: result.id,
        krId: result.krId,
        weekNumber: result.weekNumber,
        year: result.year,
        progress: result.progress,
        status: result.status,
        delta: result.delta,
        scoreAtEntry: scoreToPercent(result.scoreAtEntry),
        submittedAt: result.submittedAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
