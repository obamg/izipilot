import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issueOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";

const logger = log.child("api/mobile/login");

// Step 1 of the native-app login: credentials → email OTP challenge.
// Mirrors the web credentials flow (same OTP infra, same rate limits).

const bodySchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const RATE_LIMIT = 10; // attempts
const RATE_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`mobile-login:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
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
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      isActive: true,
      mustChangePassword: true,
    },
  });

  // Constant-shape failure: never reveal whether the email exists.
  const invalid = () =>
    Response.json({ error: "Email ou mot de passe incorrect" }, { status: 401 });

  if (!user || !user.isActive || !user.passwordHash) return invalid();
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return invalid();

  if (user.mustChangePassword) {
    return Response.json(
      {
        error:
          "Vous devez d'abord changer votre mot de passe sur izipilote.com avant d'utiliser l'application mobile.",
        code: "must_change_password",
      },
      { status: 403 },
    );
  }

  const { challengeToken, expiresInSeconds } = await issueOtp(user.id, user.email, user.name);
  logger.info("otp issued", { userId: user.id });

  return Response.json({ challengeToken, expiresInSeconds });
}
