/**
 * Sprint metrics — pure functions for stats, burndown, velocity and capacity.
 * No DB / Prisma client access here so the logic stays unit-testable.
 *
 * Conventions:
 * - "points" of a task = its storyPoints when set (> 0), otherwise 1, so that
 *   unestimated tasks still contribute to burndown/velocity.
 * - CANCELLED tasks are out of scope: excluded from every total.
 */

import type { ActionStatus, SprintStatus } from "@prisma/client";

// Minimal shapes the metrics need — keeps callers free to pass richer rows.
export interface SprintTaskLike {
  status: ActionStatus;
  storyPoints: number | null;
  completedAt: Date | null;
  assigneeId: string | null;
}

export interface SprintLike {
  startDate: Date;
  endDate: Date;
}

/** Effective points for a task (unestimated tasks count as 1). */
export function taskPoints(task: { storyPoints: number | null }): number {
  return task.storyPoints && task.storyPoints > 0 ? task.storyPoints : 1;
}

function isCounted(t: SprintTaskLike): boolean {
  return t.status !== "CANCELLED";
}

/**
 * Task statuses that are still "open" — these roll over to the next sprint (or
 * the backlog) when a sprint is closed. DONE / CANCELLED stay on the sprint.
 * An allowlist so a future status never carries over by accident.
 */
export const UNFINISHED_STATUSES: ActionStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
];

export function isUnfinished(status: ActionStatus): boolean {
  return UNFINISHED_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Sprint stats
// ---------------------------------------------------------------------------

export interface SprintStats {
  totalTasks: number;
  doneTasks: number;
  totalPoints: number;
  donePoints: number;
  /** Completion by points, 0–100, rounded. */
  percentComplete: number;
}

export function computeSprintStats(tasks: SprintTaskLike[]): SprintStats {
  const counted = tasks.filter(isCounted);
  const done = counted.filter((t) => t.status === "DONE");
  const totalPoints = counted.reduce((s, t) => s + taskPoints(t), 0);
  const donePoints = done.reduce((s, t) => s + taskPoints(t), 0);
  return {
    totalTasks: counted.length,
    doneTasks: done.length,
    totalPoints,
    donePoints,
    percentComplete:
      totalPoints === 0 ? 0 : Math.round((donePoints / totalPoints) * 100),
  };
}

/** Narrow an arbitrary JSON value to SprintStats, or null if it doesn't fit. */
function coerceStats(v: unknown): SprintStats | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const keys: (keyof SprintStats)[] = [
    "totalTasks",
    "doneTasks",
    "totalPoints",
    "donePoints",
    "percentComplete",
  ];
  if (keys.some((k) => typeof o[k] !== "number")) return null;
  return {
    totalTasks: o.totalTasks as number,
    doneTasks: o.doneTasks as number,
    totalPoints: o.totalPoints as number,
    donePoints: o.donePoints as number,
    percentComplete: o.percentComplete as number,
  };
}

/**
 * Stats to display for a sprint. A COMPLETED sprint uses the snapshot frozen at
 * close (via `statsSnapshot`) so its committed/done figures survive unfinished
 * tasks being carried out; every other sprint is computed live from its tasks.
 * Falls back to live compute when a completed sprint has no snapshot (legacy).
 */
export function displaySprintStats(
  sprint: { status: SprintStatus; statsSnapshot: unknown },
  tasks: SprintTaskLike[]
): SprintStats {
  if (sprint.status === "COMPLETED") {
    const snap = coerceStats(sprint.statsSnapshot);
    if (snap) return snap;
  }
  return computeSprintStats(tasks);
}

// ---------------------------------------------------------------------------
// Carry-over on sprint close
// ---------------------------------------------------------------------------

export interface SprintCandidate {
  number: number;
  status: SprintStatus;
}

/**
 * The sprint that unfinished work rolls into when the sprint numbered
 * `completedNumber` is closed: the lowest-numbered PLANNED/ACTIVE sprint that
 * comes after it. Returns null when there is none — the caller then sends the
 * tasks to the backlog. Generic so callers keep their extra fields (id, name).
 */
