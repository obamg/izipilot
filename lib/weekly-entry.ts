import type { Prisma, KrStatus, UserRole, WeeklyEntry } from "@prisma/client";
import { calculateScore, calculateDelta, deriveStatus, scoreToPercent } from "./score";
import { getISOWeekStart } from "./date";
import { checkKrAlerts } from "./alerts";
import { escalateActionsOnBlock } from "./actions";

export interface WeeklyEntryInput {
  krId: string;
  weekNumber: number;
  year: number;
  progress: number;
  currentValue?: number;
  status: KrStatus;
  blocker?: string | null;
  proposedSolution?: string | null;
  actionNeeded?: string | null;
  comment?: string | null;
}

export interface WeeklyEntrySession {
  id: string;
  orgId: string;
  role: UserRole;
}

export interface UpsertWeeklyEntryResult {
  krId: string;
  entry: WeeklyEntry;
  derivedStatus: KrStatus;
}

export type WeeklyEntryErrorCode = "NOT_FOUND" | "FORBIDDEN";

export class WeeklyEntryError extends Error {
  constructor(
    public readonly code: WeeklyEntryErrorCode,
    public readonly krId: string,
    message: string
  ) {
    super(message);
    this.name = "WeeklyEntryError";
  }
}

/**
 * Upsert one WeeklyEntry inside a Prisma transaction, updating the parent KR's
 * score/status. Throws WeeklyEntryError to abort the surrounding transaction
 * when the KR is missing or the caller lacks permission.
 *
 * Side effects (alerts, action escalation) are NOT triggered here — call
 * fireWeeklyEntrySideEffects after the transaction commits.
 */
export async function upsertWeeklyEntry(
  tx: Prisma.TransactionClient,
  input: WeeklyEntryInput,
  session: WeeklyEntrySession
): Promise<UpsertWeeklyEntryResult> {
  const kr = await tx.keyResult.findFirst({
    where: {
      id: input.krId,
      orgId: session.orgId,
      isActive: true,
      deletedAt: null,
    },
  });

  if (!kr) {
    throw new WeeklyEntryError("NOT_FOUND", input.krId, "Key Result not found");
  }

  if (session.role === "PO" && kr.ownerId !== session.id) {
    throw new WeeklyEntryError(
      "FORBIDDEN",
      input.krId,
      "Not the owner of this KR"
    );
  }

  const effectiveValue = input.currentValue ?? kr.currentValue;
  const newScore = calculateScore(
    kr.krType,
    effectiveValue,
    kr.target,
    input.progress,
    kr.isInverse
  );

  const previousEntry = await tx.weeklyEntry.findFirst({
    where: {
      krId: input.krId,
      OR: [
        { year: input.year, weekNumber: input.weekNumber - 1 },
        { year: input.year - 1, weekNumber: 52 },
      ],
    },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
  });

  const delta = calculateDelta(
    newScore,
    previousEntry ? Number(previousEntry.scoreAtEntry) : null
  );
  const newScorePercent = scoreToPercent(newScore);
  const derivedStatus = deriveStatus(newScorePercent, true);
  const weekStart = getISOWeekStart(input.year, input.weekNumber);

  const entry = await tx.weeklyEntry.upsert({
    where: {
      krId_weekNumber_year: {
        krId: input.krId,
        weekNumber: input.weekNumber,
        year: input.year,
      },
    },
    create: {
      orgId: session.orgId,
      krId: input.krId,
      submittedBy: session.id,
      weekNumber: input.weekNumber,
      year: input.year,
      weekStart,
      progress: input.progress,
      status: input.status ?? derivedStatus,
      delta,
      blocker: input.blocker ?? null,
      proposedSolution: input.proposedSolution ?? null,
      actionNeeded: input.actionNeeded ?? null,
      comment: input.comment ?? null,
      scoreAtEntry: newScore,
    },
    update: {
      progress: input.progress,
      status: input.status ?? derivedStatus,
      delta,
      blocker: input.blocker ?? null,
      proposedSolution: input.proposedSolution ?? null,
      actionNeeded: input.actionNeeded ?? null,
      comment: input.comment ?? null,
      scoreAtEntry: newScore,
      submittedBy: session.id,
    },
  });

  await tx.keyResult.update({
    where: { id: input.krId },
    data: {
      score: newScore,
      status: derivedStatus,
      currentValue:
        kr.krType === "DATE" || kr.krType === "BINARY"
          ? input.progress * (kr.target ?? 1)
          : effectiveValue,
    },
  });

  return { krId: input.krId, entry, derivedStatus };
}

/**
 * Fire post-commit side effects: alert detection and action escalation for
 * KRs that just turned BLOCKED. Run after the transaction commits so a side-
 * effect failure cannot roll back persisted entries.
 */
export async function fireWeeklyEntrySideEffects(
  results: UpsertWeeklyEntryResult[],
  session: WeeklyEntrySession
): Promise<void> {
  for (const r of results) {
    try {
      await checkKrAlerts(r.krId, session.orgId, session.id);
      if (r.derivedStatus === "BLOCKED") {
        await escalateActionsOnBlock(r.krId, session.orgId);
      }
    } catch (err) {
      console.error(
        `[weekly-entry] side-effect failed for kr ${r.krId}:`,
        err
      );
    }
  }
}
