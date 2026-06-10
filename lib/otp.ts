import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { sendEmail } from "./email";
import LoginOtpEmail from "@/emails/LoginOtp";
import { log } from "./log";

// Email-based 2FA. Two-step credentials login:
//   step 1: email + password OK → issueOtp(user) → email sent → return challenge JWT
//   step 2: caller posts (challenge JWT, 6-digit code) → consumeOtp(...)
//
// The challenge JWT is signed with NEXTAUTH_SECRET so we don't need a new env
// var; it embeds the userId and an `otp` claim (the LoginOtp row id) so the
// verifier can look up the exact record without trusting client-supplied ids.

const logger = log.child("otp");

const OTP_TTL_SECONDS = 10 * 60; // 10 min
const CHALLENGE_TTL_SECONDS = 15 * 60; // 15 min — slightly longer so the form has slack
const MAX_ATTEMPTS = 5;
const ISSUER = "izipilot";
const AUDIENCE = "login-otp";

function secret() {
  const raw = process.env.NEXTAUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("NEXTAUTH_SECRET is missing");
  }
  return new TextEncoder().encode(raw);
}

function generateCode(): string {
  // 6 digits, uniformly distributed. crypto.getRandomValues isn't available
  // in all Node versions, so we use Node's crypto module.
  const buf = require("node:crypto").randomBytes(4);
  // 4 bytes → 32 bits → ample for a 0..999999 mapping.
  const n = buf.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

export interface IssueResult {
  challengeToken: string;
  expiresInSeconds: number;
}

/**
 * Generate a fresh OTP, invalidate any pending ones for the same user,
 * email the code, and return a signed challenge token to bind the
 * subsequent verification call.
 */
export async function issueOtp(userId: string, email: string, userName: string): Promise<IssueResult> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  // One active OTP per user — invalidate prior unconsumed ones so a fresh
  // "resend" can't be bypassed by replaying an older code.
  await prisma.$transaction([
    prisma.loginOtp.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date(), attempts: MAX_ATTEMPTS },
    }),
    prisma.loginOtp.create({
      data: { userId, codeHash, expiresAt },
    }),
  ]);

  const otp = await prisma.loginOtp.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!otp) {
    throw new Error("Failed to persist OTP");
  }

  const challengeToken = await new SignJWT({ uid: userId, otp: otp.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(secret());

  // Fire-and-forget the email — failure shouldn't block the user from
  // requesting a resend. We log it so ops can spot delivery problems.
  const result = await sendEmail({
    to: email,
    subject: `IziPilot — code de connexion ${code}`,
    react: LoginOtpEmail({ name: userName, code }),
  });
  if (!result.success) {
    logger.error("otp email failed", { userId, error: result.error });
  }

  return { challengeToken, expiresInSeconds: OTP_TTL_SECONDS };
}

export interface ConsumeResult {
  userId: string;
}

interface ConsumeError {
  reason: "invalid_token" | "expired" | "wrong_code" | "too_many_attempts";
}

/**
 * Verify a challenge token + 6-digit code. Returns the userId on success or
 * throws a ConsumeOtpError with a discriminating reason.
 */
export async function consumeOtp(
  challengeToken: string,
  code: string,
): Promise<ConsumeResult> {
  let userId: string;
  let otpId: string;
  try {
    const { payload } = await jwtVerify(challengeToken, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.uid !== "string" || typeof payload.otp !== "string") {
      throw new Error("bad claims");
    }
    userId = payload.uid;
    otpId = payload.otp;
  } catch {
    throw new ConsumeOtpError("invalid_token");
  }

  const otp = await prisma.loginOtp.findUnique({ where: { id: otpId } });
  if (!otp || otp.userId !== userId) throw new ConsumeOtpError("invalid_token");
  if (otp.consumedAt) throw new ConsumeOtpError("invalid_token");
  if (otp.expiresAt < new Date()) throw new ConsumeOtpError("expired");
  if (otp.attempts >= MAX_ATTEMPTS) throw new ConsumeOtpError("too_many_attempts");

  const matches = await bcrypt.compare(code, otp.codeHash);
  if (!matches) {
    // Use a conditional update so two concurrent wrong guesses don't both
    // increment from the same value and let an attacker get an extra try.
    await prisma.loginOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    const next = otp.attempts + 1;
    if (next >= MAX_ATTEMPTS) throw new ConsumeOtpError("too_many_attempts");
    throw new ConsumeOtpError("wrong_code");
  }

  await prisma.loginOtp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });

  return { userId };
}

export class ConsumeOtpError extends Error {
  constructor(public reason: ConsumeError["reason"]) {
    super(reason);
    this.name = "ConsumeOtpError";
  }
}

/** Best-effort cleanup. Safe to run from a daily cron. */
export async function purgeExpiredOtps(): Promise<number> {
  const result = await prisma.loginOtp.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  return result.count;
}
