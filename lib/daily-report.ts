/**
 * Daily-report (standup) reminder helpers — pure functions so the targeting
 * logic stays DB-free and unit-testable. The cron route feeds these the active
 * sprints' rosters and today's submissions, then emails whoever still owes a
 * report.
 */

export interface SprintRoster {
  sprintId: string;
  sprintName: string;
  /** Users expected to report today: task assignees + capacity members. */
  memberIds: string[];
  /** Users who have already submitted today's standup for this sprint. */
  submittedIds: string[];
}

export interface ReminderTarget {
  userId: string;
  /** Active sprints where this user still owes a standup today. */
  sprints: { sprintId: string; sprintName: string }[];
}

/**
 * Fold every active sprint's roster + today's submissions into one target per
 * user who still owes a standup, carrying the sprints they're missing. Users
 * outside `eligibleIds` (VIEWERs, inactive, opted-out) are dropped; a user who
 * already reported everywhere produces no target.
 */
export function pendingStandupTargets(
  rosters: SprintRoster[],
  eligibleIds: Set<string>
): ReminderTarget[] {
  const byUser = new Map<string, { sprintId: string; sprintName: string }[]>();

  for (const roster of rosters) {
    const submitted = new Set(roster.submittedIds);
    for (const userId of roster.memberIds) {
      if (!eligibleIds.has(userId)) continue;
      if (submitted.has(userId)) continue;
      const list = byUser.get(userId) ?? [];
      if (!list.some((s) => s.sprintId === roster.sprintId)) {
        list.push({ sprintId: roster.sprintId, sprintName: roster.sprintName });
      }
      byUser.set(userId, list);
    }
  }

  return [...byUser.entries()].map(([userId, sprints]) => ({ userId, sprints }));
}
