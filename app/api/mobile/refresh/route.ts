import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  mintMobileAccessToken,
  rotateMobileRefreshToken,
  MOBILE_ACCESS_TTL_SECONDS,
} from "@/lib/mobile-token";
import { checkRateLimit } from "@/lib/rate-limit";

// Rotate a refresh token → fresh access + refresh pair. Any failure is a
// plain 401: the app drops to the login screen.

const bodySchema = z.object({
  refreshToken: z.string().min(1).max(200),
});

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`mobile-refresh:${clientIp(request)}`, 30, 5 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Trop de tentatives" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Requête invalide" }, { status: 400 });
  }

  const rotated = await rotateMobileRefreshToken(parsed.data.refreshToken);
  if (!rotated) {
    return Response.json({ error: "Session expirée" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: rotated.userId, isActive: true },
    select: { id: true, role: true, orgId: true },
  });
  if (!user) {
    return Response.json({ error: "Compte introuvable ou désactivé" }, { status: 401 });
  }

  const accessToken = await mintMobileAccessToken({
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
  });

  return Response.json({
    accessToken,
    refreshToken: rotated.refreshToken,
    expiresInSeconds: MOBILE_ACCESS_TTL_SECONDS,
  });
}
