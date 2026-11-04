import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      orgId: string;
      mustChangePassword: boolean;
    };
  }

  interface User {
    role: UserRole;
    orgId: string;
    mustChangePassword?: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role: UserRole;
    orgId: string;
    mustChangePassword?: boolean;
    lastValidated?: number;
    /** User.passwordChangedAt (ms) when this session was issued; 0 if never. */
    pwdAt?: number;
  }
}

// Edge-safe NextAuth config used by middleware.ts. Must NOT import Prisma or
// any node-only deps — the middleware runs in the edge runtime. The full
// config in lib/auth.ts extends this and adds the Credentials provider +
// JWT-revalidation callback that hits the database.
export default {
  trustHost: true,
  // 4-hour rolling session (CLAUDE.md § Sécurité): the JWT lives 4h and
  // `updateAge` re-issues it (extending the expiry) at most every 15 min on
  // any authenticated request. Idle for 4h → logged out.
  session: {
    strategy: "jwt",
    maxAge: 4 * 60 * 60,
    updateAge: 15 * 60,
  },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      if (!token?.sub) return session;
      session.user.id = token.sub;
      session.user.role = token.role;
      session.user.orgId = token.orgId;
      session.user.mustChangePassword = token.mustChangePassword ?? false;
      return session;
    },
  },
} satisfies NextAuthConfig;
