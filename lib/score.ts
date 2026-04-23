import type { KrType, KrStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Calculate the score for a Key Result.
 * Returns a value between 0.0 and 1.0.
 *
 * Rules:
 * - BINARY:     score = 0 or 1 (never intermediate)
 * - DATE:       score = progress (manual 0–1 from PO)
 * - NUMERIC/PERCENTAGE (normal):  score = currentValue / target
 * - NUMERIC/PERCENTAGE (inverse): score = 1 - (currentValue / startValue)
 *   where startValue is the "bad" starting point (e.g. cost was 5$, target <3$)
 *   For inverse KRs: reaching target = 100%, exceeding target = still 100%
 */
export function calculateScore(
  krType: KrType,
  currentValue: number,
  target: number | null,
  progress?: number,
  isInverse?: boolean,
  startValue?: number | null
): number {
  switch (krType) {
    case "BINARY":
      return currentValue >= 1 ? 1 : 0;

    case "DATE":
      // PO enters manual progress 0.0–1.0
      return Math.max(0, Math.min(1, progress ?? 0));

    case "NUMERIC":
    case "PERCENTAGE":
      if (target === null || target === undefined) return 0;

      if (isInverse) {
        // Lower is better: score increases as currentValue approaches target from above
        // Example: target=3$ (cost goal), startValue=10$ (initial cost), current=5$
        // score = (start - current) / (start - target) = (10-5)/(10-3) = 71%
        const start = startValue ?? target * 3; // Default: assume start is 3x target
        if (start <= target) return currentValue <= target ? 1 : 0;
        if (currentValue <= target) return 1; // Already at or below target = perfect
        if (currentValue >= start) return 0;  // At or worse than start = 0
        return (start - currentValue) / (start - target);
      }

      if (target === 0) {
        return currentValue === 0 ? 1 : 0;
      }
      const raw = currentValue / target;
      return Math.max(0, Math.min(1, raw));

    default:
      return 0;
  }
}

/**
 * Convert a 0.0–1.0 score to a rounded percentage (0–100).
 * Never expose raw floats to the UI.
 */
export function scoreToPercent(score: number | Decimal): number {
  const num = typeof score === "number" ? score : Number(score);
  return Math.round(num * 100);
}

/**
 * Derive KR status from score percentage.
 *
 * ≥ 70% → ON_TRACK  🟢
 * ≥ 40% → AT_RISK   🟡
 * < 40% → BLOCKED   🔴
 * 0% with no entries → NOT_STARTED ⚪
 */
export function deriveStatus(
  scorePercent: number,
  hasEntries: boolean
): KrStatus {
  if (!hasEntries && scorePercent === 0) return "NOT_STARTED";
  if (scorePercent >= 70) return "ON_TRACK";
  if (scorePercent >= 40) return "AT_RISK";
  return "BLOCKED";
}

/**
 * Calculate delta between current and previous week score.
 */
export function calculateDelta(
  currentScore: number,
  previousScore: number | null
): number {
  if (previousScore === null) return 0;
  return currentScore - previousScore;
}

/**
 * Calculate the average score for an objective (mean of its KRs).
 */
export function objectiveScore(krScores: (number | Decimal)[]): number {
  if (krScores.length === 0) return 0;
  let sum = 0;
  for (const s of krScores) {
    sum += typeof s === "number" ? s : Number(s);
  }
  return sum / krScores.length;
}
