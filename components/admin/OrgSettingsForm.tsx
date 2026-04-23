"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface OrgData {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  plan: string;
  createdAt: string;
  counts: {
    users: number;
    departments: number;
    products: number;
    objectives: number;
    keyResults: number;
  };
}

interface OrgSettingsFormProps {
  org: OrgData;
}

export function OrgSettingsForm({ org }: OrgSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const form = new FormData(e.currentTarget);
    const data = {
      name: form.get("name") as string,
      primaryColor: form.get("primaryColor") as string,
    };

    try {
      const res = await fetch("/api/admin/organization", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la sauvegarde");
      }

      setSuccess(true);
      startTransition(() => router.refresh());
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  const PLAN_LABELS: Record<string, string> = {
    FREE: "Gratuit",
    PRO: "Pro",
    ENTERPRISE: "Enterprise",
  };

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Utilisateurs", value: org.counts.users },
          { label: "D\u00e9partements", value: org.counts.departments },
          { label: "Produits", value: org.counts.products },
          { label: "Objectifs", value: org.counts.objectives },
          { label: "Key Results", value: org.counts.keyResults },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-[10px] border border-[#deeaea] p-3 text-center"
          >
            <p className="font-mono text-[20px] font-semibold text-teal">{s.value}</p>
            <p className="text-[9px] text-izi-gray uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Settings form */}
      <div className="bg-white rounded-[10px] border border-[#deeaea] p-5">
        <h3 className="font-serif text-[14px] text-dark mb-4">
          Param&egrave;tres de l&apos;organisation
        </h3>

        <form onSubmit={handleSubmit} className="space-y-3 max-w-[400px]">
          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Nom
            </label>
            <input
              name="name"
              required
              defaultValue={org.name}
              className="w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans"
            />
          </div>

          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Slug
            </label>
            <input
              value={org.slug}
              disabled
              className="w-full px-[9px] py-[7px] border border-[#deeaea] rounded-[7px] text-[11px] text-izi-gray bg-izi-gray-lt font-sans cursor-not-allowed"
            />
          </div>

          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Couleur principale
            </label>
            <input
              name="primaryColor"
              type="color"
              defaultValue={org.primaryColor}
              className="w-full h-[34px] border border-teal-md rounded-[7px] cursor-pointer"
            />
          </div>

          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Plan
            </label>
            <input
              value={PLAN_LABELS[org.plan] ?? org.plan}
              disabled
              className="w-full px-[9px] py-[7px] border border-[#deeaea] rounded-[7px] text-[11px] text-izi-gray bg-izi-gray-lt font-sans cursor-not-allowed"
            />
          </div>

          <div>
            <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
              Cr&eacute;&eacute; le
            </label>
            <input
              value={new Date(org.createdAt).toLocaleDateString("fr-FR")}
              disabled
              className="w-full px-[9px] py-[7px] border border-[#deeaea] rounded-[7px] text-[11px] text-izi-gray bg-izi-gray-lt font-sans cursor-not-allowed"
            />
          </div>

          {error && (
            <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          {success && (
            <p className="text-[11px] text-izi-green bg-izi-green-lt px-3 py-2 rounded-md">
              Enregistr&eacute; avec succ&egrave;s
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {isPending ? "..." : "Enregistrer"}
          </button>
        </form>
      </div>
    </div>
  );
}
