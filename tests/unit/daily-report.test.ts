import { describe, it, expect } from 'vitest'
import { pendingStandupTargets, type SprintRoster } from '@/lib/daily-report'
import { watDayStartUtc, watDateOnly } from '@/lib/standup'

// ---------------------------------------------------------------------------
// watDayStartUtc — real UTC instant of the WAT day boundary
// ---------------------------------------------------------------------------
describe('watDayStartUtc', () => {
  it('is exactly one hour before the WAT-day UTC-midnight marker', () => {
    const now = new Date('2026-08-13T09:00:00Z')
    const start = watDayStartUtc(now)
    // WAT 00:00 on 2026-08-13 == 2026-08-12T23:00:00Z
    expect(start.toISOString()).toBe('2026-08-12T23:00:00.000Z')
    expect(watDateOnly(now).getTime() - start.getTime()).toBe(60 * 60 * 1000)
  })

  it('rolls to the next WAT day once past 23:00 UTC', () => {
    // 23:30 UTC is already 00:30 WAT the next day.
    const start = watDayStartUtc(new Date('2026-08-13T23:30:00Z'))
    expect(start.toISOString()).toBe('2026-08-13T23:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// pendingStandupTargets — who still owes a report today
// ---------------------------------------------------------------------------
describe('pendingStandupTargets', () => {
  const eligible = new Set(['u1', 'u2', 'u3'])

  it('returns members who have not submitted', () => {
    const rosters: SprintRoster[] = [
      { sprintId: 's1', sprintName: 'Sprint 1', memberIds: ['u1', 'u2'], submittedIds: ['u2'] },
    ]
    const targets = pendingStandupTargets(rosters, eligible)
    expect(targets).toEqual([{ userId: 'u1', sprints: [{ sprintId: 's1', sprintName: 'Sprint 1' }] }])
  })

  it('drops users who already reported everywhere', () => {
    const rosters: SprintRoster[] = [
      { sprintId: 's1', sprintName: 'Sprint 1', memberIds: ['u1'], submittedIds: ['u1'] },
    ]
    expect(pendingStandupTargets(rosters, eligible)).toEqual([])
  })

  it('excludes users outside the eligible set (VIEWER / opted-out)', () => {
    const rosters: SprintRoster[] = [
      { sprintId: 's1', sprintName: 'Sprint 1', memberIds: ['u1', 'ghost'], submittedIds: [] },
    ]
    const targets = pendingStandupTargets(rosters, eligible)
    expect(targets.map((t) => t.userId)).toEqual(['u1'])
  })

  it('aggregates the sprints a user is missing across multiple active sprints', () => {
    const rosters: SprintRoster[] = [
      { sprintId: 's1', sprintName: 'Sprint 1', memberIds: ['u1'], submittedIds: [] },
      { sprintId: 's2', sprintName: 'Sprint 2', memberIds: ['u1'], submittedIds: [] },
    ]
    const [target] = pendingStandupTargets(rosters, eligible)
    expect(target.userId).toBe('u1')
    expect(target.sprints).toEqual([
      { sprintId: 's1', sprintName: 'Sprint 1' },
      { sprintId: 's2', sprintName: 'Sprint 2' },
    ])
  })

  it('does not duplicate a sprint if a user appears as both assignee and capacity member', () => {
    // The cron dedups memberIds via a Set, but guard against a sprint listed twice too.
    const rosters: SprintRoster[] = [
      { sprintId: 's1', sprintName: 'Sprint 1', memberIds: ['u1', 'u1'], submittedIds: [] },
    ]
    const [target] = pendingStandupTargets(rosters, eligible)
    expect(target.sprints).toEqual([{ sprintId: 's1', sprintName: 'Sprint 1' }])
  })

  it('returns no targets when every roster is empty', () => {
    const rosters: SprintRoster[] = [
      { sprintId: 's1', sprintName: 'Sprint 1', memberIds: [], submittedIds: [] },
    ]
    expect(pendingStandupTargets(rosters, eligible)).toEqual([])
  })
})
