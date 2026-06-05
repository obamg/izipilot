"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function isInternalUrl(url: string): boolean {
  // Only allow relative paths starting with /
  return url.startsWith("/") && !url.startsWith("//");
}

function LoginForm() {
  const searchParams = useSearchParams();
  const rawCallback = searchParams.get("callbackUrl") || "/dashboard";
  const callbackUrl = isInternalUrl(rawCallback) ? rawCallback : "/dashboard";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirect: false,
      callbackUrl,
    });

    if (result?.error) {
      if (result.status === 429) {
        setError(
          "Trop de tentatives. Réessayez dans quelques minutes."
        );
      } else {
        setError("Email ou mot de passe incorrect");
      }
      setLoading(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-7 sm:p-8 shadow-[0_8px_32px_rgba(0,128,129,0.12)] border border-white">
      <div className="mb-7 flex flex-col items-center text-center">
        {/* Brand mark — same clock motif as the Nav logo */}
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal shadow-[0_6px_18px_rgba(0,128,129,0.35)]">
          <svg viewBox="0 0 28 28" fill="none" className="h-7 w-7" aria-hidden="true">
            <circle cx="14" cy="14" r="10" stroke="white" strokeWidth="2" />
            <path d="M14 8L14 14L18 17" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
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

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
          <p
            id="login-error"
            role="alert"
            className="rounded-md bg-izi-red-lt px-3 py-2 text-sm text-izi-red"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal/25 transition-colors hover:bg-teal-dk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {loading ? "Connexion..." : "Se connecter"}
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
