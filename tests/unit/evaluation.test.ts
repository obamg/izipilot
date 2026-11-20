import { describe, it, expect } from "vitest";
import {
  deliveryScoreFromRatio,
  overallScore,
  expectedStandupDays,
  standupRatio,
  manualAverage,
  computeDelivery,
  monthRange,
  recentMonths,
  avgDefined,
  round1,
  matchesEvaluationFilters,
  type DeliveryTaskLike,
  type EvaluationFilterSubject,
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

  it("sans standup : livraison + manuels renormalisés (≈ 59/41)", () => {
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

describe("recentMonths", () => {
  it("returns count months ending at (year, month), oldest → newest, crossing years", () => {
    const m = recentMonths(2026, 2, 4);
    expect(m.map((x) => `${x.month}/${x.year}`)).toEqual([
      "11/2025",
      "12/2025",
      "1/2026",
      "2/2026",
    ]);
    expect(m[3].label).toBe("02/26");
  });
});

describe("avgDefined", () => {
  it("averages defined numbers, ignoring null/undefined", () => {
    expect(avgDefined([4, null, 2, undefined])).toBe(3);
    expect(avgDefined([null, undefined])).toBeNull();
    expect(avgDefined([])).toBeNull();
  });
});

describe("matchesEvaluationFilters", () => {
  const base: EvaluationFilterSubject = {
    role: "CONTRIBUTOR",
    isRated: false,
    departmentIds: ["d1"],
  };

  it("passes everyone when every filter is ALL", () => {
    expect(matchesEvaluationFilters(base, { department: "ALL", status: "ALL", role: "ALL" })).toBe(
      true
    );
  });

  it("filters by department membership", () => {
    expect(matchesEvaluationFilters(base, { department: "d1", status: "ALL", role: "ALL" })).toBe(
      true
    );
    expect(matchesEvaluationFilters(base, { department: "d2", status: "ALL", role: "ALL" })).toBe(
      false
    );
  });

  it("filters by rated status", () => {
    expect(
      matchesEvaluationFilters(base, { department: "ALL", status: "RATED", role: "ALL" })
    ).toBe(false);
    expect(
      matchesEvaluationFilters(
        { ...base, isRated: true },
        { department: "ALL", status: "RATED", role: "ALL" }
      )
    ).toBe(true);
    expect(
      matchesEvaluationFilters(
        { ...base, isRated: true },
        { department: "ALL", status: "UNRATED", role: "ALL" }
      )
    ).toBe(false);
  });

  it("filters by role", () => {
    expect(matchesEvaluationFilters(base, { department: "ALL", status: "ALL", role: "PO" })).toBe(
      false
    );
    expect(
      matchesEvaluationFilters(base, { department: "ALL", status: "ALL", role: "CONTRIBUTOR" })
    ).toBe(true);
  });

  it("requires every active filter to match at once", () => {
    expect(
      matchesEvaluationFilters(base, { department: "d1", status: "UNRATED", role: "CONTRIBUTOR" })
    ).toBe(true);
    expect(
      matchesEvaluationFilters(base, { department: "d1", status: "RATED", role: "CONTRIBUTOR" })
    ).toBe(false);
  });
});

describe("point du jour dans la note", () => {
  const manual = { quality: 4, collaboration: 4, initiative: 4 }; // avg 4
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it("pondère 50 % livraison + 15 % standup + 35 % manuels", () => {
    // 0.5*5 + 0.15*2 + 0.35*4 = 4.2
    expect(overallScore(5, manual, 2)).toBe(4.2);
  });

  it("sans livraison : standup 30 / manuels 70", () => {
    // (0.15*2 + 0.35*4) / 0.5 = 3.4
    expect(overallScore(null, manual, 2)).toBe(3.4);
  });

  it("compte les jours ouvrés couverts par un sprint, jusqu'au dernier jour", () => {
    // Novembre 2026 : le 1er est un dimanche. Sprint du lundi 2 au vendredi 13.
    const days = expectedStandupDays([{ start: d("2026-11-02"), end: d("2026-11-13") }], 2026, 11, d("2026-11-30"));
    expect(days.size).toBe(10);
    expect(days.has("2026-11-07")).toBe(false); // samedi
    // Arrêt au mercredi 4
    expect(expectedStandupDays([{ start: d("2026-11-02"), end: d("2026-11-13") }], 2026, 11, d("2026-11-04")).size).toBe(3);
    // Sprint à cheval sur deux mois : seuls les jours du mois comptent ; chevauchement compté une fois.
    const overlap = expectedStandupDays(
      [
        { start: d("2026-10-26"), end: d("2026-11-06") },
        { start: d("2026-11-05"), end: d("2026-11-10") },
      ],
      2026, 11, d("2026-11-30")
    );
    expect(overlap.size).toBe(7); // 2,3,4,5,6 + 9,10
  });

  it("retire les absences justifiées du dénominateur", () => {
    expect(standupRatio(17, 20, 0)).toBe(0.85);
    expect(standupRatio(17, 20, 3)).toBe(1);
    expect(standupRatio(18, 20, 3)).toBe(1); // plafonné
    expect(standupRatio(0, 20, 20)).toBeNull();
    expect(standupRatio(0, 0, 0)).toBeNull();
  });
});
