"use client";

import { useState } from "react";

interface LevelDTO {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: string | null;
}

interface AssetLevelsPanelProps {
  asset: { id: string; levels: LevelDTO[] };
  onChanged: () => void;
}

export function AssetLevelsPanel({ asset, onChanged }: AssetLevelsPanelProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function addLevel() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/access/assets/${asset.id}/levels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          priority: priority ? Number(priority) : null,
          isAdmin,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la création du niveau");
      }
      setName("");
      setPriority("");
      setIsAdmin(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdmin(level: LevelDTO) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/access/assets/${asset.id}/levels/${level.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !level.isAdmin }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la mise à jour du niveau");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function archiveLevel(level: LevelDTO) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/access/assets/${asset.id}/levels/${level.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de l'archivage du niveau");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {asset.levels.length === 0 ? (
        <p className="text-[11px] text-izi-gray">Aucun niveau défini.</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="izi-table">
          <thead>
            <tr>
              <th>Niveau</th>
              <th>Priorité</th>
              <th>Admin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {asset.levels.map((l) => (
              <tr key={l.id} data-muted={l.archivedAt ? "" : undefined}>
                <td className="text-dark">{l.name}</td>
                <td className="font-mono">{l.priority ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => toggleAdmin(l)}
                    disabled={!!l.archivedAt}
                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      l.isAdmin ? "bg-izi-red-lt text-red-dk" : "bg-izi-gray-lt text-izi-gray"
                    }`}
                  >
                    {l.isAdmin === null ? "Non défini" : l.isAdmin ? "Oui" : "Non"}
                  </button>
                </td>
                <td className="text-right">
                  {!l.archivedAt && (
                    <button
                      type="button"
                      onClick={() => archiveLevel(l)}
                      className="text-izi-gray hover:text-red-dk"
                    >
                      Archiver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="flex items-end gap-2 border-t border-border-soft pt-3">
        <div className="flex-1">
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nouveau niveau
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="izi-form-input w-full px-[9px] py-[6px] border border-teal-md rounded-[7px] text-dark font-sans text-[12px]"
            placeholder="Ex : Lecture"
          />
        </div>
        <div className="w-20">
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Priorité
          </label>
          <input
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="izi-form-input w-full px-[9px] py-[6px] border border-teal-md rounded-[7px] text-dark font-sans text-[12px]"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-[11px] text-dark cursor-pointer">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="accent-[color:var(--teal)]"
          />
          Admin
        </label>
        <button
          type="button"
          onClick={addLevel}
          disabled={saving || !name}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>

      {error && <p className="text-[11px] text-red-dk bg-izi-red-lt px-3 py-2 rounded-md">{error}</p>}
    </div>
  );
}
