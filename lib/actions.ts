import { prisma } from "./prisma";
import { getISOWeek } from "./date";

/**
 * When a KR goes BLOCKED, auto-escalate all its TODO/IN_PROGRESS actions to URGENT priority.
 */
export async function escalateActionsOnBlock(krId: string, orgId: string) {
  return prisma.action.updateMany({
    where: {
      krId,
      orgId,
      status: { in: ["TODO", "IN_PROGRESS"] },
      priority: { not: "URGENT" },
    },
    data: { priority: "URGENT" },
  });
}

/**
 * Check if a BLOCKED KR has at least one action (any status except CANCELLED).
 * Returns true if at least one action exists.
 */
export async function validateBlockedKrHasAction(
  krId: string,
  orgId: string
): Promise<boolean> {
  const count = await prisma.action.count({
    where: {
      krId,
      orgId,
      status: { not: "CANCELLED" },
    },
  });
  return count > 0;
}

/**
 * Get the current ISO week number.
 */
export function getCurrentWeek(): number {
  return getISOWeek(new Date()).weekNumber;
}
