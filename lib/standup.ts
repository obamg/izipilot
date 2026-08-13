/**
 * Daily standup helpers — pure functions so the aggregation stays unit-testable.
 *
 * Standups are keyed by the West-Africa-Time (WAT, UTC+1, no DST) calendar day,
 * stored in a `@db.Date` column as a UTC-midnight Date.
 */

const WAT_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no daylight saving

/** Today's WAT calendar date as a UTC-midnight Date (pairs with `@db.Date`). */
export function watDateOnly(now: Date = new Date()): Date {
  const wat = new Date(now.getTime() + WAT_OFFSET_MS);
  return new Date(Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()));
}

/**
 * The real UTC instant at which the current WAT calendar day begins
 * (WAT 00:00 = UTC 23:00 the previous day). Use this as a `createdAt >= …`
 * threshold to dedup "already done today" against real timestamps.
 */
export function watDayStartUtc(now: Date = new Date()): Date {
  return new Date(watDateOnly(now).getTime() - WAT_OFFSET_MS);
}

/** yyyy-mm-dd key for a UTC-midnight date. */
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a yyyy-mm-dd string into a UTC-midnight Date, or null if invalid. */
export function parseDateKey(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

export interface StandupRecord {
  userId: string;
  yesterday: string | null;
  today: string | null;
  blockers: string | null;
  updatedAt: string | null;
}

export interface RosterMember {
  id: string;
  name: string;
}

export interface StandupReportRow {
  userId: string;
  userName: string;
  yesterday: string | null;
  today: string | null;
  blockers: string | null;
  updatedAt: string | null;
  submitted: boolean;
}

export interface StandupReport {
  rows: StandupReportRow[];
  submittedCount: number;
  totalCount: number;
  blockers: { userId: string; userName: string; blockers: string }[];
}

function hasContent(s: StandupRecord | undefined): boolean {
  return Boolean(
    s && ((s.yesterday && s.yesterday.trim()) || (s.today && s.today.trim()) || (s.blockers && s.blockers.trim()))
  );
}

/**
 * Merge the sprint roster with a day's standups → one row per member, the
 * participation counts, and a flattened blockers list (members reporting a
 * blocker float to the top). The roster is assumed to already include every
 * standup author (the API builds it as the union of assignees + capacity
 * members + authors).
 */
export function mergeStandups(
  roster: RosterMember[],
  standups: StandupRecord[]
): StandupReport {
  const byUser = new Map(standups.map((s) => [s.userId, s]));

  const rows: StandupReportRow[] = roster.map((m) => {
    const s = byUser.get(m.id);
    return {
      userId: m.id,
      userName: m.name,
      yesterday: s?.yesterday ?? null,
      today: s?.today ?? null,
      blockers: s?.blockers ?? null,
      updatedAt: s?.updatedAt ?? null,
      submitted: hasContent(s),
    };
  });

  rows.sort((a, b) => {
    const aBlock = a.blockers && a.blockers.trim() ? 0 : 1;
    const bBlock = b.blockers && b.blockers.trim() ? 0 : 1;
    if (aBlock !== bBlock) return aBlock - bBlock;
    if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
    return a.userName.localeCompare(b.userName);
  });

  const blockers = rows
    .filter((r) => r.blockers && r.blockers.trim())
    .map((r) => ({ userId: r.userId, userName: r.userName, blockers: r.blockers!.trim() }));

  return {
    rows,
    submittedCount: rows.filter((r) => r.submitted).length,
    totalCount: roster.length,
    blockers,
  };
}
