/**
 * Recurring-task ("tâche récurrente") logic — pure helpers, no Prisma access,
 * so the cadence math and permission rules stay unit-testable.
 *
 * A RecurringTask is a template. A daily cron clones it into a real SprintTask
 * whenever it is due, then advances `nextRunAt` to the following occurrence.
 * All date math runs in UTC at day granularity (00:00 UTC), matching how the
 * cron and the DB store `nextRunAt`.
 */

import type { RecurrenceFrequency, UserRole } from "@prisma/client";

const MANAGERS: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT", "PO"];

/** Roles allowed to create / edit / delete recurring-task templates. */
export function canManageRecurring(role: UserRole): boolean {
  return MANAGERS.includes(role);
}

// ── Cadence math ─────────────────────────────────────────────────────────────

/** Midnight-UTC of the given instant's calendar day. */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** MONTHLY day-of-month is capped at 28 so every month has it. */
export function clampMonthDay(day: number): number {
  return Math.min(Math.max(Math.trunc(day), 1), 28);
}

/**
 * The next occurrence strictly AFTER `after`, at 00:00 UTC.
 *
 * Used both to seed a template's first `nextRunAt` (from "today") and to
 * advance it after each spawn. Strictly-after semantics mean a task never
 * fires twice for the same day.
 *
 *  - DAILY   → the following day.
 *  - WEEKLY  → the next date whose UTC weekday matches `weekday` (0=Sun..6=Sat),
 *              defaulting to Monday when unset.
 *  - MONTHLY → the `monthDay` (1..28) of this month if still ahead, else of the
 *              next month.
 */
export function computeNextRun(
  after: Date,
  frequency: RecurrenceFrequency,
  weekday: number | null,
  monthDay: number | null
): Date {
  const base = startOfUtcDay(after);

  switch (frequency) {
    case "DAILY": {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    }
    case "WEEKLY": {
      const target = weekday ?? 1; // default Monday
      const d = new Date(base);
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() !== target);
      return d;
    }
    case "MONTHLY": {
      const target = clampMonthDay(monthDay ?? 1);
      const d = new Date(base);
      d.setUTCDate(target);
      if (d <= base) {
        // Target day already reached this month → jump to next month.
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + 1);
        d.setUTCDate(target);
      }
      return d;
    }
    case "PER_SPRINT":
      // Event-driven (spawned when a sprint is activated), never date-scheduled.
      // Callers must not schedule it — they store nextRunAt = null instead.
      throw new Error("computeNextRun is not defined for PER_SPRINT");
  }
}

/**
 * Advance a due `nextRunAt` past `now`, skipping any missed occurrences so a
 * cron that was down for days spawns ONE catch-up task, not a backlog of them.
 * Returns the same instant when it is already in the future.
 */
export function advancePastNow(
  nextRunAt: Date,
  now: Date,
  frequency: RecurrenceFrequency,
  weekday: number | null,
  monthDay: number | null
): Date {
  let next = nextRunAt;
  // Bound the loop defensively (a decade of daily runs) against bad data.
  for (let i = 0; i < 4000 && next <= now; i++) {
    next = computeNextRun(next, frequency, weekday, monthDay);
  }
  return next;
}

/**
 * A date-scheduled template is due when active and its next run is at or before
 * `now`. PER_SPRINT templates carry a null `nextRunAt` and are never date-due —
 * they are spawned on sprint activation instead, so this returns false for them.
 */
export function isDue(
  template: { isActive: boolean; nextRunAt: Date | null },
  now: Date
): boolean {
  return template.isActive && template.nextRunAt != null && template.nextRunAt <= now;
}

// ── Labels (French) ──────────────────────────────────────────────────────────

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  DAILY: "Quotidienne",
  WEEKLY: "Hebdomadaire",
  MONTHLY: "Mensuelle",
  PER_SPRINT: "Par sprint",
};

// 0 = dimanche … 6 = samedi (JS getUTCDay convention).
export const WEEKDAY_LABELS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

function ordinalFr(n: number): string {
  return n === 1 ? "1er" : String(n);
}

/** Human cadence, e.g. "Chaque lundi", "Le 15 de chaque mois", "Tous les jours". */
export function cadenceLabel(t: {
  frequency: RecurrenceFrequency;
  weekday: number | null;
  monthDay: number | null;
}): string {
  switch (t.frequency) {
    case "DAILY":
      return "Tous les jours";
    case "WEEKLY":
      return `Chaque ${WEEKDAY_LABELS[t.weekday ?? 1]}`;
    case "MONTHLY":
      return `Le ${ordinalFr(clampMonthDay(t.monthDay ?? 1))} de chaque mois`;
    case "PER_SPRINT":
      return "À chaque sprint";
  }
}
