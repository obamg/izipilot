/**
 * Ce qu'une clôture de sprint va faire — calculé avant de la faire.
 *
 * Ce module est la SEULE source du plan de clôture : l'aperçu affiché dans la
 * fenêtre de confirmation et l'exécution dans le PATCH l'appellent tous les
 * deux. Dupliquer la logique ferait dériver l'annonce de la réalité, et une
 * confirmation qui annonce autre chose que ce qui se produit est pire que pas
 * de confirmation du tout.
 *
 * Séparé de `lib/sprint.ts` parce qu'il touche Prisma : les helpers purs
 * (`pickCarryTarget`, `pickChainTarget`, `describeClosePlan`) restent là-bas,
 * importables depuis un composant client.
 */

import { prisma } from "@/lib/prisma";
import {
  pickCarryTarget,
  pickChainTarget,
  UNFINISHED_STATUSES,
  type ClosePlan,
} from "@/lib/sprint";

export async function planSprintClose(
  orgId: string,
  sprint: { id: string; number: number }
): Promise<ClosePlan> {
  const [unfinishedCount, candidates] = await Promise.all([
    prisma.sprintTask.count({
      where: {
        orgId,
        sprintId: sprint.id,
        status: { in: UNFINISHED_STATUSES },
      },
    }),
    prisma.sprint.findMany({
      where: {
        orgId,
        id: { not: sprint.id },
        status: { in: ["PLANNED", "ACTIVE"] },
        number: { gt: sprint.number },
      },
      select: { id: true, number: true, name: true, status: true },
    }),
  ]);

  const carry = pickCarryTarget(candidates, sprint.number);
  const chain = pickChainTarget(carry);

  return {
    unfinishedCount,
    carryTo: carry ? { id: carry.id, name: carry.name } : null,
    chainTo: chain ? { id: chain.id, name: chain.name } : null,
  };
}
