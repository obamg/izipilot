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
  }
}

// Edge-safe NextAuth config used by middleware.ts. Must NOT import Prisma or
// any node-only deps — the middleware runs in the edge runtime. The full
// config in lib/auth.ts extends this and adds the Credentials provider +
// JWT-revalidation callback that hits the database.
export default {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 4 * 60 * 60 },
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
