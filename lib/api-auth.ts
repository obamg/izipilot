import { headers } from "next/headers";
import type { Session } from "next-auth";
import { auth as cookieAuth } from "./auth";
import { verifyMobileAccessToken, MOBILE_ACCESS_TTL_SECONDS } from "./mobile-token";
import { prisma } from "./prisma";

// Drop-in replacement for lib/auth's `auth()` inside API route handlers.
// Order: NextAuth cookie session first (web), then `Authorization: Bearer`
// (native mobile app). Returns the exact same Session shape either way, so
// call sites don't change. Server Components/layouts keep importing lib/auth
// directly — Bearer auth is an API-only surface.
//
// The Bearer path re-loads the user from DB on every call (same freshness
// guarantee as the NextAuth JWT-revalidation callback): a deactivated user or
// changed role takes effect immediately, not at token expiry.
export async function auth(): Promise<Session | null> {
  const session = await cookieAuth();
  if (session?.user) return session;

  const authorization = (await headers()).get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const userId = await verifyMobileAccessToken(authorization.slice(7));
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      orgId: true,
      mustChangePassword: true,
    },
  });
  if (!user) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      mustChangePassword: user.mustChangePassword,
    },
    expires: new Date(Date.now() + MOBILE_ACCESS_TTL_SECONDS * 1000).toISOString(),
  };
}
