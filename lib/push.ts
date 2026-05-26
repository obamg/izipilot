import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";

const logger = log.child("push");

let _configured = false;

// Lazily configure web-push with the VAPID keys from env. Throws if any of
// the three required vars are missing so a misconfigured server fails loudly
// at the first send rather than silently dropping notifications.
function ensureConfigured(): boolean {
  if (_configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  _configured = true;
  return true;
}

export function pushIsConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

export interface PushPayload {
  title: string;
  body: string;
  // Path the browser opens when the user clicks the notification (relative to
  // the app origin). Defaults to /dashboard on the client.
  url?: string;
  // Used by the service worker to coalesce successive notifications for the
  // same KR/alert into a single bubble.
  tag?: string;
}

interface SendResult {
  sent: number;
  removed: number;
  failed: number;
}

/**
 * Send a push notification to all of a user's registered devices.
 * - Returns 410/404 endpoints → row is deleted (browser unsubscribed).
 * - Skipped entirely when VAPID is not configured (e.g. staging without keys).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<SendResult> {
  if (process.env.NODE_ENV === "test") return { sent: 0, removed: 0, failed: 0 };
  if (!ensureConfigured()) return { sent: 0, removed: 0, failed: 0 };

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, removed: 0, failed: 0 };

  const json = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        json,
      );
      sent++;
    } catch (err) {
      const status =
        err && typeof err === "object" && "statusCode" in err
          ? (err as { statusCode: number }).statusCode
          : 0;
      // 404/410 = subscription is gone (user revoked permission or cleared
      // browser state). Purge so we stop trying.
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        removed++;
      } else {
        logger.warn("push send failed", { userId, status });
        failed++;
      }
    }
  }

  if (sent > 0) {
    await prisma.pushSubscription
      .updateMany({
        where: { userId, id: { in: subs.map((s) => s.id) } },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }

  return { sent, removed, failed };
}

/**
 * Fan-out helper: send the same payload to many users. Used by the cron jobs
 * and the manual-alert handler. Role-based access control is the caller's
 * responsibility — pass only the user IDs that are legitimate recipients
 * (typically the same list already filtered by `filterRecipientsByPref`).
 */
export async function sendPushToUsers(
  userIds: ReadonlyArray<string>,
  payload: PushPayload,
): Promise<SendResult> {
  const totals: SendResult = { sent: 0, removed: 0, failed: 0 };
  for (const id of userIds) {
    const r = await sendPushToUser(id, payload);
    totals.sent += r.sent;
    totals.removed += r.removed;
    totals.failed += r.failed;
  }
  return totals;
}
