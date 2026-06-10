import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { issueOtp, consumeOtp, ConsumeOtpError } from "./otp";
import authConfig from "./auth.config";

// Distinct credentials-error subclass so the login page can show "your
// account is disabled" rather than the generic "wrong email or password"
// banner. Wrong-credential cases stay generic to avoid user enumeration.
class AccountDeactivatedError extends CredentialsSignin {
  code = "account_deactivated";
}

// Step 1 of two-step login succeeded — password is correct, OTP has been
// sent. The login page reads this code + the challenge cookie to swap to
// the OTP form.
class OtpRequiredError extends CredentialsSignin {
  code = "otp_required";
}
class OtpInvalidError extends CredentialsSignin {
  code = "otp_invalid";
}
class OtpExpiredError extends CredentialsSignin {
  code = "otp_expired";
}
class OtpTooManyError extends CredentialsSignin {
  code = "otp_too_many";
}

const OTP_COOKIE = "izipilot_otp_challenge";

// How often we re-read role / orgId / isActive from the database while a
// session is open. JWTs are stateless, so without this a CEO demoted to
// VIEWER or a deactivated user would keep their old role until the
// 30-day session expired. 60s caps that drift to a minute.
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
        otpCode: { label: "OTP", type: "text" },
      },
      async authorize(credentials) {
        const otpCode =
          typeof credentials?.otpCode === "string" && credentials.otpCode.trim()
            ? credentials.otpCode.trim()
            : null;

        // === Step 2 — verify the OTP code against the challenge cookie ===
        if (otpCode) {
          const jar = await cookies();
          const challenge = jar.get(OTP_COOKIE)?.value;
          if (!challenge) throw new OtpExpiredError();
          try {
            const { userId } = await consumeOtp(challenge, otpCode);
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user || !user.isActive) throw new AccountDeactivatedError();

            jar.delete(OTP_COOKIE);
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
          } catch (err) {
            if (err instanceof ConsumeOtpError) {
              if (err.reason === "expired") throw new OtpExpiredError();
              if (err.reason === "too_many_attempts") throw new OtpTooManyError();
              if (err.reason === "wrong_code") throw new OtpInvalidError();
              throw new OtpExpiredError();
            }
            throw err;
          }
        }

        // === Step 1 — validate email + password, send OTP ===
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
          user.passwordHash,
        );
        if (!isValid) return null;

        // Password is correct but the account was deactivated by an admin.
        // Surface that distinctly so the user contacts their admin instead
        // of trying password resets.
        if (!user.isActive) throw new AccountDeactivatedError();

        const { challengeToken, expiresInSeconds } = await issueOtp(
          user.id,
          user.email,
          user.name,
        );

        const jar = await cookies();
        jar.set(OTP_COOKIE, challengeToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: expiresInSeconds,
          path: "/",
        });

        // Refuse to mint a session — the login page sees code="otp_required"
        // and swaps to the OTP entry form.
        throw new OtpRequiredError();
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
