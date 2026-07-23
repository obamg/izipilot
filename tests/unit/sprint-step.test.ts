import { describe, it, expect } from "vitest";
import type { ActionStatus } from "@prisma/client";
import {
  canAddStep,
  canUpdateStepStatus,
  canEditStepDetails,
  canDeleteStep,
  stepProgress,
  type StepLike,
  type TaskLike,
  type Viewer,
} from "@/lib/sprint-step";

function step(over: Partial<StepLike> = {}): StepLike {
  return { assigneeId: null, createdById: "creator", ...over };
}

function task(over: Partial<TaskLike> = {}): TaskLike {
  return { assigneeId: null, ...over };
}

function viewer(over: Partial<Viewer> = {}): Viewer {
  return { userId: "u1", role: "CONTRIBUTOR", ...over };
}

// ---------------------------------------------------------------------------
// canAddStep
// ---------------------------------------------------------------------------
describe("canAddStep", () => {
  it("allows CEO / MANAGEMENT / PO on any task", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canAddStep(task(), viewer({ role }))).toBe(true);
    }
  });
  it("allows a CONTRIBUTOR only on their own assigned task", () => {
    expect(canAddStep(task({ assigneeId: "u1" }), viewer())).toBe(true);
    expect(canAddStep(task({ assigneeId: "u2" }), viewer())).toBe(false);
    expect(canAddStep(task(), viewer())).toBe(false);
  });
  it("never allows VIEWER", () => {
    expect(canAddStep(task({ assigneeId: "u1" }), viewer({ role: "VIEWER" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUpdateStepStatus
// ---------------------------------------------------------------------------
describe("canUpdateStepStatus", () => {
  it("allows CEO / MANAGEMENT / PO always", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canUpdateStepStatus(step(), task(), viewer({ role }))).toBe(true);
    }
  });
  it("allows a CONTRIBUTOR assigned to the parent task", () => {
    expect(canUpdateStepStatus(step(), task({ assigneeId: "u1" }), viewer())).toBe(true);
  });
  it("allows a CONTRIBUTOR assigned to the step itself", () => {
    expect(
      canUpdateStepStatus(step({ assigneeId: "u1" }), task({ assigneeId: "u2" }), viewer())
    ).toBe(true);
  });
  it("denies a CONTRIBUTOR assigned to neither", () => {
    expect(
      canUpdateStepStatus(step({ assigneeId: "u3" }), task({ assigneeId: "u2" }), viewer())
    ).toBe(false);
  });
  it("never allows VIEWER", () => {
    expect(
      canUpdateStepStatus(step({ assigneeId: "u1" }), task({ assigneeId: "u1" }), viewer({ role: "VIEWER" }))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canEditStepDetails
// ---------------------------------------------------------------------------
describe("canEditStepDetails", () => {
  it("allows CEO / MANAGEMENT / PO always", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canEditStepDetails(step(), task(), viewer({ role }))).toBe(true);
    }
  });
  it("allows a CONTRIBUTOR only for steps they created on their own task", () => {
    expect(
      canEditStepDetails(step({ createdById: "u1" }), task({ assigneeId: "u1" }), viewer())
    ).toBe(true);
    // Created it, but the task is no longer theirs.
    expect(
      canEditStepDetails(step({ createdById: "u1" }), task({ assigneeId: "u2" }), viewer())
    ).toBe(false);
    // Their task, but someone else created the step.
    expect(
      canEditStepDetails(step({ createdById: "u2" }), task({ assigneeId: "u1" }), viewer())
    ).toBe(false);
  });
  it("never allows VIEWER", () => {
    expect(
      canEditStepDetails(step({ createdById: "u1" }), task({ assigneeId: "u1" }), viewer({ role: "VIEWER" }))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canDeleteStep
// ---------------------------------------------------------------------------
describe("canDeleteStep", () => {
  it("allows CEO / MANAGEMENT / PO always", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canDeleteStep(step(), viewer({ role }))).toBe(true);
    }
  });
  it("allows a CONTRIBUTOR only for steps they created", () => {
    expect(canDeleteStep(step({ createdById: "u1" }), viewer())).toBe(true);
    expect(canDeleteStep(step({ createdById: "u2" }), viewer())).toBe(false);
  });
  it("never allows VIEWER", () => {
    expect(canDeleteStep(step({ createdById: "u1" }), viewer({ role: "VIEWER" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stepProgress
// ---------------------------------------------------------------------------
describe("stepProgress", () => {
  const of = (...statuses: ActionStatus[]) => statuses.map((status) => ({ status }));

  it("returns zeros for an empty list", () => {
    expect(stepProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
  it("counts DONE over non-cancelled steps", () => {
    expect(stepProgress(of("DONE", "IN_PROGRESS", "TODO"))).toEqual({
      done: 1,
      total: 3,
      percent: 33,
    });
  });
  it("excludes CANCELLED from the total", () => {
    expect(stepProgress(of("DONE", "CANCELLED"))).toEqual({
      done: 1,
      total: 1,
      percent: 100,
    });
  });
  it("treats BLOCKED as not done", () => {
    expect(stepProgress(of("BLOCKED", "DONE"))).toEqual({
      done: 1,
      total: 2,
      percent: 50,
    });
  });
  it("returns 0% when only cancelled steps exist", () => {
    expect(stepProgress(of("CANCELLED", "CANCELLED"))).toEqual({
      done: 0,
      total: 0,
      percent: 0,
    });
  });
  it("always rounds the percent", () => {
    expect(stepProgress(of("DONE", "DONE", "TODO"))).toEqual({
      done: 2,
      total: 3,
      percent: 67,
    });
  });
});
