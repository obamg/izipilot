"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (newPassword !== confirmPassword) {
      setError("La confirmation ne correspond pas");
      setLoading(false);
      return;
    }
    if (newPassword.length < 8) {
      setError("Le mot de passe doit faire au moins 8 caractères");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Erreur lors de la réinitialisation");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (!token) {
    return (
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-2xl text-dark">
            Izi<span className="text-teal">Pilot</span>
          </h1>
        </div>
        <p className="rounded-md bg-izi-red-lt px-3 py-2 text-sm text-izi-red">
          Lien invalide. Demandez un nouveau lien de réinitialisation.
        </p>
        <div className="mt-6 text-center text-sm">
          <Link href="/forgot-password" className="text-teal hover:text-teal-dk">
            Demander un nouveau lien
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-2xl text-dark">
            Izi<span className="text-teal">Pilot</span>
          </h1>
          <p className="mt-1 font-serif text-sm italic text-izi-gray">
            Mot de passe mis à jour
          </p>
        </div>
        <p className="rounded-md bg-teal-lt px-3 py-2 text-sm text-dark-md">
          Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous
          connecter.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="block w-full rounded-lg bg-teal px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-teal-dk"
          >
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h1 className="font-serif text-2xl text-dark">
          Izi<span className="text-teal">Pilot</span>
        </h1>
        <p className="mt-1 font-serif text-sm italic text-izi-gray">
          Nouveau mot de passe
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-dark-md">
            Nouveau mot de passe
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 block w-full rounded-lg border border-teal-md px-3 py-2 text-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <p className="mt-1 text-xs text-izi-gray">8 caractères minimum.</p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-dark-md">
            Confirmer le nouveau mot de passe
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 block w-full rounded-lg border border-teal-md px-3 py-2 text-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          />
        </div>

        {error && (
          <p className="rounded-md bg-izi-red-lt px-3 py-2 text-sm text-izi-red">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-dk disabled:opacity-50"
        >
          {loading ? "Enregistrement..." : "Réinitialiser le mot de passe"}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
