"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RowDTO {
  id: string;
  rowIndex: number;
  outcome: string;
  reason: string | null;
}
interface BatchDTO {
  id: string;
  totalRows: number;
  committedAt: string | null;
  rows: RowDTO[];
}

const MAX_BASELINE_FILE_BYTES = 5 * 1024 * 1024;
const OUTCOME_LABELS: Record<string, string> = {
  TO_CREATE: "Sera créé",
  NOOP_UNCHANGED: "Déjà à jour (rien à faire)",
  NOOP_DUPLICATE: "Doublon dans le fichier",
  UNRESOLVED: "Non résolu",
  CONFLICT: "Conflit",
};

export function ImportBaselinePanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBatch(null);
    if (file.size > MAX_BASELINE_FILE_BYTES) {
      setError("Fichier trop lourd (max 5 Mo)");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/access/imports/baseline", { method: "POST", body });
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
      const res = await fetch(`/api/access/imports/baseline/${batch.id}/commit`, { method: "POST" });
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

  const counts = (batch?.rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});
  const hasBlocking = (batch?.rows ?? []).some((r) => r.outcome === "UNRESOLVED" || r.outcome === "CONFLICT");

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4">
      <h2 className="font-serif text-[16px] text-dark mb-1">Charger une base d&apos;affectations</h2>
      <p className="text-[12px] text-izi-gray mb-3">
        Fichier normalisé (user_id;asset_id;access_level_id) préparé séparément.
        La moindre ligne en erreur bloque tout le lot — corrigez le fichier et rechargez-le.
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
        aria-label="Charger le CSV de baseline"
      />
      {uploading && <p className="mt-2 text-[12px] text-teal-dk">Analyse en cours…</p>}
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}

      {batch && (
        <div className="mt-4">
          <p className="text-[12px] text-dark mb-2">
            {batch.totalRows} ligne(s) —{" "}
            {Object.entries(counts)
              .map(([outcome, count]) => `${OUTCOME_LABELS[outcome] ?? outcome} : ${count}`)
              .join(" · ")}
          </p>
          <div className="max-h-64 overflow-y-auto rounded-[8px] border border-border-soft">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-izi-gray text-left bg-gray-lt">
                  <th className="py-1 px-2 font-medium">Ligne</th>
                  <th className="py-1 px-2 font-medium">Statut</th>
                  <th className="py-1 px-2 font-medium">Motif</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="py-1 px-2">{r.rowIndex + 2}</td>
                    <td
                      className={`py-1 px-2 ${
                        r.outcome === "UNRESOLVED" || r.outcome === "CONFLICT" ? "text-red font-medium" : ""
                      }`}
                    >
                      {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                    </td>
                    <td className="py-1 px-2">{r.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batch.committedAt ? (
            <p className="mt-2 text-[12px] text-izi-green">
              Importé le {new Date(batch.committedAt).toLocaleString("fr-FR")}.
            </p>
          ) : hasBlocking ? (
            <p className="mt-3 text-[12px] text-red font-medium">
              Ce lot contient des lignes bloquantes — corrigez le fichier source et rechargez-le.
              Aucun commit partiel n&apos;est possible.
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
