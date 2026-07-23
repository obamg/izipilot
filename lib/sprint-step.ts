/**
 * Sous-tâche ("étape") logic — pure helpers, no Prisma access, so the
 * permission / progress rules stay unit-testable.
 *
 * A step is a real mini-work-item nested under a SprintTask: it has its own
 * status / story points / assignee. Progress (done/total) is surfaced on the
 * board card; CANCELLED steps are excluded from the total.
 */

import type { ActionStatus, UserRole } from "@prisma/client";

const PRIVILEGED: ReadonlyArray<UserRole> = ["CEO", "MANAGEMENT"];

/** Minimal step shape the permission helpers reason over. */
export interface StepLike {
  assigneeId: string | null;
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
 * Who may move a step (status / sortOrder): CEO / MANAGEMENT / PO always,
 * a CONTRIBUTOR when the parent task OR the step itself is assigned to them.
 */
export function canUpdateStepStatus(
  step: StepLike,
  task: TaskLike,
  viewer: Viewer
): boolean {
  if (viewer.role === "VIEWER") return false;
  if (PRIVILEGED.includes(viewer.role) || viewer.role === "PO") return true;
  return (
    task.assigneeId === viewer.userId || step.assigneeId === viewer.userId
  );
}

/**
 * Who may edit a step's details (title / points / assignee): CEO / MANAGEMENT
 * / PO always, a CONTRIBUTOR only for steps they created on their own task.
 */
export function canEditStepDetails(
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
 * Who may delete a step: CEO / MANAGEMENT any, PO any visible task, a
 * CONTRIBUTOR only steps they created themselves.
 */
export function canDeleteStep(step: StepLike, viewer: Viewer): boolean {
  if (viewer.role === "VIEWER") return false;
  if (PRIVILEGED.includes(viewer.role) || viewer.role === "PO") return true;
  return step.createdById === viewer.userId;
}

/**
 * Aggregate progress for the board chip: done / total, CANCELLED excluded
 * from the total. percent is always rounded (never a raw float).
 */
export function stepProgress(steps: ReadonlyArray<{ status: ActionStatus }>): {
  done: number;
  total: number;
  percent: number;
} {
  let done = 0;
  let total = 0;
  for (const s of steps) {
    if (s.status === "CANCELLED") continue;
    total++;
    if (s.status === "DONE") done++;
  }
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
