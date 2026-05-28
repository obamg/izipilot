import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";
import PasswordReset from "@/emails/PasswordReset";

const logger = log.child("auth.forgot-password");

const schema = z.object({
  email: z.string().email().max(254),
});

// Token lifetime + length tuned for one-shot reset links delivered via email.
// 60 minutes is long enough for users who open mail on another device; the
// token is hashed at rest and single-use so a longer window doesn't widen the
// blast radius meaningfully.
const TOKEN_TTL_MINUTES = 60;
const TOKEN_BYTES = 32; // 256 bits of entropy

// Generic success response — we MUST return the same shape whether or not the
// email matched a real account, to prevent account enumeration.
const GENERIC_OK = NextResponse.json({
  data: {
    success: true,
    message:
      "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé.",
  },
});

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function resolveBaseUrl(req: Request): string {
  const fromEnv = process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Behind nginx, x-forwarded-* gives the public origin.
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://izipilote.com";
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  // IP-based rate limit blunts mass enumeration / mail-bombing.
  const ip = getClientIp(request);
  const ipLimit = checkRateLimit(`forgot:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Trop de demandes. Réessayez plus tard." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return GENERIC_OK;
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return GENERIC_OK;
  }

  const email = parsed.data.email.trim().toLowerCase();

  // Per-email rate limit — caps how often any one address can be targeted,
  // independent of the requester IP.
  const emailLimit = checkRateLimit(`forgot:email:${email}`, 5, 60 * 60 * 1000);
  if (!emailLimit.allowed) {
    return GENERIC_OK;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true },
  });

  if (!user || !user.isActive) {
    // Sleep a touch so timing doesn't reveal account existence.
    await new Promise((r) => setTimeout(r, 150));
    return GENERIC_OK;
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  // Invalidate any prior unused token for this user so the latest email is
  // always the only working link.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const baseUrl = resolveBaseUrl(request);
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  const sent = await sendEmail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe IziPilot",
    react: PasswordReset({
      name: user.name,
      resetUrl,
      expiresInMinutes: TOKEN_TTL_MINUTES,
    }),
  });

  if (!sent.success) {
    logger.error("reset email failed", { userId: user.id }, sent.error);
  } else {
    logger.info("reset email sent", { userId: user.id });
  }

  return GENERIC_OK;
}
