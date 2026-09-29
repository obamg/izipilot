"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RowDTO {
  id: string;
  sourceFields: Record<string, string | null>;
  outcome: string;
}
interface BatchDTO {
  id: string;
  totalRows: number;
  committedAt: string | null;
  rows: RowDTO[];
}

const MAX_SEED_FILE_BYTES = 2 * 1024 * 1024;

export function ImportSeedPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBatch(null);
    if (file.size > MAX_SEED_FILE_BYTES) {
      setError("Fichier trop lourd (max 2 Mo)");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/access/imports/catalogue-seed", { method: "POST", body });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de l'analyse du fichier");
        return;
      }
      setBatch(payload.data);
    } catch {
      setError("Échec de l'envoi — vérifiez votre connexion");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function commit() {
    if (!batch) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/imports/catalogue-seed/${batch.id}/commit`, { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de la confirmation");
        return;
      }
      setBatch(payload.data);
      router.refresh();
    } finally {
      setCommitting(false);
    }
  }

  const matched = batch?.rows.filter((r) => r.outcome === "MATCHED").length ?? 0;
  const draftCreated = batch?.rows.filter((r) => r.outcome === "DRAFT_CREATED").length ?? 0;

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4">
      <h2 className="font-serif text-[16px] text-dark mb-1">Amorcer le catalogue (seed)</h2>
      <p className="text-[12px] text-izi-gray mb-3">
        Fichier brut à 5 colonnes (utilisateur;nom_complet;departement;logiciel;niveau_acces).
        Crée les actifs et niveaux manquants — aucune affectation employé n&apos;est créée.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="block w-full text-[12px] text-izi-gray file:mr-3 file:rounded-[8px] file:border-0 file:bg-teal-lt file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-teal-dk hover:file:bg-teal-md disabled:opacity-50"
        aria-label="Charger le CSV du catalogue"
      />
      {uploading && <p className="mt-2 text-[12px] text-teal-dk">Analyse en cours…</p>}
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}

      {batch && (
        <div className="mt-4">
          <p className="text-[12px] text-dark mb-2">
            {batch.totalRows} paire(s) logiciel/niveau — {matched} déjà au catalogue, {draftCreated} à créer.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-[8px] border border-border-soft">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-izi-gray text-left bg-gray-lt">
                  <th className="py-1 px-2 font-medium">Logiciel</th>
                  <th className="py-1 px-2 font-medium">Niveau</th>
                  <th className="py-1 px-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="py-1 px-2">{r.sourceFields.logiciel}</td>
                    <td className="py-1 px-2">{r.sourceFields.niveauAcces}</td>
                    <td className="py-1 px-2">{r.outcome === "MATCHED" ? "Déjà au catalogue" : "Sera créé"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batch.committedAt ? (
            <p className="mt-2 text-[12px] text-izi-green">
              Importé le {new Date(batch.committedAt).toLocaleString("fr-FR")}.
            </p>
          ) : (
            <button
              type="button"
              onClick={commit}
              disabled={committing}
              className="mt-3 rounded-[6px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {committing ? "Confirmation…" : "Confirmer l'import"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
