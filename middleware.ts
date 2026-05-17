import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";

// Use the edge-safe slim config — middleware runs in the edge runtime, so it
// must not import Prisma (which lives in the full lib/auth.ts via the JWT
// revalidation callback).
const { auth } = NextAuth(authConfig);

const publicPaths = ["/login", "/api/auth", "/api/cron"];

// Brute-force protection on the credentials sign-in endpoint. Behind
// nginx/Cloudflare so the real client IP arrives via x-forwarded-for —
// take the first entry in the list (the original client).
const AUTH_RATE_LIMIT = 10; // attempts
const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000; // per 5 minutes

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Rate-limit the credentials sign-in POST before NextAuth gets the
  // request. /api/auth/* is otherwise a public path, so without this
  // guard a credential-stuffing run is unbounded.
  if (
    req.method === "POST" &&
    pathname === "/api/auth/callback/credentials"
  ) {
    const ip = getClientIp(req);
    const r = checkRateLimit(
      `auth:${ip}`,
      AUTH_RATE_LIMIT,
      AUTH_RATE_WINDOW_MS
    );
    if (!r.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: "Too many login attempts. Try again later.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(r.retryAfterSec),
          },
        }
      );
    }
  }

  // Allow public paths (cron routes have their own CRON_SECRET auth)
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    // Only allow internal callback URLs to prevent open redirect
    if (pathname.startsWith("/")) {
      loginUrl.searchParams.set("callbackUrl", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // PO submission-day redirect is handled inside app/(dashboard)/dashboard/page.tsx
  // (needs DB access to check whether the PO has already submitted — middleware
  // runs in the edge runtime and cannot query Prisma).

  // Add security headers
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com"
  );

  return response;
});

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
