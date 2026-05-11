import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent } from "@/lib/score";
import {
  upsertWeeklyEntry,
  fireWeeklyEntrySideEffects,
  WeeklyEntryError,
  type UpsertWeeklyEntryResult,
} from "@/lib/weekly-entry";

const entrySchema = z.object({
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

const batchSchema = z.object({
  entries: z.array(entrySchema).min(1).max(50),
});

/**
 * POST /api/weekly-entries/batch
 *
 * Atomic batch upsert: every entry is persisted in a single Prisma
 * transaction. If any one entry fails (KR not found, forbidden, DB error)
 * the whole batch is rolled back and the response shape lets the client
 * keep its draft and surface per-KR errors.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Reject duplicate krIds in the same batch — would race the upsert.
  const seenKrIds = new Set<string>();
  for (const e of parsed.data.entries) {
    if (seenKrIds.has(e.krId)) {
      return Response.json(
        { error: `Duplicate krId in batch: ${e.krId}` },
        { status: 400 }
      );
    }
    seenKrIds.add(e.krId);
  }

  const sessionUser = {
    id: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
  };

  let upserts: UpsertWeeklyEntryResult[];
  try {
    upserts = await prisma.$transaction(async (tx) => {
      const out: UpsertWeeklyEntryResult[] = [];
      for (const input of parsed.data.entries) {
        out.push(await upsertWeeklyEntry(tx, input, sessionUser));
      }
      return out;
    });
  } catch (err) {
    if (err instanceof WeeklyEntryError) {
      const status = err.code === "NOT_FOUND" ? 404 : 403;
      return Response.json(
        {
          error: err.message,
          results: [{ krId: err.krId, ok: false, error: err.message }],
        },
        { status }
      );
    }
    console.error("[weekly-entries/batch] transaction failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  await fireWeeklyEntrySideEffects(upserts, sessionUser);

  return Response.json(
    {
      results: upserts.map((u) => ({
        krId: u.krId,
        ok: true,
        data: {
          id: u.entry.id,
          weekNumber: u.entry.weekNumber,
          year: u.entry.year,
          progress: u.entry.progress,
          status: u.entry.status,
          delta: u.entry.delta,
          scoreAtEntry: scoreToPercent(u.entry.scoreAtEntry),
          submittedAt: u.entry.submittedAt.toISOString(),
        },
      })),
    },
    { status: 201 }
  );
}
