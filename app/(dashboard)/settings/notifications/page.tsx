import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  DEFAULT_PREFS,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  getOrCreatePrefs,
} from "@/lib/notification-prefs";
import { NotificationPrefsForm } from "./NotificationPrefsForm";
import { PushToggle } from "./PushToggle";

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const prefs = await getOrCreatePrefs(session.user.id, session.user.orgId);

  const initial = Object.fromEntries(
    NOTIFICATION_EVENTS.map((e) => [
      e.key,
      (prefs as unknown as Record<NotificationEvent, boolean>)[e.key] ??
        DEFAULT_PREFS[e.key],
    ]),
  ) as Record<NotificationEvent, boolean>;

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="font-serif text-[20px] text-dark">
          Préférences de notification
        </h1>
        <p className="text-[11px] text-izi-gray mt-0.5">
          Choisissez les événements pour lesquels vous souhaitez recevoir
          un email et/ou une notification navigateur.
        </p>
      </div>

      <NotificationPrefsForm initial={initial} />

      {vapidPublicKey && <PushToggle vapidPublicKey={vapidPublicKey} />}
    </div>
  );
}
