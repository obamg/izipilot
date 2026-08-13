import { prisma } from "@/lib/prisma";

export type NotificationEvent =
  | "weeklyReminder"
  | "weeklyDigest"
  | "krBlockedManual"
  | "escalation48h"
  | "entryMissing"
  | "dailyReportReminder";

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
];

export const DEFAULT_PREFS: Record<NotificationEvent, boolean> = Object.freeze(
  Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.key, e.default])),
) as Record<NotificationEvent, boolean>;

export async function shouldNotify(
  userId: string,
  event: NotificationEvent,
): Promise<boolean> {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: { [event]: true } as Record<NotificationEvent, true>,
  });
  if (!prefs) return DEFAULT_PREFS[event];
  return (prefs as Record<NotificationEvent, boolean>)[event];
}

export async function filterRecipientsByPref<T extends { id: string }>(
  recipients: ReadonlyArray<T>,
  event: NotificationEvent,
): Promise<T[]> {
  if (recipients.length === 0) return [];
  const ids = recipients.map((r) => r.id);
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, [event]: true } as Record<string, true>,
  });
  const optedOut = new Set<string>();
  const optedIn = new Set<string>();
  for (const p of prefs as Array<Record<string, unknown>>) {
    const userId = p.userId as string;
    const enabled = p[event] as boolean;
    (enabled ? optedIn : optedOut).add(userId);
  }
  return recipients.filter((r) => {
    if (optedIn.has(r.id)) return true;
    if (optedOut.has(r.id)) return false;
    return DEFAULT_PREFS[event];
  });
}

export async function getOrCreatePrefs(userId: string, orgId: string) {
  const existing = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  if (existing) return existing;
  return prisma.notificationPreference.create({
    data: { userId, orgId, ...DEFAULT_PREFS },
  });
}

export async function updatePrefs(
  userId: string,
  orgId: string,
  patch: Partial<Record<NotificationEvent, boolean>>,
) {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, orgId, ...DEFAULT_PREFS, ...patch },
    update: patch,
  });
}
