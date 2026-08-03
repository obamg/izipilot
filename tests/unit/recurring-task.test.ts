import { describe, it, expect } from "vitest";
import {
  canManageRecurring,
  clampMonthDay,
  computeNextRun,
  advancePastNow,
  isDue,
  cadenceLabel,
  FREQUENCY_LABELS,
} from "@/lib/recurring-task";

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// canManageRecurring
// ---------------------------------------------------------------------------
describe("canManageRecurring", () => {
  it("allows CEO / MANAGEMENT / PO", () => {
    for (const role of ["CEO", "MANAGEMENT", "PO"] as const) {
      expect(canManageRecurring(role)).toBe(true);
    }
  });
  it("denies CONTRIBUTOR / VIEWER", () => {
    for (const role of ["CONTRIBUTOR", "VIEWER"] as const) {
      expect(canManageRecurring(role)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// clampMonthDay
// ---------------------------------------------------------------------------
describe("clampMonthDay", () => {
  it("keeps 1..28 as-is", () => {
    expect(clampMonthDay(1)).toBe(1);
    expect(clampMonthDay(15)).toBe(15);
    expect(clampMonthDay(28)).toBe(28);
  });
  it("clamps out-of-range values so the day exists every month", () => {
    expect(clampMonthDay(0)).toBe(1);
    expect(clampMonthDay(31)).toBe(28);
    expect(clampMonthDay(-5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeNextRun
// ---------------------------------------------------------------------------
describe("computeNextRun", () => {
  it("DAILY → the following day, at 00:00 UTC regardless of input time", () => {
    const from = new Date("2026-07-28T15:42:00Z");
    const next = computeNextRun(from, "DAILY", null, null);
    expect(next.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("WEEKLY → the next matching weekday (Tue 28th, target Mon → Mon Aug 3)", () => {
    // 2026-07-28 is a Tuesday (getUTCDay 2); target Monday (1).
    const next = computeNextRun(utc("2026-07-28"), "WEEKLY", 1, null);
    expect(next.getUTCDay()).toBe(1);
    expect(iso(next)).toBe("2026-08-03");
  });

  it("WEEKLY → same weekday jumps a full week (strictly after)", () => {
    // 2026-07-27 is a Monday; target Monday → next Monday.
    const next = computeNextRun(utc("2026-07-27"), "WEEKLY", 1, null);
    expect(iso(next)).toBe("2026-08-03");
  });

  it("WEEKLY → defaults to Monday when weekday is null", () => {
    const next = computeNextRun(utc("2026-07-28"), "WEEKLY", null, null);
    expect(next.getUTCDay()).toBe(1);
  });

  it("MONTHLY → the target day this month when still ahead", () => {
    // 10th, target 20th → 20th of the same month.
    expect(iso(computeNextRun(utc("2026-07-10"), "MONTHLY", null, 20))).toBe(
      "2026-07-20"
    );
  });

  it("MONTHLY → next month once the target day has passed", () => {
    // 25th, target 20th → 20th of next month.
    expect(iso(computeNextRun(utc("2026-07-25"), "MONTHLY", null, 20))).toBe(
      "2026-08-20"
    );
  });

  it("MONTHLY → strictly after when today IS the target day", () => {
    expect(iso(computeNextRun(utc("2026-07-20"), "MONTHLY", null, 20))).toBe(
      "2026-08-20"
    );
  });

  it("MONTHLY → clamps day 31 to 28", () => {
    expect(iso(computeNextRun(utc("2026-07-10"), "MONTHLY", null, 31))).toBe(
      "2026-07-28"
    );
  });
});

// ---------------------------------------------------------------------------
// advancePastNow
// ---------------------------------------------------------------------------
describe("advancePastNow", () => {
  it("skips missed DAILY occurrences to a single catch-up just past now", () => {
    // nextRunAt weeks in the past → returns the first day strictly after now.
    const next = advancePastNow(
      utc("2026-07-01"),
      utc("2026-07-28"),
      "DAILY",
      null,
      null
    );
    expect(iso(next)).toBe("2026-07-29");
  });

  it("leaves a future nextRunAt untouched", () => {
    const future = utc("2026-08-15");
    const next = advancePastNow(future, utc("2026-07-28"), "DAILY", null, null);
    expect(next.getTime()).toBe(future.getTime());
  });

  it("advances a due WEEKLY to the next occurrence after now", () => {
    // Due last Monday, now Tuesday 28th → next Monday Aug 3.
    const next = advancePastNow(
      utc("2026-07-20"),
      utc("2026-07-28"),
      "WEEKLY",
      1,
      null
    );
    expect(iso(next)).toBe("2026-08-03");
  });
});

// ---------------------------------------------------------------------------
// isDue
// ---------------------------------------------------------------------------
describe("isDue", () => {
  const now = utc("2026-07-28");
  it("is due when active and nextRunAt <= now", () => {
    expect(isDue({ isActive: true, nextRunAt: utc("2026-07-28") }, now)).toBe(true);
    expect(isDue({ isActive: true, nextRunAt: utc("2026-07-27") }, now)).toBe(true);
  });
  it("is not due in the future", () => {
    expect(isDue({ isActive: true, nextRunAt: utc("2026-07-29") }, now)).toBe(false);
  });
  it("is never due when inactive", () => {
    expect(isDue({ isActive: false, nextRunAt: utc("2026-07-01") }, now)).toBe(false);
  });
  it("is never date-due for a PER_SPRINT template (null nextRunAt)", () => {
    expect(isDue({ isActive: true, nextRunAt: null }, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cadenceLabel
// ---------------------------------------------------------------------------
describe("cadenceLabel", () => {
  it("labels DAILY", () => {
    expect(cadenceLabel({ frequency: "DAILY", weekday: null, monthDay: null })).toBe(
      "Tous les jours"
    );
  });
  it("labels WEEKLY with the weekday name", () => {
    expect(cadenceLabel({ frequency: "WEEKLY", weekday: 1, monthDay: null })).toBe(
      "Chaque lundi"
    );
    expect(cadenceLabel({ frequency: "WEEKLY", weekday: 5, monthDay: null })).toBe(
      "Chaque vendredi"
    );
  });
  it("labels MONTHLY with an ordinal first day", () => {
    expect(cadenceLabel({ frequency: "MONTHLY", weekday: null, monthDay: 1 })).toBe(
      "Le 1er de chaque mois"
    );
    expect(cadenceLabel({ frequency: "MONTHLY", weekday: null, monthDay: 15 })).toBe(
      "Le 15 de chaque mois"
    );
  });
  it("labels PER_SPRINT", () => {
    expect(
      cadenceLabel({ frequency: "PER_SPRINT", weekday: null, monthDay: null })
    ).toBe("À chaque sprint");
  });
});

// ---------------------------------------------------------------------------
// PER_SPRINT specifics
// ---------------------------------------------------------------------------
describe("PER_SPRINT", () => {
  it("computeNextRun throws — it is event-driven, not date-scheduled", () => {
    expect(() => computeNextRun(utc("2026-07-28"), "PER_SPRINT", null, null)).toThrow();
  });
  it("has a French frequency label", () => {
    expect(FREQUENCY_LABELS.PER_SPRINT).toBe("Par sprint");
  });
});
