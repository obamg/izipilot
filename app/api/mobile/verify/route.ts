import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { consumeOtp, ConsumeOtpError } from "@/lib/otp";
import {
  mintMobileAccessToken,
  createMobileRefreshToken,
  MOBILE_ACCESS_TTL_SECONDS,
} from "@/lib/mobile-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";

const logger = log.child("api/mobile/verify");

// Step 2 of the native-app login: OTP challenge + 6-digit code → token pair.

const bodySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  deviceName: z.string().max(100).optional(),
});

const OTP_ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "Session de connexion invalide. Recommencez.",
  expired: "Code expiré. Recommencez la connexion.",
  wrong_code: "Code incorrect.",
  too_many_attempts: "Trop de tentatives. Recommencez la connexion.",
};

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`mobile-verify:${clientIp(request)}`, 15, 5 * 60 * 1000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Trop de tentatives. Réessayez plus tard." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Requête invalide" }, { status: 400 });
  }
  const { challengeToken, code, deviceName } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await consumeOtp(challengeToken, code));
  } catch (err) {
    const reason = err instanceof ConsumeOtpError ? err.reason : "invalid_token";
    return Response.json(
      { error: OTP_ERROR_MESSAGES[reason] ?? OTP_ERROR_MESSAGES.invalid_token, code: reason },
      { status: 401 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: { id: true, email: true, name: true, role: true, orgId: true },
  });
  if (!user) {
    return Response.json({ error: "Compte introuvable ou désactivé" }, { status: 401 });
  }

  const accessToken = await mintMobileAccessToken({
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
  });
  const { refreshToken } = await createMobileRefreshToken(user.id, user.orgId, deviceName);

  logger.info("mobile login", { userId: user.id, deviceName });

  return Response.json({
    accessToken,
    refreshToken,
    expiresInSeconds: MOBILE_ACCESS_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
    },
  });
}
