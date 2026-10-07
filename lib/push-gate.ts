/**
 * Obligation d'activer les notifications — décision pure, sans Prisma, pour que
 * la règle qui peut enfermer quelqu'un dehors soit testable ligne à ligne.
 *
 * Rappel de la contrainte de fond : une application ne peut PAS forcer un
 * navigateur à accorder la permission. Une fois « Bloquer » cliqué,
 * `Notification.requestPermission()` rend `denied` sans rien afficher. Le seul
 * levier est de conditionner l'accès — d'où cette porte — et d'expliquer à la
 * personne comment débloquer côté navigateur.
 */

import type { UserRole } from "@prisma/client";

export type PushGateState =
  /** Rien à faire : abonné, ou non concerné. */
  | "OK"
  /** Concerné, pas abonné → accès bloqué tant qu'il n'a pas activé. */
  | "REQUIRED"
  /** Concerné, pas abonné, mais techniquement incapable → laissé passer. */
  | "EXEMPT";

/**
 * Motifs de dérogation. Tous sont AUTO-DÉTECTÉS par le navigateur, jamais
 * déclarés par la personne : ce sont des impossibilités techniques, pas des
 * préférences. Un refus de permission n'en fait volontairement pas partie — il
 * se rattrape dans les réglages du navigateur, et l'ouvrir ici viderait
 * l'obligation de sa substance.
 */
export const EXEMPT_REASONS = {
  NO_SUPPORT: "Navigateur sans Web Push",
  IOS_NOT_INSTALLED: "iPhone/iPad — application non ajoutée à l'écran d'accueil",
  PUSH_SERVICE_ERROR: "Service push du navigateur injoignable (ex. Brave)",
} as const;

export type ExemptReason = keyof typeof EXEMPT_REASONS;

export function isExemptReason(v: unknown): v is ExemptReason {
  // `Object.hasOwn` et non `in` : `in` remonte la chaîne de prototypes, donc
  // « toString » ou « constructor » y passeraient pour des motifs valides et
  // ouvriraient la porte de sortie à n'importe quelle chaîne bien choisie.
  return typeof v === "string" && Object.hasOwn(EXEMPT_REASONS, v);
}

export interface PushGateInput {
  role: UserRole;
  /** La personne doit-elle un rapport quotidien (assignée ou en capacité) ? */
  owesDailyReport: boolean;
  /** Un abonnement push existe pour ce compte, quel que soit l'appareil. */
  hasSubscription: boolean;
  /** Une dérogation a été enregistrée pour ce compte. */
  isExempt: boolean;
}

/**
 * Qui est bloqué, et qui passe.
 *
 * L'ordre des règles compte : on écarte d'abord les non-concernés, pour qu'un
 * VIEWER ou quelqu'un hors du sprint actif ne puisse jamais se retrouver devant
 * la porte à cause d'une donnée manquante ailleurs.
 */
export function pushGateDecision(input: PushGateInput): PushGateState {
  // Lecture seule : rien ne lui est notifié, rien ne lui est demandé.
  if (input.role === "VIEWER") return "OK";

  // Hors du périmètre du rapport quotidien — même règle que le cron de rappel.
  if (!input.owesDailyReport) return "OK";

  // Déjà abonné, sur n'importe lequel de ses appareils.
  if (input.hasSubscription) return "OK";

  // Incapacité technique constatée : on laisse passer, mais c'est tracé et
  // visible du management sur /push-adoption.
  if (input.isExempt) return "EXEMPT";

  return "REQUIRED";
}
