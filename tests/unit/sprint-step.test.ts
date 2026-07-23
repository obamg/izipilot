import { describe, it, expect } from "vitest";
import {
  canAddStep,
  canToggleStep,
  canEditStep,
  canDeleteStep,
  stepProgress,
  type StepLike,
  type TaskLike,
  type Viewer,
} from "@/lib/sprint-step";

function step(over: Partial<StepLike> = {}): StepLike {
  return { createdById: "creator", ...over };
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
// canToggleStep
// ---------------------------------------------------------------------------
describe("canToggleStep", () => {
  it("allows CEO / MANAGEMENT / PO always", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canToggleStep(task(), viewer({ role }))).toBe(true);
    }
  });
  it("allows a CONTRIBUTOR only on their own assigned task", () => {
    expect(canToggleStep(task({ assigneeId: "u1" }), viewer())).toBe(true);
    expect(canToggleStep(task({ assigneeId: "u2" }), viewer())).toBe(false);
  });
  it("never allows VIEWER", () => {
    expect(canToggleStep(task({ assigneeId: "u1" }), viewer({ role: "VIEWER" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canEditStep
// ---------------------------------------------------------------------------
describe("canEditStep", () => {
  it("allows CEO / MANAGEMENT / PO always", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canEditStep(step(), task(), viewer({ role }))).toBe(true);
    }
  });
  it("allows a CONTRIBUTOR only for steps they created on their own task", () => {
    expect(
      canEditStep(step({ createdById: "u1" }), task({ assigneeId: "u1" }), viewer())
    ).toBe(true);
    // Created it, but the task is no longer theirs.
    expect(
      canEditStep(step({ createdById: "u1" }), task({ assigneeId: "u2" }), viewer())
    ).toBe(false);
    // Their task, but someone else created the step.
    expect(
      canEditStep(step({ createdById: "u2" }), task({ assigneeId: "u1" }), viewer())
    ).toBe(false);
  });
  it("never allows VIEWER", () => {
    expect(
      canEditStep(step({ createdById: "u1" }), task({ assigneeId: "u1" }), viewer({ role: "VIEWER" }))
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
  const of = (...dones: boolean[]) => dones.map((done) => ({ done }));

  it("returns zeros for an empty list", () => {
    expect(stepProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
  it("counts checked steps", () => {
    expect(stepProgress(of(true, false, false))).toEqual({
      done: 1,
      total: 3,
      percent: 33,
    });
  });
  it("reaches 100% when everything is checked", () => {
    expect(stepProgress(of(true, true))).toEqual({
      done: 2,
      total: 2,
      percent: 100,
    });
  });
  it("always rounds the percent", () => {
    expect(stepProgress(of(true, true, false))).toEqual({
      done: 2,
      total: 3,
      percent: 67,
    });
  });
});
