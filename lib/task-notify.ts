import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { shouldNotify } from "@/lib/notification-prefs";
import { log } from "@/lib/log";

const logger = log.child("task-notify");

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Prévient la personne à qui l'on vient d'assigner une tâche de sprint.
 * Rien si elle se l'assigne elle-même ou a coupé « Tâche assignée ».
 * Ne lève jamais : une notification ratée ne doit pas faire échouer l'écriture.
 */
export async function notifyTaskAssigned(input: {
  taskId: string;
  title: string;
  sprintId: string | null;
  dueDate: Date | null;
  assigneeId: string | null;
  actorId: string;
}): Promise<void> {
  const { assigneeId, actorId } = input;
  if (!assigneeId || assigneeId === actorId) return;
  try {
    if (!(await shouldNotify(assigneeId, "taskAssigned"))) return;
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const due = input.dueDate ? ` (échéance le ${dayFmt.format(input.dueDate)})` : "";
    const body = `${actor?.name ?? "Quelqu'un"} vous a assigné « ${input.title} »${due}.`;

    const push = await sendPushToUser(assigneeId, {
      title: "Nouvelle tâche",
      body,
      url: input.sprintId ? `/sprints/${input.sprintId}` : "/sprints",
      tag: `task-assigned:${input.taskId}`,
    });
    await prisma.notification.create({
      data: {
        userId: assigneeId,
        channel: "IN_APP",
        type: "TASK_ASSIGNED",
        subject: "Nouvelle tâche",
        body,
        isSent: push.sent > 0,
        sentAt: push.sent > 0 ? new Date() : null,
      },
    });
  } catch (err) {
    logger.warn("task assigned notification failed", { taskId: input.taskId, err: String(err) });
  }
}
