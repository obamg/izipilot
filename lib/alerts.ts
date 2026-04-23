import { prisma } from "./prisma";
import { scoreToPercent } from "./score";
import { escalateActionsOnBlock } from "./actions";
import type { AlertType, AlertSeverity } from "@prisma/client";

interface AlertInput {
  orgId: string;
  krId: string;
  triggeredBy: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
}

/**
 * Create an alert if one doesn't already exist (unresolved) for this KR+type.
 */
export async function createAlertIfNew(input: AlertInput) {
  const existing = await prisma.alert.findFirst({
    where: {
      orgId: input.orgId,
      krId: input.krId,
      type: input.type,
      isResolved: false,
    },
  });

  if (existing) return existing;

  return prisma.alert.create({ data: input });
}

/**
 * Check a KR after a weekly entry and create alerts as needed.
 */
export async function checkKrAlerts(
  krId: string,
  orgId: string,
  triggeredBy: string
) {
  const kr = await prisma.keyResult.findUnique({
    where: { id: krId },
    include: {
      weeklyEntries: {
        orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
        take: 3,
      },
      objective: {
        include: { product: true, department: true },
      },
    },
  });

  if (!kr) return;

  const scorePercent = scoreToPercent(kr.score);
  const entityName =
    kr.objective.product?.name ?? kr.objective.department?.name ?? "Unknown";

  // KR_BLOCKED: score < 40% OR manually set to BLOCKED by PO
  if (kr.status === "BLOCKED") {
    await createAlertIfNew({
      orgId,
      krId,
      triggeredBy,
      type: "KR_BLOCKED",
      severity: scorePercent < 40 ? "CRITICAL" : "HIGH",
      message: scorePercent < 40
        ? `KR "${kr.title}" (${entityName}) est bloqué à ${scorePercent}%`
        : `KR "${kr.title}" (${entityName}) a été marqué bloqué (score: ${scorePercent}%)`,
    });

    // Auto-escalate action priorities when KR is blocked
    await escalateActionsOnBlock(krId, orgId);
  }

  // KR_DECLINING: score decreased for 2 consecutive weeks
  if (kr.weeklyEntries.length >= 2) {
    const [latest, previous] = kr.weeklyEntries;
    if (Number(latest.scoreAtEntry) < Number(previous.scoreAtEntry)) {
      // Check if there's a third entry to confirm 2 weeks declining
      if (
        kr.weeklyEntries.length >= 3 &&
        Number(previous.scoreAtEntry) < Number(kr.weeklyEntries[2].scoreAtEntry)
      ) {
        await createAlertIfNew({
          orgId,
          krId,
          triggeredBy,
          type: "KR_DECLINING",
          severity: "MEDIUM",
          message: `KR "${kr.title}" (${entityName}) est en baisse depuis 2 semaines`,
        });
      }
    }
  }

  // SCORE_BELOW_40: score < 40% for 3 consecutive weeks
  if (kr.weeklyEntries.length >= 3) {
    const allBelow40 = kr.weeklyEntries
      .slice(0, 3)
      .every((e) => scoreToPercent(e.scoreAtEntry) < 40);

    if (allBelow40) {
      await createAlertIfNew({
        orgId,
        krId,
        triggeredBy,
        type: "SCORE_BELOW_40",
        severity: "CRITICAL",
        message: `KR "${kr.title}" (${entityName}) est sous 40% depuis 3 semaines — recalibrage recommandé`,
      });
    }
  }
}

/**
 * Check for missing weekly entries.
 * Called by the daily cron job.
 */
export async function checkMissingEntries(
  orgId: string,
  weekNumber: number,
  year: number
) {
  // Find all active KRs for the org
  const krs = await prisma.keyResult.findMany({
    where: { orgId, isActive: true, deletedAt: null },
    select: { id: true, ownerId: true, title: true },
  });

  // Find submitted entries for this week
  const submitted = await prisma.weeklyEntry.findMany({
    where: { orgId, weekNumber, year },
    select: { krId: true },
  });

  const submittedKrIds = new Set(submitted.map((e) => e.krId));
  const missing = krs.filter((kr) => !submittedKrIds.has(kr.id));

  for (const kr of missing) {
    await createAlertIfNew({
      orgId,
      krId: kr.id,
      triggeredBy: kr.ownerId,
      type: "ENTRY_MISSING",
      severity: "MEDIUM",
      message: `Saisie manquante pour KR "${kr.title}" — semaine ${weekNumber}`,
    });
  }

  return missing.length;
}

/**
 * Check for unresolved BLOCKED alerts older than 48h → escalation.
 */
export async function checkEscalation48h(orgId: string) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const unresolvedBlocked = await prisma.alert.findMany({
    where: {
      orgId,
      type: "KR_BLOCKED",
      isResolved: false,
      createdAt: { lt: cutoff },
    },
    include: { keyResult: true },
  });

  for (const alert of unresolvedBlocked) {
    await createAlertIfNew({
      orgId,
      krId: alert.krId,
      triggeredBy: alert.triggeredBy,
      type: "ESCALATION_48H",
      severity: "CRITICAL",
      message: `ESCALADE: KR "${alert.keyResult.title}" bloqué depuis plus de 48h sans résolution`,
    });
  }

  return unresolvedBlocked.length;
}
