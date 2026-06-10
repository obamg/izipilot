"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function isInternalUrl(url: string): boolean {
  // Only allow relative paths starting with /
  return url.startsWith("/") && !url.startsWith("//");
}

type Step = "credentials" | "otp";

function LoginForm() {
  const searchParams = useSearchParams();
  const rawCallback = searchParams.get("callbackUrl") || "/dashboard";
  const callbackUrl = isInternalUrl(rawCallback) ? rawCallback : "/dashboard";

  const [step, setStep] = useState<Step>("credentials");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPassword, setPendingPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Step 1 — email + password → triggers OTP issuance server-side
  async function handleCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    if (result?.code === "otp_required") {
      // Password is valid; the server has emailed a code and set the
      // challenge cookie. Switch to the OTP screen.
      setPendingEmail(email);
      setPendingPassword(password);
      setStep("otp");
      setError("");
      startResendCooldown();
    } else if (result?.code === "account_deactivated") {
      setError("Compte désactivé. Contactez votre administrateur.");
    } else if (result?.error || result?.status === 429) {
      setError(
        result.status === 429
          ? "Trop de tentatives. Réessayez dans quelques minutes."
          : "Email ou mot de passe incorrect",
      );
    } else if (result?.url) {
      // Should not happen with OTP enabled, but harmless if it does.
      window.location.href = result.url;
    }
    setLoading(false);
  }

  // Step 2 — submit the OTP code
  async function handleOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const otpCode = (formData.get("otpCode") as string).replace(/\s/g, "");

    const result = await signIn("credentials", {
      email: pendingEmail,
      otpCode,
      redirect: false,
      callbackUrl,
    });

    if (result?.code === "otp_invalid") {
      setError("Code incorrect. Vérifiez et réessayez.");
    } else if (result?.code === "otp_expired") {
      setError("Code expiré. Demandez un nouveau code.");
    } else if (result?.code === "otp_too_many") {
      setError("Trop de tentatives erronées. Recommencez depuis le début.");
      setTimeout(() => {
        setStep("credentials");
        setError("");
      }, 2000);
    } else if (result?.error) {
      setError("Erreur de connexion. Réessayez.");
    } else if (result?.url) {
      window.location.href = result.url;
      return;
    }
    setLoading(false);
  }

  function startResendCooldown() {
    setResendCooldown(60);
    const timer = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setError("");
    // Re-running step 1 generates a fresh OTP and rotates the cookie.
    const result = await signIn("credentials", {
      email: pendingEmail,
      password: pendingPassword,
      redirect: false,
      callbackUrl,
    });
    if (result?.code === "otp_required") {
      startResendCooldown();
    } else {
      setError("Impossible de renvoyer le code. Recommencez la connexion.");
      setStep("credentials");
    }
    setResending(false);
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-7 sm:p-8 shadow-[0_8px_32px_rgba(0,128,129,0.12)] border border-white">
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal shadow-[0_6px_18px_rgba(0,128,129,0.35)]">
          <svg viewBox="0 0 28 28" fill="none" className="h-7 w-7" aria-hidden="true">
            <circle cx="14" cy="14" r="10" stroke="white" strokeWidth="2" />
            <path
              d="M14 8L14 14L18 17"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="14" cy="14" r="2.5" fill="white" />
          </svg>
        </div>
        <h1 className="font-serif text-3xl text-dark leading-none">
          Izi<span className="text-teal">Pilot</span>
        </h1>
        <p className="mt-2 font-serif text-sm italic text-izi-gray">
          L&apos;exécution au rythme de vos ambitions
        </p>
      </div>

      {step === "credentials" ? (
        <form onSubmit={handleCredentials} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-dark-md">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={!!error}
              className="izi-form-input mt-1 block w-full rounded-lg border border-teal-md px-3 py-2.5 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
              placeholder="vous@izichange.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-dark-md">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={!!error}
              className="izi-form-input mt-1 block w-full rounded-lg border border-teal-md px-3 py-2.5 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p id="login-error" role="alert" className="rounded-md bg-izi-red-lt px-3 py-2 text-sm text-izi-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal/25 transition-colors hover:bg-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Vérification..." : "Se connecter"}
          </button>

          <div className="text-center text-sm">
            <Link
              href="/forgot-password"
              className="text-teal hover:text-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-sm px-1"
            >
              Mot de passe oublié ?
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={handleOtp} className="space-y-4" noValidate>
          <div>
            <h2 className="text-base font-semibold text-dark">
              Code de vérification
            </h2>
            <p className="mt-1 text-xs text-izi-gray">
              Un code à 6 chiffres a été envoyé à{" "}
              <strong className="text-dark-md">{pendingEmail}</strong>. Il
              expire dans 10 minutes.
            </p>
          </div>

          <div>
            <label htmlFor="otpCode" className="block text-sm font-medium text-dark-md">
              Code reçu par email
            </label>
            <input
              id="otpCode"
              name="otpCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="[0-9]{6}"
              autoFocus
              aria-describedby={error ? "otp-error" : undefined}
              aria-invalid={!!error}
              className="izi-form-input mt-1 block w-full rounded-lg border border-teal-md px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
              placeholder="••••••"
            />
          </div>

          {error && (
            <p id="otp-error" role="alert" className="rounded-md bg-izi-red-lt px-3 py-2 text-sm text-izi-red">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal/25 transition-colors hover:bg-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Vérification..." : "Vérifier le code"}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0 || resending}
              className="text-teal hover:text-teal-dk disabled:text-izi-gray disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-sm px-1"
            >
              {resending
                ? "Envoi..."
                : resendCooldown > 0
                  ? `Renvoyer dans ${resendCooldown}s`
                  : "Renvoyer le code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("credentials");
                setError("");
                setPendingPassword("");
              }}
              className="text-izi-gray hover:text-dark-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal rounded-sm px-1"
            >
              Recommencer
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
