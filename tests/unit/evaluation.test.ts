import { describe, it, expect } from "vitest";
import {
  deliveryScoreFromRatio,
  overallScore,
  manualAverage,
  computeDelivery,
  monthRange,
  round1,
  type DeliveryTaskLike,
} from "@/lib/evaluation";

describe("deliveryScoreFromRatio", () => {
  it("maps ratios to the /5 scale", () => {
    expect(deliveryScoreFromRatio(1.2)).toBe(5);
    expect(deliveryScoreFromRatio(1.0)).toBe(5);
    expect(deliveryScoreFromRatio(0.9)).toBe(4);
    expect(deliveryScoreFromRatio(0.7)).toBe(3.5);
    expect(deliveryScoreFromRatio(0.6)).toBe(2.5);
    expect(deliveryScoreFromRatio(0.3)).toBe(2);
    expect(deliveryScoreFromRatio(0.1)).toBe(1);
  });

  it("returns null when there is no delivery data", () => {
    expect(deliveryScoreFromRatio(null)).toBeNull();
    expect(deliveryScoreFromRatio(NaN)).toBeNull();
  });
});

describe("overallScore", () => {
  const manual = { quality: 4, collaboration: 4, initiative: 4 }; // avg 4

  it("blends 60% delivery + 40% manual", () => {
    // 0.6*5 + 0.4*4 = 3 + 1.6 = 4.6
    expect(overallScore(5, manual)).toBe(4.6);
    // 0.6*2.5 + 0.4*4 = 1.5 + 1.6 = 3.1
    expect(overallScore(2.5, manual)).toBe(3.1);
  });

  it("falls back to the manual average when delivery is unknown", () => {
    expect(overallScore(null, manual)).toBe(4);
    expect(overallScore(null, { quality: 5, collaboration: 4, initiative: 3 })).toBe(4);
  });
});

describe("manualAverage", () => {
  it("averages the three criteria", () => {
    expect(manualAverage({ quality: 3, collaboration: 3, initiative: 3 })).toBe(3);
    expect(round1(manualAverage({ quality: 5, collaboration: 4, initiative: 2 }))).toBe(3.7);
  });
});

describe("computeDelivery", () => {
  const due = new Date("2026-08-20T00:00:00Z");
  const tasks: DeliveryTaskLike[] = [
    { status: "DONE", storyPoints: 5, completedAt: new Date("2026-08-18T00:00:00Z"), dueDate: due },
    { status: "DONE", storyPoints: 3, completedAt: new Date("2026-08-25T00:00:00Z"), dueDate: due }, // late
    { status: "TODO", storyPoints: 2, completedAt: null, dueDate: null },
    { status: "CANCELLED", storyPoints: 8, completedAt: null, dueDate: null }, // excluded
  ];

  it("computes delivered/assigned/ratio against committed capacity", () => {
    const s = computeDelivery(tasks, 10);
    expect(s.deliveredPoints).toBe(8); // 5 + 3
    expect(s.assignedPoints).toBe(10); // 5 + 3 + 2 (CANCELLED excluded)
    expect(s.committedPoints).toBe(10); // capacity used
    expect(s.ratio).toBeCloseTo(0.8, 5);
    expect(s.tasksDone).toBe(2);
    expect(s.tasksTotal).toBe(3);
    expect(s.onTimeRate).toBeCloseTo(0.5, 5); // 1 of 2 due-dated done on time
  });

  it("falls back to assigned points when no capacity is set", () => {
    const s = computeDelivery(tasks, 0);
    expect(s.committedPoints).toBe(10); // = assignedPoints
    expect(s.ratio).toBeCloseTo(0.8, 5);
  });

  it("returns a null ratio when nothing is committed or assigned", () => {
    const s = computeDelivery([], 0);
    expect(s.ratio).toBeNull();
    expect(s.deliveredPoints).toBe(0);
    expect(s.onTimeRate).toBeNull();
  });

  it("treats unestimated tasks as 1 point", () => {
    const s = computeDelivery(
      [{ status: "DONE", storyPoints: null, completedAt: null, dueDate: null }],
      0
    );
    expect(s.deliveredPoints).toBe(1);
  });
});

describe("monthRange", () => {
  it("returns UTC month bounds, end exclusive", () => {
    const { start, end } = monthRange(2026, 8);
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
