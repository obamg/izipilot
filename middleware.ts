import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth.config";
import { checkRateLimit } from "@/lib/rate-limit";

// Use the edge-safe slim config — middleware runs in the edge runtime, so it
// must not import Prisma (which lives in the full lib/auth.ts via the JWT
// revalidation callback).
const { auth } = NextAuth(authConfig);

const publicPaths = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/api/cron",
  // Native app auth surface (login → OTP → tokens). Rate-limited per route.
  "/api/mobile",
  "/sw.js",
  // PWA surface — the manifest, icons and offline fallback must load
  // outside a session (install banner, home-screen icon, push badge).
  "/manifest.webmanifest",
  "/icon-",
  "/apple-touch-icon.png",
  "/offline.html",
  // OAuth surface for the MCP connector. Discovery + DCR + token endpoint
  // are explicitly unauthenticated; the consent page (/oauth/authorize)
  // handles its own login redirect with the full query string preserved,
  // which the middleware can't do because it only carries the pathname.
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/api/oauth/register",
  "/api/oauth/token",
  "/oauth/authorize",
];

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

// CORS for the token-authenticated mobile/API surface. Bearer tokens are not
// ambient credentials (unlike cookies), so reflecting the Origin is safe —
// and Access-Control-Allow-Credentials is deliberately never set, so
// cookie-authenticated responses remain unreadable cross-origin.
function corsify(res: NextResponse, origin: string): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin");
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");

  // Answer CORS preflights for the API surface before any auth check —
  // browsers never attach credentials or custom headers to the preflight.
  if (req.method === "OPTIONS" && pathname.startsWith("/api/") && origin) {
    return corsify(new NextResponse(null, { status: 204 }), origin);
  }

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
    const res = NextResponse.next();
    // The mobile auth endpoints are called cross-origin during web-based
    // development/E2E of the native app.
    return pathname.startsWith("/api/mobile") && origin ? corsify(res, origin) : res;
  }

  // API calls from the native app carry a Bearer token instead of a session
  // cookie. Let them through to the route handlers — every API route
  // validates the token via lib/api-auth and 401s JSON on failure, which the
  // app can handle (a redirect to the login HTML page could not be).
  if (
    pathname.startsWith("/api/") &&
    req.headers.get("authorization")?.startsWith("Bearer ")
  ) {
    const res = NextResponse.next();
    return origin ? corsify(res, origin) : res;
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

  // Force first-login password change. The flag is set on seeded accounts,
  // newly created users (admin POST), and after an admin reset — it is
  // cleared once the user submits /change-password. We let the page itself
  // and its API route through so the user can actually update; everything
  // else (UI + APIs) is blocked to avoid acting with a default password.
  const mustChange = req.auth.user?.mustChangePassword;
  if (
    mustChange &&
    !pathname.startsWith("/change-password") &&
    !pathname.startsWith("/api/auth") &&
    !pathname.startsWith("/api/account/change-password")
  ) {
    return NextResponse.redirect(new URL("/change-password", req.url));
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
