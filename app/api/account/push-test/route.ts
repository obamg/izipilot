import { auth } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";

/**
 * POST /api/account/push-test
 * Sends a test notification to every device of the caller (and of nobody
 * else). Dead endpoints answer 404/410 and are purged on the way, so the
 * result also tells how many devices are really reachable.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const result = await sendPushToUser(session.user.id, {
    title: "IziPilot — notification de test",
    body: "Si vous lisez ceci, les notifications arrivent bien sur cet appareil.",
    url: "/settings/notifications",
    tag: "push-test",
  });
  return Response.json({ data: result });
}
