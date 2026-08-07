import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@prisma/client";
import { prisma } from "./prisma";

// Token layer for the native mobile app (Expo).
//
// Access token: HS256 JWT signed with NEXTAUTH_SECRET (same key strategy as
// the OTP challenge in lib/otp.ts — no new env var), audience
// "izipilot-mobile" so it can never be replayed against the MCP surface
// (aud "izipilot-mcp") or mistaken for an OTP challenge (aud "login-otp").
// Short-lived; carries userId/orgId/role claims but the API guard re-loads
// the user from DB anyway, so a revoked/deactivated user dies within one TTL.
//
// Refresh token: opaque 48-byte secret, sha256 at rest (MobileRefreshToken),
// 90-day TTL, rotated on every refresh — a replayed old token is revoked.

export const MOBILE_ACCESS_TTL_SECONDS = 60 * 60; // 1h
export const MOBILE_REFRESH_TTL_DAYS = 90;
const ISSUER = "izipilot";
const AUDIENCE = "izipilot-mobile";

function secret(): Uint8Array {
  const raw = process.env.NEXTAUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error("NEXTAUTH_SECRET is missing");
  }
  return new TextEncoder().encode(raw);
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface MobileTokenClaims {
  userId: string;
  orgId: string;
  role: UserRole;
}

export async function mintMobileAccessToken(claims: MobileTokenClaims): Promise<string> {
  return new SignJWT({ org: claims.orgId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MOBILE_ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

/** Verify a Bearer access token. Returns the userId or null — never throws. */
export async function verifyMobileAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface RefreshPair {
  refreshToken: string;
  expiresAt: Date;
}

export async function createMobileRefreshToken(
  userId: string,
  orgId: string,
  deviceName?: string,
): Promise<RefreshPair> {
  const raw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + MOBILE_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
  await prisma.mobileRefreshToken.create({
    data: { tokenHash: sha256(raw), userId, orgId, deviceName, expiresAt },
  });
  return { refreshToken: raw, expiresAt };
}

export interface RotateResult {
  userId: string;
  orgId: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Validate + rotate a refresh token. Returns null on any failure (unknown,
 * expired, revoked). The old row is revoked inside the same transaction as
 * the new one is created, so a token can never be redeemed twice.
 */
export async function rotateMobileRefreshToken(raw: string): Promise<RotateResult | null> {
  const row = await prisma.mobileRefreshToken.findUnique({
    where: { tokenHash: sha256(raw) },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;

  const nextRaw = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + MOBILE_REFRESH_TTL_DAYS * 24 * 3600 * 1000);

  // updateMany with revokedAt: null is the concurrency guard — if two racing
  // requests redeem the same token, only one revocation "wins" (count === 1)
  // and the loser gets null.
  const revoked = await prisma.mobileRefreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });
  if (revoked.count !== 1) return null;

  await prisma.mobileRefreshToken.create({
    data: {
      tokenHash: sha256(nextRaw),
      userId: row.userId,
      orgId: row.orgId,
      deviceName: row.deviceName,
      expiresAt,
    },
  });

  return { userId: row.userId, orgId: row.orgId, refreshToken: nextRaw, expiresAt };
}

/** Revoke every refresh token for a user (logout-all / deactivation). */
export async function revokeAllMobileTokens(userId: string): Promise<number> {
  const r = await prisma.mobileRefreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count;
}
