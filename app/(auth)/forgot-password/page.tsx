"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");

    const formData = new FormData(e.currentTarget);
    const email = (formData.get("email") as string).trim();

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setLoading(false);

    if (res.status === 429) {
      setError("Trop de demandes. Réessayez dans quelques minutes.");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setInfo(
      data?.data?.message ??
        "Si un compte existe pour cette adresse, un email de réinitialisation vient d'être envoyé."
    );
  }

  return (
    <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h1 className="font-serif text-2xl text-dark">
          Izi<span className="text-teal">Pilot</span>
        </h1>
        <p className="mt-1 font-serif text-sm italic text-izi-gray">
          Mot de passe oublié
        </p>
      </div>

      <p className="mb-4 text-sm text-dark-md">
        Saisissez votre email professionnel : nous vous enverrons un lien pour
        choisir un nouveau mot de passe.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
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
            className="mt-1 block w-full rounded-lg border border-teal-md px-3 py-2 text-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
            placeholder="vous@izichange.com"
          />
        </div>

        {error && (
          <p className="rounded-md bg-izi-red-lt px-3 py-2 text-sm text-izi-red">
            {error}
          </p>
        )}

        {info && (
          <p className="rounded-md bg-teal-lt px-3 py-2 text-sm text-dark-md">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !!info}
          className="w-full rounded-lg bg-teal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-dk disabled:opacity-50"
        >
          {loading ? "Envoi..." : "Envoyer le lien"}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <Link href="/login" className="text-teal hover:text-teal-dk">
          ← Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
