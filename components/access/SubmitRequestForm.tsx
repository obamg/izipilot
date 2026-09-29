// components/access/SubmitRequestForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AssetOption {
  id: string;
  name: string;
  levels: { id: string; name: string }[];
}

export function SubmitRequestForm({
  assets,
  currentUserId,
}: {
  assets: AssetOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [assetId, setAssetId] = useState("");
  const [targetLevelId, setTargetLevelId] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedAsset = assets.find((a) => a.id === assetId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!assetId || !targetLevelId || !justification.trim()) {
      setError("Tous les champs sont obligatoires");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/access/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: currentUserId,
          assetId,
          targetLevelId,
          justification,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de la soumission");
        return;
      }
      setSuccess(`Demande soumise (${payload.data.kind}), en attente d'approbation.`);
      setAssetId("");
      setTargetLevelId("");
      setJustification("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[10px] border border-border-soft bg-white p-4 space-y-3">
      <h2 className="font-serif text-[16px] text-dark">Nouvelle demande</h2>
      <div>
        <label className="block text-[11px] text-izi-gray mb-1">Actif</label>
        <select
          value={assetId}
          onChange={(e) => {
            setAssetId(e.target.value);
            setTargetLevelId("");
          }}
          className="w-full rounded-[6px] border border-teal-md px-2 py-1.5 text-[13px] text-dark bg-white"
        >
          <option value="">Choisir un actif...</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {selectedAsset && (
        <div>
          <label className="block text-[11px] text-izi-gray mb-1">Niveau souhaité</label>
          <select
            value={targetLevelId}
            onChange={(e) => setTargetLevelId(e.target.value)}
            className="w-full rounded-[6px] border border-teal-md px-2 py-1.5 text-[13px] text-dark bg-white"
          >
            <option value="">Choisir un niveau...</option>
            {selectedAsset.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="block text-[11px] text-izi-gray mb-1">Justification</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={3}
          className="w-full rounded-[6px] border border-teal-md px-2 py-1.5 text-[13px] text-dark bg-white"
        />
      </div>
      {error && <p className="text-[11px] text-red">{error}</p>}
      {success && <p className="text-[11px] text-izi-green">{success}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-[6px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
      >
        {submitting ? "Envoi..." : "Soumettre"}
      </button>
    </form>
  );
}
