import { auth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

/**
 * POST /api/account/push-subscription
 * Idempotent: re-posting the same endpoint refreshes its keys + userAgent
 * instead of creating a duplicate row.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { endpoint, keys } = parsed.data;
  const userAgent = request.headers.get("user-agent") ?? null;

  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: session.user.id,
      orgId: session.user.orgId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
    },
    update: {
      userId: session.user.id,
      orgId: session.user.orgId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      lastUsedAt: new Date(),
    },
    select: { id: true },
  });

  return Response.json({ data: { id: sub.id } }, { status: 201 });
}

/**
 * DELETE /api/account/push-subscription
 * Removes the subscription whose endpoint is supplied. Scoped to the caller's
 * userId so one user cannot disable another user's device.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Endpoint manquant" }, { status: 400 });
  }

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: session.user.id },
  });

  return Response.json({ data: { success: true } });
}
