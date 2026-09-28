"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ConfigIssuesPanelProps {
  issues: {
    usersWithoutPrimaryDepartment: { id: string; name: string; departmentCount: number }[];
  };
  departments: { id: string; name: string }[];
}

export function ConfigIssuesPanel({ issues, departments }: ConfigIssuesPanelProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const total = issues.usersWithoutPrimaryDepartment.length;
  if (total === 0) return null;

  async function fixPrimaryDepartment(userId: string) {
    const primaryDepartmentId = selected[userId];
    if (!primaryDepartmentId) return;
    setError(null);
    setSavingId(userId);
    try {
      const res = await fetch(`/api/access/profiles/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryDepartmentId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la mise à jour");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mb-4 rounded-[10px] border border-[#f4a900]/30 bg-[#fffbe6] px-4 py-3">
      <p className="text-[12px] font-semibold text-dark mb-2">
        {total} employé{total > 1 ? "s" : ""} sans département principal
      </p>
      <ul className="space-y-2">
        {issues.usersWithoutPrimaryDepartment.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 text-[11px] text-izi-gray">
            <span>
              {u.name}
              {u.departmentCount > 1
                ? ` (membre de ${u.departmentCount} départements)`
                : " (membre d'aucun département)"}
            </span>
            <select
              value={selected[u.id] ?? ""}
              onChange={(e) => setSelected((s) => ({ ...s, [u.id]: e.target.value }))}
              className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark bg-white"
            >
              <option value="">Choisir un département...</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => fixPrimaryDepartment(u.id)}
              disabled={!selected[u.id] || savingId === u.id}
              className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {savingId === u.id ? "..." : "Définir"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[11px] text-izi-red">{error}</p>}
    </div>
  );
}
