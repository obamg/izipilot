import type { Prisma, KrStatus, KrType, UserRole, WeeklyEntry } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { calculateScore, calculateDelta, deriveStatus, scoreToPercent } from "./score";
import { getISOWeekStart, getPreviousISOWeek } from "./date";
import { checkKrAlerts } from "./alerts";
import { escalateActionsOnBlock } from "./actions";

/**
 * Pages whose Server Component reads weekly-entry derived data and must
 * therefore be revalidated after any successful upsert. Called from both
 * the single and batch routes so other open sessions see fresh values
 * without a manual refresh.
 */
export function revalidateWeeklyEntryPaths(): void {
  revalidatePath("/weekly");
  revalidatePath("/dashboard");
  revalidatePath("/synthesis");
  revalidatePath("/history");
  revalidatePath("/alerts");
}

/**
 * Back-compute the KR's currentValue from the submitted progress so the
 * persisted score matches what the PO sees in the slider. The form sends a
 * 0–1 progress; for NUMERIC/PERCENTAGE the score is currentValue/target
 * (or the inverse formula), so we solve for currentValue. BINARY snaps to
 * 0 or 1; DATE has no numeric currentValue.
 *
 * If the caller passes an explicit `currentValue`, it wins — the future
 * "enter the raw value" UI can use that path.
 */
export function effectiveCurrentValue(
  kr: {
    krType: KrType;
    target: number | null;
    isInverse: boolean;
    currentValue: number;
  },
  input: { progress: number; currentValue?: number }
): number {
  if (input.currentValue !== undefined) return input.currentValue;

  switch (kr.krType) {
    case "BINARY":
      return input.progress >= 0.5 ? 1 : 0;
    case "DATE":
      // Score is derived from `progress` directly; currentValue is unused
      return kr.currentValue;
    case "NUMERIC":
    case "PERCENTAGE":
      if (kr.target === null) return kr.currentValue;
      if (!kr.isInverse) return input.progress * kr.target;
      // Inverse: score = (start − cv) / (start − target). Solve for cv.
      // start defaults to target * 3 (matches lib/score.ts).
      const start = kr.target * 3;
      if (start <= kr.target) return kr.target;
      return start - input.progress * (start - kr.target);
  }
}

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

  const effectiveValue = effectiveCurrentValue(kr, input);
  const newScore = calculateScore(
    kr.krType,
    effectiveValue,
    kr.target,
    input.progress,
    kr.isInverse
  );

  const prev = getPreviousISOWeek(input.year, input.weekNumber);
  const previousEntry = await tx.weeklyEntry.findFirst({
    where: {
      krId: input.krId,
      year: prev.year,
      weekNumber: prev.weekNumber,
    },
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
      // Honor the PO's manual status override on the KR record too. Without
      // this, the dashboard would show derivedStatus while the weekly entry
      // showed what the PO selected — "I set Bloqué but the dashboard is
      // green."
      status: input.status ?? derivedStatus,
      currentValue: effectiveValue,
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
