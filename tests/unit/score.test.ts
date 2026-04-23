import { describe, it, expect } from 'vitest'
import { Decimal } from '@prisma/client/runtime/library'
import {
  calculateScore,
  scoreToPercent,
  deriveStatus,
  calculateDelta,
  objectiveScore,
} from '@/lib/score'

// ---------------------------------------------------------------------------
// calculateScore
// ---------------------------------------------------------------------------
describe('calculateScore', () => {
  describe('NUMERIC', () => {
    it('returns 0.7 when currentValue=350, target=500', () => {
      expect(calculateScore('NUMERIC', 350, 500)).toBe(0.7)
    })

    it('returns 0.0 when currentValue=0, target=500', () => {
      expect(calculateScore('NUMERIC', 0, 500)).toBe(0)
    })

    it('caps at 1.0 when currentValue exceeds target (600/500)', () => {
      expect(calculateScore('NUMERIC', 600, 500)).toBe(1.0)
    })

    it('returns 0 when target=0 and currentValue > 0', () => {
      expect(calculateScore('NUMERIC', 100, 0)).toBe(0)
    })

    it('returns 0 when target=null', () => {
      expect(calculateScore('NUMERIC', 100, null)).toBe(0)
    })

    it('returns 1.0 when both currentValue and target are 0', () => {
      expect(calculateScore('NUMERIC', 0, 0)).toBe(1)
    })

    it('returns a mid-range score correctly (250/500 = 0.5)', () => {
      expect(calculateScore('NUMERIC', 250, 500)).toBe(0.5)
    })
  })

  describe('NUMERIC inverse (lower is better)', () => {
    it('returns 1.0 when current is at or below target', () => {
      // cost target=3$, current=2$ → perfect
      expect(calculateScore('NUMERIC', 2, 3, undefined, true, 10)).toBe(1)
    })

    it('returns 0.0 when current equals startValue', () => {
      // cost target=3$, start=10$, current=10$ → no progress
      expect(calculateScore('NUMERIC', 10, 3, undefined, true, 10)).toBe(0)
    })

    it('returns ~0.71 when partial progress (10→5, target 3)', () => {
      // (10-5)/(10-3) = 5/7 ≈ 0.714
      const score = calculateScore('NUMERIC', 5, 3, undefined, true, 10)
      expect(score).toBeCloseTo(0.714, 2)
    })

    it('returns 1.0 when current is exactly the target', () => {
      expect(calculateScore('NUMERIC', 3, 3, undefined, true, 10)).toBe(1)
    })

    it('uses default startValue (3x target) when not provided', () => {
      // target=3, default start=9, current=6 → (9-6)/(9-3) = 0.5
      expect(calculateScore('NUMERIC', 6, 3, undefined, true)).toBe(0.5)
    })

    it('returns 0 when current exceeds startValue', () => {
      expect(calculateScore('NUMERIC', 15, 3, undefined, true, 10)).toBe(0)
    })
  })

  describe('PERCENTAGE', () => {
    it('returns 0.8 when currentValue=80, target=100', () => {
      expect(calculateScore('PERCENTAGE', 80, 100)).toBe(0.8)
    })

    it('returns 0.0 when currentValue=0, target=100', () => {
      expect(calculateScore('PERCENTAGE', 0, 100)).toBe(0)
    })

    it('caps at 1.0 when value exceeds target', () => {
      expect(calculateScore('PERCENTAGE', 110, 100)).toBe(1.0)
    })

    it('returns 0 when target=0 and currentValue > 0', () => {
      expect(calculateScore('PERCENTAGE', 50, 0)).toBe(0)
    })

    it('returns 1.0 when target=0 and currentValue=0', () => {
      expect(calculateScore('PERCENTAGE', 0, 0)).toBe(1)
    })
  })

  describe('PERCENTAGE inverse (lower is better)', () => {
    it('returns 1.0 when below target (fraud 0.05% target 0.1%)', () => {
      expect(calculateScore('PERCENTAGE', 0.05, 0.1, undefined, true, 0.5)).toBe(1)
    })

    it('returns partial score when between start and target', () => {
      // start=10%, target=5%, current=7% → (10-7)/(10-5) = 3/5 = 0.6
      expect(calculateScore('PERCENTAGE', 7, 5, undefined, true, 10)).toBe(0.6)
    })
  })

  describe('BINARY', () => {
    it('returns 1.0 when currentValue=1 (done)', () => {
      expect(calculateScore('BINARY', 1, null)).toBe(1.0)
    })

    it('returns 0.0 when currentValue=0 (not done)', () => {
      expect(calculateScore('BINARY', 0, null)).toBe(0.0)
    })

    it('returns 1.0 for any value ≥ 1 (e.g. 2)', () => {
      expect(calculateScore('BINARY', 2, null)).toBe(1.0)
    })

    it('returns 0.0 for negative values', () => {
      expect(calculateScore('BINARY', -1, null)).toBe(0.0)
    })
  })

  describe('DATE', () => {
    it('returns 0.65 when progress=0.65', () => {
      expect(calculateScore('DATE', 0, null, 0.65)).toBe(0.65)
    })

    it('returns 0 when no progress is provided (undefined)', () => {
      expect(calculateScore('DATE', 0, null, undefined)).toBe(0)
    })

    it('returns 0 when progress=0', () => {
      expect(calculateScore('DATE', 0, null, 0)).toBe(0)
    })

    it('returns 1.0 when progress=1.0', () => {
      expect(calculateScore('DATE', 0, null, 1.0)).toBe(1.0)
    })

    it('caps at 1.0 when progress > 1', () => {
      expect(calculateScore('DATE', 0, null, 1.5)).toBe(1.0)
    })

    it('floors at 0 when progress is negative', () => {
      expect(calculateScore('DATE', 0, null, -0.2)).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// scoreToPercent
// ---------------------------------------------------------------------------
describe('scoreToPercent', () => {
  it('converts 0.72 → 72', () => {
    expect(scoreToPercent(0.72)).toBe(72)
  })

  it('converts 0.0 → 0', () => {
    expect(scoreToPercent(0.0)).toBe(0)
  })

  it('converts 1.0 → 100', () => {
    expect(scoreToPercent(1.0)).toBe(100)
  })

  it('rounds 0.725 → 73', () => {
    expect(scoreToPercent(0.725)).toBe(73)
  })

  it('rounds 0.724 → 72', () => {
    expect(scoreToPercent(0.724)).toBe(72)
  })

  it('accepts a Prisma Decimal and converts correctly', () => {
    const dec = new Decimal('0.72')
    expect(scoreToPercent(dec)).toBe(72)
  })

  it('converts 0.5 → 50', () => {
    expect(scoreToPercent(0.5)).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// deriveStatus
// ---------------------------------------------------------------------------
describe('deriveStatus', () => {
  it('returns ON_TRACK when scorePercent=70 and hasEntries=true', () => {
    expect(deriveStatus(70, true)).toBe('ON_TRACK')
  })

  it('returns ON_TRACK when scorePercent=100 and hasEntries=true', () => {
    expect(deriveStatus(100, true)).toBe('ON_TRACK')
  })

  it('returns AT_RISK when scorePercent=69 and hasEntries=true', () => {
    expect(deriveStatus(69, true)).toBe('AT_RISK')
  })

  it('returns AT_RISK when scorePercent=40 and hasEntries=true', () => {
    expect(deriveStatus(40, true)).toBe('AT_RISK')
  })

  it('returns BLOCKED when scorePercent=39 and hasEntries=true', () => {
    expect(deriveStatus(39, true)).toBe('BLOCKED')
  })

  it('returns BLOCKED when scorePercent=0 and hasEntries=true', () => {
    expect(deriveStatus(0, true)).toBe('BLOCKED')
  })

  it('returns NOT_STARTED when scorePercent=0 and hasEntries=false', () => {
    expect(deriveStatus(0, false)).toBe('NOT_STARTED')
  })

  it('returns BLOCKED (not NOT_STARTED) when score>0 and hasEntries=false', () => {
    // score > 0 means there must be some data; still BLOCKED if < 40
    expect(deriveStatus(30, false)).toBe('BLOCKED')
  })

  it('boundary: 71% → ON_TRACK', () => {
    expect(deriveStatus(71, true)).toBe('ON_TRACK')
  })

  it('boundary: 1% with entries → BLOCKED', () => {
    expect(deriveStatus(1, true)).toBe('BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// calculateDelta
// ---------------------------------------------------------------------------
describe('calculateDelta', () => {
  it('returns 0.2 when current=0.7 and previous=0.5', () => {
    expect(calculateDelta(0.7, 0.5)).toBeCloseTo(0.2, 10)
  })

  it('returns 0 when previousScore=null (first week)', () => {
    expect(calculateDelta(0.7, null)).toBe(0)
  })

  it('returns 0 when current equals previous', () => {
    expect(calculateDelta(0.5, 0.5)).toBe(0)
  })

  it('returns a negative delta when score decreased', () => {
    expect(calculateDelta(0.4, 0.7)).toBeCloseTo(-0.3, 10)
  })

  it('works with 0 previous score', () => {
    expect(calculateDelta(0.5, 0)).toBe(0.5)
  })

  it('works when both scores are 0', () => {
    expect(calculateDelta(0, 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// objectiveScore
// ---------------------------------------------------------------------------
describe('objectiveScore', () => {
  it('returns average 0.7 for [0.7, 0.8, 0.6]', () => {
    expect(objectiveScore([0.7, 0.8, 0.6])).toBeCloseTo(0.7, 10)
  })

  it('returns 0 for an empty array', () => {
    expect(objectiveScore([])).toBe(0)
  })

  it('returns the single value when array has one element', () => {
    expect(objectiveScore([0.85])).toBe(0.85)
  })

  it('accepts Prisma Decimal values and averages correctly', () => {
    const scores = [new Decimal('0.6'), new Decimal('0.8')]
    expect(objectiveScore(scores)).toBeCloseTo(0.7, 10)
  })

  it('handles mixed number and Decimal values', () => {
    const scores = [0.6, new Decimal('0.8')]
    expect(objectiveScore(scores)).toBeCloseTo(0.7, 10)
  })

  it('returns 1.0 average when all KRs are fully achieved', () => {
    expect(objectiveScore([1.0, 1.0, 1.0])).toBe(1.0)
  })

  it('returns 0.0 when all KRs have 0 score', () => {
    expect(objectiveScore([0, 0, 0])).toBe(0)
  })
})