export function pickCarryTarget<T extends SprintCandidate>(
  candidates: T[],
  completedNumber: number
): T | null {
  return (
    candidates
      .filter(
        (s) =>
          s.number > completedNumber &&
          (s.status === "PLANNED" || s.status === "ACTIVE")
      )
      .sort((a, b) => a.number - b.number)[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Burndown
// ---------------------------------------------------------------------------

export interface BurndownPoint {
  /** yyyy-mm-dd */
  date: string;
  /** dd/mm — short axis label */
  label: string;
  /** Ideal remaining points (linear from total → 0). */
  ideal: number;
  /** Actual remaining points; null for days after `now` (not yet reached). */
  remaining: number | null;
}

/**
 * Day-by-day burndown across the sprint window (inclusive of both ends).
 * `ideal` is a straight line from total points to 0; `remaining` is the real
 * outstanding work (total − points DONE by end of that day). Days strictly
 * after `now` get a null `remaining` so the actual line stops at "today".
 */
export function computeBurndown(
  sprint: SprintLike,
  tasks: SprintTaskLike[],
  now: Date = new Date()
): BurndownPoint[] {
  const counted = tasks.filter(isCounted);
  const totalPoints = counted.reduce((s, t) => s + taskPoints(t), 0);
  const days = enumerateDays(sprint.startDate, sprint.endDate);
  const n = days.length;
  const nowMs = endOfDay(now).getTime();

  return days.map((day, i) => {
    const ideal = n <= 1 ? 0 : round1(totalPoints * (1 - i / (n - 1)));
    let remaining: number | null = null;
    const dayEndMs = endOfDay(day).getTime();
    if (dayEndMs <= nowMs) {
      const donePoints = counted
        .filter(
          (t) =>
            t.status === "DONE" &&
            t.completedAt != null &&
            t.completedAt.getTime() <= dayEndMs
        )
        .reduce((s, t) => s + taskPoints(t), 0);
      remaining = totalPoints - donePoints;
    }
    return { date: toISODate(day), label: toLabel(day), ideal, remaining };
  });
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

export interface VelocityPoint {
  name: string;
  committedPoints: number;
  completedPoints: number;
}

/**
 * Committed vs completed points per sprint (oldest → newest as passed in). When
 * a `snapshot` is provided (a closed sprint's frozen stats) it is used verbatim,
 * so carrying unfinished tasks out of the sprint doesn't rewrite its velocity.
 */
export function computeVelocity(
  sprints: {
    name: string;
    tasks: SprintTaskLike[];
    snapshot?: SprintStats | null;
  }[]
): VelocityPoint[] {
  return sprints.map((s) => {
    if (s.snapshot) {
      return {
        name: s.name,
        committedPoints: s.snapshot.totalPoints,
        completedPoints: s.snapshot.donePoints,
      };
    }
    const counted = s.tasks.filter(isCounted);
    return {
      name: s.name,
      committedPoints: counted.reduce((sum, t) => sum + taskPoints(t), 0),
      completedPoints: counted
        .filter((t) => t.status === "DONE")
        .reduce((sum, t) => sum + taskPoints(t), 0),
    };
  });
}

/** Average completed points across the given (typically completed) sprints. */
export function averageVelocity(velocity: VelocityPoint[]): number {
  if (velocity.length === 0) return 0;
  const sum = velocity.reduce((s, v) => s + v.completedPoints, 0);
  return Math.round((sum / velocity.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export interface CapacityRow {
  userId: string;
  capacityPoints: number;
  assignedPoints: number;
  /** assigned / capacity, 0–∞ as %, rounded; 0 when no capacity set. */
  utilizationPct: number;
}

/**
 * Per-member capacity vs assigned story points for a sprint. Returns a row for
 * every user that either has a capacity set or has work assigned.
 */
export function computeCapacityUtilization(
  capacities: { userId: string; capacityPoints: number }[],
  tasks: SprintTaskLike[]
): CapacityRow[] {
  const assigned = new Map<string, number>();
  for (const t of tasks) {
    if (!isCounted(t) || !t.assigneeId) continue;
    assigned.set(t.assigneeId, (assigned.get(t.assigneeId) ?? 0) + taskPoints(t));
  }
  const capacity = new Map(capacities.map((c) => [c.userId, c.capacityPoints]));
  const userIds = new Set<string>([...capacity.keys(), ...assigned.keys()]);

  return [...userIds].map((userId) => {
    const capacityPoints = capacity.get(userId) ?? 0;
    const assignedPoints = assigned.get(userId) ?? 0;
    return {
      userId,
      capacityPoints,
      assignedPoints,
      utilizationPct:
        capacityPoints === 0
          ? 0
          : Math.round((assignedPoints / capacityPoints) * 100),
    };
  });
}

// ---------------------------------------------------------------------------
// Availability (idle / no-ongoing detection)
// ---------------------------------------------------------------------------

/**
 * - IDLE       → no task assigned in the sprint (CANCELLED ignored).
 * - NO_ONGOING → has task(s) but none IN_PROGRESS (all TODO / BLOCKED / DONE).
 * - ACTIVE     → at least one IN_PROGRESS task.
 */
export type AvailabilityState = "IDLE" | "NO_ONGOING" | "ACTIVE";

export interface AvailabilityMember {
  userId: string;
  /** Counted tasks assigned (excludes CANCELLED). */
  total: number;
  inProgress: number;
  todo: number;
  blocked: number;
  done: number;
  state: AvailabilityState;
}

export interface AvailabilityReport {
  /** One row per roster user, in the order the roster was passed. */
  members: AvailabilityMember[];
  /** userIds with no task at all (state IDLE). */
  noTask: string[];
  /** Members with task(s) but nothing IN_PROGRESS (state NO_ONGOING). */
  noOngoing: AvailabilityMember[];
  /** Count of members with ≥1 IN_PROGRESS task (state ACTIVE). */
  activeCount: number;
}

/**
 * Classify every roster member by their workload in the given task set. Only
 * counted (non-CANCELLED) tasks with an assignee contribute; unassigned tasks
 * are ignored. Users with no matching task are IDLE.
 */
export function computeAvailability(
  users: { id: string }[],
  tasks: SprintTaskLike[]
): AvailabilityReport {
  const tally = new Map<
    string,
    { total: number; inProgress: number; todo: number; blocked: number; done: number }
  >();
  for (const t of tasks) {
    if (!isCounted(t) || !t.assigneeId) continue;
    const row =
      tally.get(t.assigneeId) ??
      { total: 0, inProgress: 0, todo: 0, blocked: 0, done: 0 };
    row.total += 1;
    if (t.status === "IN_PROGRESS") row.inProgress += 1;
    else if (t.status === "TODO") row.todo += 1;
    else if (t.status === "BLOCKED") row.blocked += 1;
    else if (t.status === "DONE") row.done += 1;
    tally.set(t.assigneeId, row);
  }

  const members: AvailabilityMember[] = users.map((u) => {
    const r =
      tally.get(u.id) ??
      { total: 0, inProgress: 0, todo: 0, blocked: 0, done: 0 };
    const state: AvailabilityState =
      r.total === 0 ? "IDLE" : r.inProgress > 0 ? "ACTIVE" : "NO_ONGOING";
    return { userId: u.id, ...r, state };
  });

  return {
    members,
    noTask: members.filter((m) => m.state === "IDLE").map((m) => m.userId),
    noOngoing: members.filter((m) => m.state === "NO_ONGOING"),
    activeCount: members.filter((m) => m.state === "ACTIVE").length,
  };
}

// ---------------------------------------------------------------------------
// Date helpers (local-day based, deterministic)
// ---------------------------------------------------------------------------

function enumerateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = startOfDay(start);
  const last = startOfDay(end);
  // Guard against inverted ranges.
  if (cur.getTime() > last.getTime()) return [new Date(cur)];
  while (cur.getTime() <= last.getTime()) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Misc helpers used by API/UI
// ---------------------------------------------------------------------------

/** Whole days left until sprint end (>= 0). */
export function daysRemaining(endDate: Date, now: Date = new Date()): number {
  const ms = startOfDay(endDate).getTime() - startOfDay(now).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
