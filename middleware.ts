import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const publicPaths = ["/login", "/api/auth", "/api/cron"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

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

  // Auto-redirect PO to /weekly on Monday before 09:00 deadline
  // Only redirects from /dashboard to avoid loops on other pages
  if (
    req.auth.user &&
    "role" in req.auth.user &&
    req.auth.user.role === "PO" &&
    pathname === "/dashboard"
  ) {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon
    const hour = now.getHours();
    if (day === 1 && hour < 9) {
      return NextResponse.redirect(new URL("/weekly", req.url));
    }
  }

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
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'"
  );

  return response;
});

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
