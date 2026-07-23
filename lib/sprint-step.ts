/**
 * Étape (checklist) logic — pure helpers, no Prisma access, so the
 * permission / progress rules stay unit-testable.
 *
 * A step is a checklist item nested under a SprintTask: a title + a done
 * checkbox, ordered. Progress (done/total) is surfaced on the board card.
 */

import type { UserRole } from "@prisma/client";

const PRIVILEGED: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT"];

/** Minimal step shape the permission helpers reason over. */
export interface StepLike {
  createdById: string;
}

export interface TaskLike {
  assigneeId: string | null;
}

export interface Viewer {
  userId: string;
  role: UserRole;
}

/**
 * Who may add a step to a task: CEO / MANAGEMENT / PO on any visible task,
 * a CONTRIBUTOR only on their own assigned task (breaking down their own
 * work), VIEWER never. Mirrors canRaiseRequest.
 */
export function canAddStep(task: TaskLike, viewer: Viewer): boolean {
  if (viewer.role === "VIEWER") return false;
  if (PRIVILEGED.includes(viewer.role) || viewer.role === "PO") return true;
  return task.assigneeId === viewer.userId; // CONTRIBUTOR
}

/**
 * Who may check / uncheck / reorder a step: CEO / MANAGEMENT / PO always,
 * a CONTRIBUTOR when the parent task is assigned to them.
 */
export function canToggleStep(task: TaskLike, viewer: Viewer): boolean {
  if (viewer.role === "VIEWER") return false;
  if (PRIVILEGED.includes(viewer.role) || viewer.role === "PO") return true;
  return task.assigneeId === viewer.userId; // CONTRIBUTOR
}

/**
 * Who may rename a step: CEO / MANAGEMENT / PO always, a CONTRIBUTOR only
 * for steps they created on their own task.
 */
export function canEditStep(
  step: StepLike,
  task: TaskLike,
  viewer: Viewer
): boolean {
  if (viewer.role === "VIEWER") return false;
  if (PRIVILEGED.includes(viewer.role) || viewer.role === "PO") return true;
  return (
    step.createdById === viewer.userId && task.assigneeId === viewer.userId
  );
}

/**
 * Who may delete a step: CEO / MANAGEMENT / PO always, a CONTRIBUTOR only
 * steps they created themselves.
 */
export function canDeleteStep(step: StepLike, viewer: Viewer): boolean {
  if (viewer.role === "VIEWER") return false;
  if (PRIVILEGED.includes(viewer.role) || viewer.role === "PO") return true;
  return step.createdById === viewer.userId;
}

/**
 * Aggregate progress for the board chip: checked / total. percent is always
 * rounded (never a raw float).
 */
export function stepProgress(steps: ReadonlyArray<{ done: boolean }>): {
  done: number;
  total: number;
  percent: number;
} {
  const total = steps.length;
  let done = 0;
  for (const s of steps) if (s.done) done++;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
