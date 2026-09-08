/**
 * Côté base de la porte : qui doit un rapport quotidien, qui est abonné, qui a
 * une dérogation. La décision elle-même vit dans `lib/push-gate.ts` (pure).
 *
 * Le périmètre « doit un rapport quotidien » est volontairement le MÊME que
 * celui du cron de rappel (`app/api/cron/daily-report-reminder`) et du tableau
 * d'adoption : assignés + membres de capacité d'un sprint ACTIVE. Bloquer
 * quelqu'un à qui on ne demande jamais rien n'aurait aucun sens.
 */

import { prisma } from "@/lib/prisma";
import { pushGateDecision, type PushGateState } from "@/lib/push-gate";
import type { UserRole } from "@prisma/client";

export async function evaluatePushGate(
  orgId: string,
  userId: string,
  role: UserRole
): Promise<PushGateState> {
  // Un VIEWER n'est jamais concerné : on tranche avant toute requête.
  if (role === "VIEWER") return "OK";

  const [assigned, capacity, subCount, user] = await Promise.all([
    prisma.sprintTask.count({
      where: { orgId, assigneeId: userId, sprint: { status: "ACTIVE" } },
    }),
    prisma.sprintCapacity.count({
      where: { orgId, userId, sprint: { status: "ACTIVE" } },
    }),
    prisma.pushSubscription.count({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { pushExemptAt: true },
    }),
  ]);

  return pushGateDecision({
    role,
    owesDailyReport: assigned > 0 || capacity > 0,
    hasSubscription: subCount > 0,
    isExempt: user?.pushExemptAt != null,
  });
}
