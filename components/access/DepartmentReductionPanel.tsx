// components/access/DepartmentReductionPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ReducibleAccess {
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  levelId: string;
  levelName: string;
}

export function DepartmentReductionPanel({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ReducibleAccess[] | null>(null);
  const [justificationByKey, setJustificationByKey] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/access/requests/department/${departmentId}/reducible`)
      .then((r) => r.json())
      .then((body) => setItems(body.data ?? []))
      .catch(() => setError("Échec du chargement"));
  }, [departmentId]);

  async function submitRevoke(item: ReducibleAccess) {
    const key = `${item.userId}:${item.assetId}`;
    if (busyKey === key) return;
    const justification = justificationByKey[key];
    if (!justification?.trim()) {
      setError("Justification obligatoire");
      return;
    }
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/access/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: item.userId,
          assetId: item.assetId,
          targetLevelId: null,
          justification,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Échec de la soumission");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusyKey(null);
    }
  }

  if (items === null) return <p className="text-[12px] text-izi-gray">Chargement...</p>;
  if (items.length === 0) return <p className="text-[12px] text-izi-gray">Aucun accès à réduire dans ce département.</p>;

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4 mb-6">
      <h2 className="font-serif text-[16px] text-dark mb-3">Initier une révocation (département)</h2>
      {error && <p className="text-[11px] text-red mb-2">{error}</p>}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="py-1 font-medium">Employé</th>
            <th className="py-1 font-medium">Actif</th>
            <th className="py-1 font-medium">Niveau actuel</th>
            <th className="py-1 font-medium">Justification</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = `${item.userId}:${item.assetId}`;
            const busy = busyKey === key;
            return (
              <tr key={key} className="border-t border-border-soft">
                <td className="py-1">{item.userName}</td>
                <td className="py-1">{item.assetName}</td>
                <td className="py-1">{item.levelName}</td>
                <td className="py-1">
                  <input
                    value={justificationByKey[key] ?? ""}
                    onChange={(e) => setJustificationByKey((s) => ({ ...s, [key]: e.target.value }))}
                    disabled={busy}
                    aria-label={`Justification de la révocation pour ${item.userName} — ${item.assetName}`}
                    className="izi-form-input rounded-[6px] border border-teal-md px-2 py-1 text-[11px] w-full disabled:opacity-50"
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => submitRevoke(item)}
                    className="rounded-[6px] bg-red px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Révoquer
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
