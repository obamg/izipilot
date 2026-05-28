import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";

const logger = log.child("auth.reset-password");

const schema = z.object({
  token: z.string().min(32).max(256),
  newPassword: z.string().min(8).max(128),
});

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`reset:ip:${ip}`, 20, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez plus tard." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Lien invalide ou mot de passe trop court (8 caractères minimum)." },
      { status: 400 }
    );
  }

  const tokenHash = hashToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    return NextResponse.json(
      { error: "Ce lien est invalide ou a expiré. Demandez-en un nouveau." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return NextResponse.json(
      { error: "Compte introuvable ou désactivé." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  // Apply the password change, mark the token used, and revoke all existing
  // sessions in one transaction — anyone with a stolen session loses access
  // the moment the legitimate owner resets.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  logger.info("password reset completed", { userId: user.id });

  return NextResponse.json({ data: { success: true } });
}
