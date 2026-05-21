import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  DEFAULT_PREFS,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  getOrCreatePrefs,
} from "@/lib/notification-prefs";
import { NotificationPrefsForm } from "./NotificationPrefsForm";

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

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h1 className="font-serif text-[20px] text-dark">
          Préférences de notification
        </h1>
        <p className="text-[11px] text-izi-gray mt-0.5">
          Choisissez les événements pour lesquels vous souhaitez recevoir un email.
        </p>
      </div>

      <NotificationPrefsForm initial={initial} />
    </div>
  );
}
