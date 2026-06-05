"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
      <polyline points="5 12 10 17 19 8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="var(--gray)" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function ChangePasswordPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  const rules = {
    minLength: newPwd.length >= 8,
    different: newPwd.length > 0 && newPwd !== currentPwd,
    matches: confirmPwd.length > 0 && newPwd === confirmPwd,
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const currentPassword = formData.get("currentPassword") as string;
    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (newPassword !== confirmPassword) {
      setError("La confirmation ne correspond pas");
      setLoading(false);
      return;
    }
    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit faire au moins 8 caractères");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/account/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Erreur lors du changement de mot de passe");
      setLoading(false);
      return;
    }

    // Force a fresh sign-in so the JWT loses mustChangePassword=true
    await signOut({ redirect: false });
    window.location.href = "/login?changed=1";
  }

  return (
    <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h1 className="font-serif text-2xl text-dark">
          Izi<span className="text-teal">Pilot</span>
        </h1>
        <p className="mt-1 font-serif text-sm italic text-izi-gray">
          Changez votre mot de passe pour continuer
        </p>
      </div>

      <p className="mb-4 rounded-md bg-teal-lt px-3 py-2 text-xs text-dark-md">
        Pour des raisons de sécurité, vous devez remplacer le mot de passe
        fourni par défaut avant d&apos;accéder à l&apos;application.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="currentPassword" className="block text-sm font-medium text-dark-md">
            Mot de passe actuel
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            className="izi-form-input mt-1 block w-full rounded-lg border border-teal-md px-3 py-2 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          />
        </div>

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
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            aria-describedby="newPassword-rules"
            className="izi-form-input mt-1 block w-full rounded-lg border border-teal-md px-3 py-2 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <ul id="newPassword-rules" className="mt-2 space-y-1 text-xs text-izi-gray">
            <li className={`flex items-center gap-1.5 ${rules.minLength ? "text-izi-green" : ""}`}>
              <Check ok={rules.minLength} /> Au moins 8 caractères
            </li>
            <li className={`flex items-center gap-1.5 ${rules.different ? "text-izi-green" : ""}`}>
              <Check ok={rules.different} /> Différent du mot de passe actuel
            </li>
          </ul>
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
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            aria-describedby="confirmPassword-rules"
            className="izi-form-input mt-1 block w-full rounded-lg border border-teal-md px-3 py-2 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <ul id="confirmPassword-rules" className="mt-2 space-y-1 text-xs text-izi-gray">
            <li className={`flex items-center gap-1.5 ${rules.matches ? "text-izi-green" : ""}`}>
              <Check ok={rules.matches} /> La confirmation correspond
            </li>
          </ul>
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
          {loading ? "Enregistrement..." : "Mettre à jour le mot de passe"}
        </button>
      </form>
    </div>
  );
}
