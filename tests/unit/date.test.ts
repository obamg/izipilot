import { describe, it, expect } from "vitest";
import {
  getISOWeek,
  getISOWeekStart,
  getLastISOWeekOfYear,
  getPreviousISOWeek,
} from "@/lib/date";

describe("getLastISOWeekOfYear", () => {
  // ISO years with 53 weeks: Jan 1 is Thursday, or leap year + Wednesday.
  // Sources cross-referenced with the standard ISO 8601 reference table.
  it.each([
    [2020, 53], // leap year, Jan 1 Wed
    [2021, 52],
    [2022, 52],
    [2023, 52],
    [2024, 52],
    [2025, 52],
    [2026, 53], // Jan 1 Thu
    [2027, 52],
  ])("year %i has %i ISO weeks", (year, expected) => {
    expect(getLastISOWeekOfYear(year)).toBe(expected);
  });
});

describe("getPreviousISOWeek", () => {
  it("returns previous week within the same year for week > 1", () => {
    expect(getPreviousISOWeek(2026, 5)).toEqual({ year: 2026, weekNumber: 4 });
    expect(getPreviousISOWeek(2026, 53)).toEqual({
      year: 2026,
      weekNumber: 52,
    });
  });

  it("crosses to W52 when previous year has 52 weeks", () => {
    // ISO 2025 has 52 weeks → predecessor of W1/2026 is W52/2025
    expect(getPreviousISOWeek(2026, 1)).toEqual({
      year: 2025,
      weekNumber: 52,
    });
  });

  it("crosses to W53 when previous year has 53 weeks", () => {
    // ISO 2026 has 53 weeks → predecessor of W1/2027 is W53/2026
    expect(getPreviousISOWeek(2027, 1)).toEqual({
      year: 2026,
      weekNumber: 53,
    });
    // ISO 2020 has 53 weeks → predecessor of W1/2021 is W53/2020
    expect(getPreviousISOWeek(2021, 1)).toEqual({
      year: 2020,
      weekNumber: 53,
    });
  });

  it("is consistent with getISOWeek on the Monday-minus-7-days date", () => {
    // For any (year, week), the Monday of the previous ISO week is
    // exactly 7 days before the Monday of (year, week). The getPreviousISOWeek
    // result must match the getISOWeek of that prior Monday.
    const cases: Array<[number, number]> = [
      [2026, 1],
      [2026, 2],
      [2027, 1],
      [2021, 1],
      [2025, 1],
    ];
    for (const [y, w] of cases) {
      const monday = getISOWeekStart(y, w);
      const prevMonday = new Date(monday);
      prevMonday.setDate(monday.getDate() - 7);
      const fromHelper = getPreviousISOWeek(y, w);
      const fromCalendar = getISOWeek(prevMonday);
      expect(fromHelper).toEqual(fromCalendar);
    }
  });
});
