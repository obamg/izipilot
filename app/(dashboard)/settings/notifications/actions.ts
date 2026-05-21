"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  updatePrefs,
} from "@/lib/notification-prefs";

export async function saveNotificationPrefs(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" } as const;
  }

  const patch: Partial<Record<NotificationEvent, boolean>> = {};
  for (const evt of NOTIFICATION_EVENTS) {
    patch[evt.key] = formData.get(evt.key) === "on";
  }

  await updatePrefs(session.user.id, session.user.orgId, patch);
  revalidatePath("/settings/notifications");
  return { ok: true } as const;
}
