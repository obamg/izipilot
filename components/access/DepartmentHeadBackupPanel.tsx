"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CoverageDTO {
  departmentId: string;
  departmentName: string;
  ownerId: string;
  ownerName: string;
  assignmentId: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
}

export function DepartmentHeadBackupPanel({
  coverage,
  users,
}: {
  coverage: CoverageDTO[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [saving, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setBackup(departmentId: string, backupUserId: string | null) {
    setError(null);
    setSavingId(departmentId);
    try {
      const res = await fetch(`/api/access/roles/departments/${departmentId}/backup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupUserId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la mise à jour");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleUnavailable(assignmentId: string, current: boolean) {
    setError(null);
    const res = await fetch(`/api/access/roles/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primaryUnavailable: !current }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Erreur lors de la mise à jour");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4 mb-4">
      <h2 className="font-serif text-[16px] text-dark mb-1">Suppléants de chef de département</h2>
      <p className="text-[12px] text-izi-gray mb-3">
        Le chef de département reste toujours <code>Department.ownerId</code> — ce panneau ne
        configure que son suppléant et sa disponibilité pour le routage des approbations.
      </p>
      {error && <p className="text-[11px] text-red mb-2">{error}</p>}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="py-1 font-medium">Département</th>
            <th className="py-1 font-medium">Chef</th>
            <th className="py-1 font-medium">Suppléant</th>
            <th className="py-1 font-medium">Disponibilité</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {coverage.map((c) => (
            <tr key={c.departmentId} className="border-t border-border-soft">
              <td className="py-1">{c.departmentName}</td>
              <td className="py-1">{c.ownerName}</td>
              <td className="py-1">
                {c.backupUserName ? (
                  <span>
                    {c.backupUserName}{" "}
                    <button
                      type="button"
                      onClick={() => setBackup(c.departmentId, null)}
                      disabled={saving === c.departmentId}
                      className="text-red text-[10px] underline ml-1"
                    >
                      retirer
                    </button>
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <select
                      value={selected[c.departmentId] ?? ""}
                      onChange={(e) => setSelected((s) => ({ ...s, [c.departmentId]: e.target.value }))}
                      className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark bg-white"
                    >
                      <option value="">Choisir...</option>
                      {users
                        .filter((u) => u.id !== c.ownerId)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBackup(c.departmentId, selected[c.departmentId])}
                      disabled={!selected[c.departmentId] || saving === c.departmentId}
                      className="rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
                    >
                      Définir
                    </button>
                  </div>
                )}
              </td>
              <td className="py-1">
                {c.assignmentId ? (
                  <button
                    type="button"
                    onClick={() => toggleUnavailable(c.assignmentId as string, c.primaryUnavailable)}
                    className={`rounded-[6px] px-2 py-1 text-[11px] font-medium ${
                      c.primaryUnavailable ? "bg-red-lt text-red" : "bg-green-lt text-green"
                    }`}
                  >
                    {c.primaryUnavailable ? "Indisponible" : "Disponible"}
                  </button>
                ) : (
                  <span className="text-izi-gray">—</span>
                )}
              </td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
