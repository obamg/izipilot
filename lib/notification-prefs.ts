import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PREFS,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "@/lib/notification-events";

export { DEFAULT_PREFS, NOTIFICATION_EVENTS, type NotificationEvent };

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
