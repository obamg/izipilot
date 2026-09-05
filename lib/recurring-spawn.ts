/**
 * Spawning PER_SPRINT recurring templates into a sprint.
 *
 * Unlike DATE-based templates (DAILY/WEEKLY/MONTHLY), which the daily cron
 * clones on schedule, a PER_SPRINT template is event-driven: one task is spawned
 * when a sprint becomes ACTIVE (and, for convenience, straight into the current
 * active sprint when the template is created mid-sprint). Idempotency is by the
 * (recurringTaskId, sprintId) pair, so a sprint holds at most one instance of a
 * given template — whether freshly spawned here or carried in from last sprint.
 */

import { prisma } from "@/lib/prisma";
import { resolveInitialColumn } from "@/lib/board-column-server";
import { UNFINISHED_STATUSES } from "@/lib/sprint";

/** The template fields copied onto each generated SprintTask. */
export interface SpawnableTemplate {
  id: string;
  orgId: string;
  krId: string | null;
  departmentId: string | null;
  productId: string | null;
  title: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  storyPoints: number | null;
  assigneeId: string | null;
  createdById: string;
}

/**
 * Create a SprintTask from `template` in `sprintId`, unless the sprint already
 * has a task from that template. Returns true when a task was created. Safe to
 * call more than once for the same (template, sprint) — the existence check
 * makes it a no-op after the first spawn, and respects a task the user deleted
 * within the same sprint (nothing re-fires until the next sprint activates).
 */
export async function spawnPerSprintTask(
  template: SpawnableTemplate,
  sprintId: string
): Promise<boolean> {
  // Colonne de départ dans le flux de l'équipe du modèle. Résolue hors
  // transaction : c'est une lecture, et la garder dedans allongerait le verrou
  // sans rien garantir de plus.
  const columnId = await resolveInitialColumn(template.orgId, {
    departmentId: template.departmentId,
    productId: template.productId,
  });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sprintTask.findFirst({
      where: {
        orgId: template.orgId,
        sprintId,
        recurringTaskId: template.id,
      },
      select: { id: true },
    });
    if (existing) return false;

    const sortOrder = await tx.sprintTask.count({
      where: { orgId: template.orgId, sprintId },
    });
    await tx.sprintTask.create({
      data: {
        orgId: template.orgId,
        sprintId,
        recurringTaskId: template.id,
        krId: template.krId,
        departmentId: template.departmentId,
        productId: template.productId,
        columnId,
        title: template.title,
        description: template.description,
        priority: template.priority,
        storyPoints: template.storyPoints,
        assigneeId: template.assigneeId,
        createdById: template.createdById,
        sortOrder,
      },
    });
    await tx.recurringTask.update({
      where: { id: template.id },
      data: { lastRunAt: new Date() },
    });
    return true;
  });
}

/** Field set to select when loading templates to hand to spawnPerSprintTask. */
export const spawnableTemplateSelect = {
  id: true,
  orgId: true,
  krId: true,
  departmentId: true,
  productId: true,
  title: true,
  description: true,
  priority: true,
  storyPoints: true,
  assigneeId: true,
  createdById: true,
} as const;

/**
 * Rapatrie dans un sprint les occurrences récurrentes restées au backlog.
 *
 * Le cron quotidien dépose ses occurrences dans le sprint ACTIVE de l'org, et
 * à défaut au backlog. Tant qu'un sprint suit toujours le précédent ce cas ne
 * se présente pas, mais si personne n'a planifié la suite l'org se retrouve
 * sans sprint actif et le « Rapport quotidien » du jour tombe au backlog — d'où
 * il ne repartait jamais. On l'y reprend au démarrage du sprint suivant.
 *
 * Strictement borné aux tâches issues d'un modèle (`recurringTaskId` non nul) et
 * non terminées : un backlog contient aussi du travail délibérément mis de côté,
 * qui n'a rien à faire dans le sprint sans que personne l'ait demandé.
 */
export async function adoptBacklogRecurringTasks(
  orgId: string,
  sprintId: string
): Promise<number> {
  const { count } = await prisma.sprintTask.updateMany({
    where: {
      orgId,
      sprintId: null,
      recurringTaskId: { not: null },
      status: { in: UNFINISHED_STATUSES },
    },
    data: { sprintId },
  });
  return count;
}

/**
 * Tout ce que « démarrer un sprint » implique, au-delà du changement de statut.
 *
 * Un seul endroit, parce que l'activation a désormais deux déclencheurs : le
 * bouton « Démarrer », et l'enchaînement automatique à la clôture du sprint
 * précédent. Un sprint démarré par l'un devait se comporter comme un sprint
 * démarré par l'autre.
 */
export async function onSprintActivated(
  orgId: string,
  sprintId: string
): Promise<{ spawned: number; adopted: number }> {
  const templates = await prisma.recurringTask.findMany({
    where: { orgId, isActive: true, frequency: "PER_SPRINT" },
    select: spawnableTemplateSelect,
  });

  let spawned = 0;
  for (const t of templates) {
    try {
      if (await spawnPerSprintTask(t, sprintId)) spawned++;
    } catch {
      // Best-effort — un modèle bancal ne doit pas faire échouer l'activation.
    }
  }

  let adopted = 0;
  try {
    adopted = await adoptBacklogRecurringTasks(orgId, sprintId);
  } catch {
    // Idem : le sprint démarre même si le rapatriement échoue.
  }

  return { spawned, adopted };
}
