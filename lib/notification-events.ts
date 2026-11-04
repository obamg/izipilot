// Client-safe notification constants (no Prisma): imported by client
// components; lib/notification-prefs.ts re-exports them for server code.

export type NotificationEvent =
  | "weeklyReminder"
  | "weeklyDigest"
  | "krBlockedManual"
  | "escalation48h"
  | "entryMissing"
  | "dailyReportReminder"
  | "supportRequest";

export const NOTIFICATION_EVENTS: ReadonlyArray<{
  key: NotificationEvent;
  label: string;
  description: string;
  default: boolean;
}> = [
  {
    key: "weeklyReminder",
    label: "Rappel hebdomadaire",
    description:
      "Rappel envoyé chaque dimanche à 20h aux POs pour soumettre leur revue avant 23h59.",
    default: true,
  },
  {
    key: "weeklyDigest",
    label: "Digest hebdomadaire",
    description:
      "Synthèse OKR envoyée chaque lundi à 10h au Management et au CEO.",
    default: true,
  },
  {
    key: "krBlockedManual",
    label: "Alerte KR (manuelle)",
    description:
      "Notification quand un utilisateur signale manuellement un KR bloqué ou critique.",
    default: true,
  },
  {
    key: "escalation48h",
    label: "Escalade 48h",
    description:
      "KR rouge non résolu après 48h. Désactivé par défaut (visible dans le dashboard).",
    default: false,
  },
  {
    key: "entryMissing",
    label: "Revue manquante",
    description:
      "Un PO n'a pas soumis sa revue avant la deadline. Désactivé par défaut.",
    default: false,
  },
  {
    key: "dailyReportReminder",
    label: "Rappel rapport quotidien",
    description:
      "Rappel chaque jour ouvré (lun–ven, 9h) tant que votre rapport quotidien (standup) du sprint actif n'est pas rempli.",
    default: true,
  },
  {
    key: "supportRequest",
    label: "Demandes internes",
    description:
      "Nouvelle demande adressée à votre guichet, réponse ou changement de statut sur vos demandes, et relance des demandes en retard.",
    default: true,
  },
];

export const DEFAULT_PREFS: Record<NotificationEvent, boolean> = Object.freeze(
  Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.key, e.default])),
) as Record<NotificationEvent, boolean>;
