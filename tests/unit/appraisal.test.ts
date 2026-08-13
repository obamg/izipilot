import { describe, it, expect } from 'vitest'
import {
  quarterMonths,
  quarterOfMonth,
  competencyAverage,
  managerAssessmentAverage,
  overallScore,
  aggregateMonthlyRollup,
  avgDefined,
  APPRAISAL_MONTHLY_WEIGHT,
  type AppraisalGoal,
} from '@/lib/appraisal'

describe('quarterMonths / quarterOfMonth', () => {
  it('maps quarters to their months', () => {
    expect(quarterMonths('Q1')).toEqual([1, 2, 3])
    expect(quarterMonths('Q3')).toEqual([7, 8, 9])
  })
  it('maps a month back to its quarter', () => {
    expect(quarterOfMonth(1)).toBe('Q1')
    expect(quarterOfMonth(6)).toBe('Q2')
    expect(quarterOfMonth(12)).toBe('Q4')
  })
})

describe('avgDefined', () => {
  it('averages only defined finite numbers', () => {
    expect(avgDefined([4, null, 5, undefined])).toBe(4.5)
    expect(avgDefined([null, undefined])).toBeNull()
  })
})

describe('competencyAverage', () => {
  it('averages the provided competency ratings', () => {
    expect(competencyAverage({ quality: 4, collaboration: 5, initiative: 3 })).toBe(4)
  })
  it('ignores unknown keys and missing ones', () => {
    expect(competencyAverage({ quality: 4, bogus: 1 } as Record<string, number>)).toBe(4)
    expect(competencyAverage(null)).toBeNull()
  })
})

describe('managerAssessmentAverage', () => {
  it('pools competency ratings and goal ratings equally', () => {
    const goals: AppraisalGoal[] = [
      { id: 'g1', title: 'A', managerRating: 5 },
      { id: 'g2', title: 'B', managerRating: 3 },
    ]
    // competencies: 4,4 → plus goals 5,3 → pool [4,4,5,3] = 4
    expect(managerAssessmentAverage({ quality: 4, collaboration: 4 }, goals)).toBe(4)
  })
})

describe('overallScore', () => {
  it('blends manager assessment with the monthly average', () => {
    // manager avg = 4, monthly = 3 → 0.7*4 + 0.3*3 = 3.7
    const got = overallScore({
      managerCompetencies: { quality: 4, collaboration: 4 },
      goals: [],
      monthlyAvg: 3,
    })
    expect(got).toBe(3.7)
    expect(APPRAISAL_MONTHLY_WEIGHT).toBe(0.3)
  })

  it('falls back to manager assessment when no monthly data', () => {
    expect(
      overallScore({ managerCompetencies: { quality: 4, collaboration: 2 }, goals: [], monthlyAvg: null })
    ).toBe(3)
  })

  it('falls back to the monthly average when the manager has not rated', () => {
    expect(overallScore({ managerCompetencies: null, goals: [], monthlyAvg: 4.2 })).toBe(4.2)
  })

  it('returns null when there is nothing to score', () => {
    expect(overallScore({ managerCompetencies: null, goals: [], monthlyAvg: null })).toBeNull()
  })
})

describe('aggregateMonthlyRollup', () => {
  it('averages each metric across the quarter, tolerating null delivery', () => {
    const r = aggregateMonthlyRollup([
      { overall: 4, deliveryScore: 5, quality: 4, collaboration: 4, initiative: 4 },
      { overall: 3, deliveryScore: null, quality: 3, collaboration: 3, initiative: 2 },
    ])
    expect(r.count).toBe(2)
    expect(r.avgOverall).toBe(3.5)
    expect(r.avgDelivery).toBe(5) // only the defined one
    expect(r.avgInitiative).toBe(3)
  })

  it('returns nulls (not NaN) for an empty quarter', () => {
    const r = aggregateMonthlyRollup([])
    expect(r.count).toBe(0)
    expect(r.avgOverall).toBeNull()
  })
})
