import { describe, it, expect } from 'vitest'
import {
  watDateOnly,
  toDateKey,
  parseDateKey,
  mergeStandups,
  type RosterMember,
  type StandupRecord,
} from '@/lib/standup'

// ---------------------------------------------------------------------------
// date helpers
// ---------------------------------------------------------------------------
describe('watDateOnly', () => {
  it('returns the WAT calendar day at UTC midnight', () => {
    // 22:30 UTC on 2026-06-10 is already 23:30 WAT — still the 10th.
    const d = watDateOnly(new Date('2026-06-10T22:30:00Z'))
    expect(toDateKey(d)).toBe('2026-06-10')
  })

  it('rolls to the next day once WAT passes midnight', () => {
    // 23:30 UTC on 2026-06-10 is 00:30 WAT on the 11th.
    const d = watDateOnly(new Date('2026-06-10T23:30:00Z'))
    expect(toDateKey(d)).toBe('2026-06-11')
  })
})

describe('parseDateKey', () => {
  it('parses a valid yyyy-mm-dd', () => {
    expect(toDateKey(parseDateKey('2026-06-26')!)).toBe('2026-06-26')
  })
  it('rejects malformed input', () => {
    expect(parseDateKey('2026/06/26')).toBeNull()
    expect(parseDateKey('nope')).toBeNull()
    expect(parseDateKey('2026-13-40')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mergeStandups
// ---------------------------------------------------------------------------
const roster: RosterMember[] = [
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
  { id: 'u3', name: 'Chloé' },
]

function rec(userId: string, p: Partial<StandupRecord> = {}): StandupRecord {
  return { userId, yesterday: null, today: null, blockers: null, updatedAt: '2026-06-26T08:00:00Z', ...p }
}

describe('mergeStandups', () => {
  it('produces one row per roster member with submitted flags', () => {
    const report = mergeStandups(roster, [rec('u1', { today: 'Coder' })])
    expect(report.totalCount).toBe(3)
    expect(report.submittedCount).toBe(1)
    const alice = report.rows.find((r) => r.userId === 'u1')!
    const bob = report.rows.find((r) => r.userId === 'u2')!
    expect(alice.submitted).toBe(true)
    expect(alice.today).toBe('Coder')
    expect(bob.submitted).toBe(false)
  })

  it('treats an all-empty / whitespace entry as not submitted', () => {
    const report = mergeStandups(roster, [rec('u1', { today: '   ', blockers: '' })])
    expect(report.submittedCount).toBe(0)
    expect(report.rows.find((r) => r.userId === 'u1')!.submitted).toBe(false)
  })

  it('floats members with blockers to the top and flattens the blockers list', () => {
    const report = mergeStandups(roster, [
      rec('u1', { today: 'Coder' }),
      rec('u3', { blockers: 'En attente de la review' }),
    ])
    // Chloé (blocker) should be first
    expect(report.rows[0].userId).toBe('u3')
    expect(report.blockers).toEqual([
      { userId: 'u3', userName: 'Chloé', blockers: 'En attente de la review' },
    ])
  })

  it('orders submitted-without-blocker before not-submitted, then alphabetical', () => {
    const report = mergeStandups(roster, [rec('u2', { today: 'Tests' })])
    // Bob submitted (no blocker) → first; then Alice, Chloé (not submitted, alpha)
    expect(report.rows.map((r) => r.userId)).toEqual(['u2', 'u1', 'u3'])
  })

  it('handles an empty day', () => {
    const report = mergeStandups(roster, [])
    expect(report.submittedCount).toBe(0)
    expect(report.blockers).toEqual([])
    expect(report.rows).toHaveLength(3)
  })
})
