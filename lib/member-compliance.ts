/**
 * Règles de suivi des membres — logique pure, testable, sans Prisma.
 *
 * Deux règles :
 *   1. avoir au moins une tâche EN COURS sur le sprint actif ;
 *   2. avoir rempli son rapport quotidien du jour.
 *
 * Le principe qui gouverne tout le fichier : on ne bloque quelqu'un que sur ce
 * qu'il peut corriger lui-même, tout de suite. Bloquer sur le reste
 * transformerait un manquement d'organisation en punition individuelle sans
 * issue — et l'écran de blocage n'aurait rien à proposer.
 */

const WAT_OFFSET_MS = 60 * 60 * 1000; // UTC+1, sans heure d'été

/** Heure (WAT) à partir de laquelle le standup du jour est exigible. */
export const STANDUP_CUTOFF_HOUR = 11;

export type ComplianceIssue =
  /** Aucune tâche assignée : ce n'est pas à la personne de s'en donner une. */
  | "NO_TASK_ASSIGNED"
  /** Tout est terminé : plus rien à démarrer, il faut lui donner du travail. */
  | "NO_TASK_TO_START"
  /** De quoi démarrer, mais rien de démarré. */
  | "NO_ONGOING_TASK"
  /** Rapport quotidien du jour non rempli, alors qu'il est exigible. */
  | "NO_STANDUP";

export interface MemberComplianceInput {
  /** Tâches non annulées assignées sur le sprint actif. */
  assignedCount: number;
  /** Parmi elles, celles en cours. */
  inProgressCount: number;
  /** Parmi elles, celles qu'on peut démarrer maintenant (à faire ou bloquées). */
  startableCount: number;
  hasStandupToday: boolean;
  /** Le standup est-il exigible à cet instant (jour ouvré, après l'heure) ? */
  standupDue: boolean;
}

export interface MemberCompliance {
  issues: ComplianceIssue[];
  /** Au moins un manquement que la personne peut lever elle-même. */
  blocking: boolean;
}

/**
 * Le standup est-il exigible maintenant ?
 *
 * Deux garde-fous contre l'absurde : rien le week-end, et rien avant l'heure
 * limite — sinon on bloquerait quelqu'un dès l'aube pour une chose qu'il a
 * encore toute la matinée pour faire.
 */
export function isStandupDue(
  now: Date,
  cutoffHour: number = STANDUP_CUTOFF_HOUR
): boolean {
  const wat = new Date(now.getTime() + WAT_OFFSET_MS);
  const day = wat.getUTCDay(); // 0 = dimanche, 6 = samedi
  if (day === 0 || day === 6) return false;
  return wat.getUTCHours() >= cutoffHour;
}

export function evaluateMember(input: MemberComplianceInput): MemberCompliance {
  const issues: ComplianceIssue[] = [];
  let blocking = false;

  if (input.assignedCount === 0) {
    // Signalé au management, jamais bloquant : la personne n'a aucun moyen de
    // s'assigner du travail depuis l'écran de blocage. La lui reprocher
    // reviendrait à l'enfermer dehors pour une décision qui n'est pas la sienne.
    issues.push("NO_TASK_ASSIGNED");
  } else if (input.inProgressCount === 0) {
    if (input.startableCount > 0) {
      issues.push("NO_ONGOING_TASK");
      blocking = true;
    } else {
      // Tout est terminé. Le manquement est réel — cette personne n'a plus rien
      // en cours — mais il n'y a rien à démarrer : la bloquer l'enfermerait
      // dehors pour avoir fini son travail. C'est au management d'agir.
      issues.push("NO_TASK_TO_START");
    }
  }

  if (input.standupDue && !input.hasStandupToday) {
    issues.push("NO_STANDUP");
    blocking = true;
  }

  return { issues, blocking };
}

/** Libellés affichables, côté membre comme côté management. */
export const ISSUE_LABELS: Record<ComplianceIssue, string> = {
  NO_TASK_ASSIGNED: "Aucune tâche assignée",
  NO_TASK_TO_START: "Tout terminé — plus rien à démarrer",
  NO_ONGOING_TASK: "Aucune tâche démarrée",
  NO_STANDUP: "Rapport quotidien non rempli",
};
