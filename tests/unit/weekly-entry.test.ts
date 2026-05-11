import { describe, it, expect } from "vitest";
import { effectiveCurrentValue } from "@/lib/weekly-entry";
import { calculateScore } from "@/lib/score";

const baseKr = {
  target: 100,
  isInverse: false,
  currentValue: 42,
};

describe("effectiveCurrentValue", () => {
  describe("NUMERIC / PERCENTAGE non-inverse", () => {
    it("back-computes from progress so score matches slider", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, krType: "NUMERIC" },
        { progress: 0.73 }
      );
      expect(cv).toBeCloseTo(73, 10);
      expect(calculateScore("NUMERIC", cv, 100)).toBeCloseTo(0.73, 10);
    });

    it("handles target=10 → 73% slider yields cv=7.3", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, target: 10, krType: "NUMERIC" },
        { progress: 0.73 }
      );
      expect(cv).toBeCloseTo(7.3, 10);
    });

    it("PERCENTAGE behaves identically to NUMERIC", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, krType: "PERCENTAGE" },
        { progress: 0.5 }
      );
      expect(cv).toBe(50);
    });

    it("falls back to stored currentValue when target is null", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, target: null, krType: "NUMERIC" },
        { progress: 0.5 }
      );
      expect(cv).toBe(42);
    });
  });

  describe("NUMERIC / PERCENTAGE inverse (lower is better)", () => {
    // score = (start − cv) / (start − target), start defaults to target * 3
    it("100% slider → cv equals target", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, target: 3, isInverse: true, krType: "NUMERIC" },
        { progress: 1 }
      );
      expect(cv).toBeCloseTo(3, 10);
      expect(
        calculateScore("NUMERIC", cv, 3, undefined, true)
      ).toBeCloseTo(1, 10);
    });

    it("0% slider → cv equals start (target * 3)", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, target: 3, isInverse: true, krType: "NUMERIC" },
        { progress: 0 }
      );
      expect(cv).toBeCloseTo(9, 10);
      expect(
        calculateScore("NUMERIC", cv, 3, undefined, true)
      ).toBeCloseTo(0, 10);
    });

    it("round-trip preserves score for 50%", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, target: 3, isInverse: true, krType: "NUMERIC" },
        { progress: 0.5 }
      );
      expect(
        calculateScore("NUMERIC", cv, 3, undefined, true)
      ).toBeCloseTo(0.5, 10);
    });
  });

  describe("BINARY", () => {
    it("progress < 0.5 → 0", () => {
      expect(
        effectiveCurrentValue(
          { ...baseKr, krType: "BINARY" },
          { progress: 0.49 }
        )
      ).toBe(0);
    });

    it("progress ≥ 0.5 → 1", () => {
      expect(
        effectiveCurrentValue(
          { ...baseKr, krType: "BINARY" },
          { progress: 0.5 }
        )
      ).toBe(1);
      expect(
        effectiveCurrentValue(
          { ...baseKr, krType: "BINARY" },
          { progress: 1 }
        )
      ).toBe(1);
    });

    it("with new value, calculateScore returns 0 or 1 (never fractional)", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, krType: "BINARY" },
        { progress: 0.6 }
      );
      expect(calculateScore("BINARY", cv, 1)).toBe(1);
    });
  });

  describe("DATE", () => {
    it("leaves currentValue unchanged (score derives from progress)", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, krType: "DATE" },
        { progress: 0.42 }
      );
      expect(cv).toBe(42);
    });
  });

  describe("explicit currentValue override", () => {
    it("takes precedence over progress-derived value", () => {
      const cv = effectiveCurrentValue(
        { ...baseKr, krType: "NUMERIC" },
        { progress: 0.5, currentValue: 999 }
      );
      expect(cv).toBe(999);
    });
  });
});
