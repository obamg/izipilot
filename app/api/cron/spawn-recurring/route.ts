import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron";
import { advancePastNow } from "@/lib/recurring-task";
import { resolveInitialColumn } from "@/lib/board-column-server";

const logger = log.child("cron/spawn-recurring");

/**
 * GET /api/cron/spawn-recurring
 * Triggered daily. For every active recurring-task template whose `nextRunAt`
 * has passed, clone it into a real SprintTask — in the org's ACTIVE sprint if
 * one is running, otherwise the backlog — then advance `nextRunAt` past today
 * (skipping any missed occurrences so a downtime spawns one catch-up, not many).
 *
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const summary = { due: 0, spawned: 0, errors: 0 };

  try {
    const due = await prisma.recurringTask.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
    });
    summary.due = due.length;

    // Resolve each org's active sprint once.
    const activeSprintByOrg = new Map<string, string | null>();
    async function targetSprintId(orgId: string): Promise<string | null> {
      const cached = activeSprintByOrg.get(orgId);
      if (cached !== undefined) return cached;
      const sprint = await prisma.sprint.findFirst({
        where: { orgId, status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        select: { id: true },
      });
      const id = sprint?.id ?? null;
      activeSprintByOrg.set(orgId, id);
      return id;
    }

    for (const t of due) {
      try {
        // PER_SPRINT templates carry a null nextRunAt and are event-driven
        // (spawned on sprint activation), so they never appear here — guard
        // anyway to satisfy the now-nullable type.
        if (!t.nextRunAt) continue;
        const sprintId = await targetSprintId(t.orgId);
        const nextRunAt = advancePastNow(
          t.nextRunAt,
          now,
          t.frequency,
          t.weekday,
          t.monthDay
        );

        // Colonne de départ dans le flux de l'équipe du modèle.
        const columnId = await resolveInitialColumn(t.orgId, {
          departmentId: t.departmentId,
          productId: t.productId,
        });

        await prisma.$transaction(async (tx) => {
          const sortOrder = await tx.sprintTask.count({
            where: { orgId: t.orgId, sprintId },
          });
          await tx.sprintTask.create({
            data: {
              orgId: t.orgId,
              sprintId,
              recurringTaskId: t.id,
              krId: t.krId,
              departmentId: t.departmentId,
              productId: t.productId,
              columnId,
              title: t.title,
              description: t.description,
              priority: t.priority,
              storyPoints: t.storyPoints,
              assigneeId: t.assigneeId,
              createdById: t.createdById,
              sortOrder,
            },
          });
          await tx.recurringTask.update({
            where: { id: t.id },
            data: { nextRunAt, lastRunAt: now },
          });
        });

        summary.spawned++;
      } catch (itemErr) {
        summary.errors++;
        logger.error("spawn failed", { recurringTaskId: t.id }, itemErr);
      }
    }

    logger.info("run complete", summary);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
