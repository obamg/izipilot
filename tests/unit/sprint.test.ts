import { describe, it, expect } from 'vitest'
import type { ActionStatus } from '@prisma/client'
import {
  taskPoints,
  computeSprintStats,
  computeBurndown,
  computeVelocity,
  averageVelocity,
  computeCapacityUtilization,
  daysRemaining,
  type SprintTaskLike,
} from '@/lib/sprint'

// Small factory for terse test data.
function task(
  status: ActionStatus,
  storyPoints: number | null = null,
  opts: { completedAt?: Date | null; assigneeId?: string | null } = {}
): SprintTaskLike {
  return {
    status,
    storyPoints,
    completedAt: opts.completedAt ?? (status === 'DONE' ? new Date('2026-06-20') : null),
    assigneeId: opts.assigneeId ?? null,
  }
}

// ---------------------------------------------------------------------------
// taskPoints
// ---------------------------------------------------------------------------
describe('taskPoints', () => {
  it('uses storyPoints when set', () => {
    expect(taskPoints({ storyPoints: 5 })).toBe(5)
  })
  it('falls back to 1 for null / 0 / negative', () => {
    expect(taskPoints({ storyPoints: null })).toBe(1)
    expect(taskPoints({ storyPoints: 0 })).toBe(1)
    expect(taskPoints({ storyPoints: -3 })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeSprintStats
// ---------------------------------------------------------------------------
describe('computeSprintStats', () => {
  it('returns zeroes for an empty sprint', () => {
    expect(computeSprintStats([])).toEqual({
      totalTasks: 0,
      doneTasks: 0,
      totalPoints: 0,
      donePoints: 0,
      percentComplete: 0,
    })
  })

  it('counts points and completion percentage', () => {
    const tasks = [
      task('DONE', 3),
      task('IN_PROGRESS', 5),
      task('TODO', 2),
    ]
    const s = computeSprintStats(tasks)
    expect(s.totalTasks).toBe(3)
    expect(s.doneTasks).toBe(1)
    expect(s.totalPoints).toBe(10)
    expect(s.donePoints).toBe(3)
    expect(s.percentComplete).toBe(30)
  })

  it('excludes CANCELLED tasks from every total', () => {
    const tasks = [task('DONE', 4), task('CANCELLED', 100)]
    const s = computeSprintStats(tasks)
    expect(s.totalTasks).toBe(1)
    expect(s.totalPoints).toBe(4)
    expect(s.percentComplete).toBe(100)
  })

  it('treats unestimated tasks as 1 point each', () => {
    const s = computeSprintStats([task('DONE'), task('TODO')])
    expect(s.totalPoints).toBe(2)
    expect(s.donePoints).toBe(1)
    expect(s.percentComplete).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// computeBurndown
// ---------------------------------------------------------------------------
describe('computeBurndown', () => {
  const sprint = {
    startDate: new Date('2026-06-01T00:00:00'),
    endDate: new Date('2026-06-05T00:00:00'),
  }

  it('produces one point per calendar day (inclusive)', () => {
    const pts = computeBurndown(sprint, [task('TODO', 2)], new Date('2026-06-05T12:00:00'))
    expect(pts).toHaveLength(5)
    expect(pts[0].date).toBe('2026-06-01')
    expect(pts[4].date).toBe('2026-06-05')
    expect(pts[0].label).toBe('01/06')
  })

  it('ideal line runs from total points to 0', () => {
    const tasks = [task('TODO', 4), task('TODO', 4)] // 8 total
    const pts = computeBurndown(sprint, tasks, new Date('2026-06-05T12:00:00'))
    expect(pts[0].ideal).toBe(8)
    expect(pts[pts.length - 1].ideal).toBe(0)
  })

  it('remaining decreases as tasks are completed', () => {
    const tasks = [
      task('DONE', 3, { completedAt: new Date('2026-06-02T10:00:00') }),
      task('DONE', 2, { completedAt: new Date('2026-06-04T10:00:00') }),
      task('TODO', 5),
    ]
    const pts = computeBurndown(sprint, tasks, new Date('2026-06-05T23:59:59'))
    expect(pts[0].remaining).toBe(10) // day 1: nothing done
    expect(pts[1].remaining).toBe(7) // day 2: -3
    expect(pts[2].remaining).toBe(7) // day 3: unchanged
    expect(pts[3].remaining).toBe(5) // day 4: -2 more
    expect(pts[4].remaining).toBe(5) // day 5: still 5 outstanding
  })

  it('nulls remaining for days after `now`', () => {
    const pts = computeBurndown(sprint, [task('TODO', 2)], new Date('2026-06-03T12:00:00'))
    expect(pts[2].remaining).not.toBeNull() // 06-03 reached
    expect(pts[3].remaining).toBeNull() // 06-04 in the future
    expect(pts[4].remaining).toBeNull()
    // ideal still defined for every day
    expect(pts[4].ideal).toBe(0)
  })

  it('handles an empty sprint without throwing', () => {
    const pts = computeBurndown(sprint, [], new Date('2026-06-05T12:00:00'))
    expect(pts[0].remaining).toBe(0)
    expect(pts[0].ideal).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeVelocity / averageVelocity
// ---------------------------------------------------------------------------
describe('computeVelocity', () => {
  it('reports committed vs completed points per sprint', () => {
    const v = computeVelocity([
      { name: 'Sprint 1', tasks: [task('DONE', 5), task('TODO', 3)] },
      { name: 'Sprint 2', tasks: [task('DONE', 8), task('CANCELLED', 2)] },
    ])
    expect(v).toEqual([
      { name: 'Sprint 1', committedPoints: 8, completedPoints: 5 },
      { name: 'Sprint 2', committedPoints: 8, completedPoints: 8 },
    ])
  })

  it('averages completed points (rounded to 1 decimal)', () => {
    const v = computeVelocity([
      { name: 'S1', tasks: [task('DONE', 5)] },
      { name: 'S2', tasks: [task('DONE', 8)] },
    ])
    expect(averageVelocity(v)).toBe(6.5)
    expect(averageVelocity([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeCapacityUtilization
// ---------------------------------------------------------------------------
describe('computeCapacityUtilization', () => {
  it('computes assigned points and utilization per member', () => {
    const capacities = [
      { userId: 'u1', capacityPoints: 10 },
      { userId: 'u2', capacityPoints: 5 },
    ]
    const tasks = [
      task('TODO', 4, { assigneeId: 'u1' }),
      task('DONE', 3, { assigneeId: 'u1' }),
      task('IN_PROGRESS', 8, { assigneeId: 'u2' }),
    ]
    const rows = computeCapacityUtilization(capacities, tasks)
    const u1 = rows.find((r) => r.userId === 'u1')!
    const u2 = rows.find((r) => r.userId === 'u2')!
    expect(u1.assignedPoints).toBe(7)
    expect(u1.utilizationPct).toBe(70)
    expect(u2.assignedPoints).toBe(8)
    expect(u2.utilizationPct).toBe(160) // overcommitted
  })

  it('includes assignees without a capacity row (0% util)', () => {
    const rows = computeCapacityUtilization([], [task('TODO', 4, { assigneeId: 'u9' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'u9', assignedPoints: 4, capacityPoints: 0, utilizationPct: 0 })
  })

  it('ignores CANCELLED and unassigned tasks', () => {
    const rows = computeCapacityUtilization(
      [{ userId: 'u1', capacityPoints: 10 }],
      [task('CANCELLED', 5, { assigneeId: 'u1' }), task('TODO', 3, { assigneeId: null })]
    )
    expect(rows[0].assignedPoints).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// daysRemaining
// ---------------------------------------------------------------------------
describe('daysRemaining', () => {
  it('counts whole days to the end date', () => {
    expect(daysRemaining(new Date('2026-06-10'), new Date('2026-06-05'))).toBe(5)
  })
  it('never goes negative', () => {
    expect(daysRemaining(new Date('2026-06-01'), new Date('2026-06-10'))).toBe(0)
  })
})
