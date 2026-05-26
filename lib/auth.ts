import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import authConfig from "./auth.config";

// Distinct credentials-error subclass so the login page can show "your
// account is disabled" rather than the generic "wrong email or password"
// banner. Wrong-credential cases stay generic to avoid user enumeration.
class AccountDeactivatedError extends CredentialsSignin {
  code = "account_deactivated";
}

// How often we re-read role / orgId / isActive from the database while a
// session is open. JWTs are stateless, so without this a CEO demoted to
// VIEWER or a deactivated user would keep their old role until the 4h
// session expired. 60s caps that drift to a minute.
const REVALIDATE_MS = 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        // Wrong email, missing password hash, wrong password — all collapse
        // to "invalid credentials" so an attacker can't probe which emails
        // are registered.
        if (!user) return null;
        if (!user.passwordHash) return null;
        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!isValid) return null;

        // Password is correct but the account was deactivated by an admin.
        // Surface that distinctly so the user contacts their admin instead
        // of trying password resets.
        if (!user.isActive) throw new AccountDeactivatedError();

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account }) {
      // Allow all credential sign-ins (adapter doesn't manage these)
      if (account?.provider === "credentials") return true;
      return true;
    },
    async jwt({ token, user, trigger }) {
      // Initial login or session.update() — seed from the User row.
      if (user) {
        token.role = user.role;
        token.orgId = user.orgId;
        token.mustChangePassword = user.mustChangePassword ?? false;
        token.lastValidated = Date.now();
        return token;
      }

      const lastValidated =
        typeof token.lastValidated === "number" ? token.lastValidated : 0;
      const stale = Date.now() - lastValidated > REVALIDATE_MS;

      if (!stale && trigger !== "update") return token;
      if (!token.sub) return null;

      const fresh = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { role: true, orgId: true, isActive: true, mustChangePassword: true },
      });
      // User deleted or deactivated since the JWT was issued → revoke the
      // session. Returning null forces NextAuth to treat the request as
      // unauthenticated, which the middleware redirects to /login.
      if (!fresh || !fresh.isActive) return null;

      token.role = fresh.role;
      token.orgId = fresh.orgId;
      token.mustChangePassword = fresh.mustChangePassword;
      token.lastValidated = Date.now();
      return token;
    },
  },
});
