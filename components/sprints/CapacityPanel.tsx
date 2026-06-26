"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserOption } from "./types";

export interface CapacityRow {
  userId: string;
  userName: string;
  capacityPoints: number;
  assignedPoints: number;
  utilizationPct: number;
}

interface CapacityPanelProps {
  rows: CapacityRow[];
  allUsers: UserOption[];
  sprintId: string;
  canEdit: boolean;
}

function barColor(util: number): string {
  if (util === 0) return "#b3e0e0";
  if (util <= 85) return "#1d9e75";
  if (util <= 100) return "#008081";
  return "#e23c4a"; // overcommitted
}

export function CapacityPanel({ rows, allUsers, sprintId, canEdit }: CapacityPanelProps) {
  const router = useRouter();
  const byUser = new Map(rows.map((r) => [r.userId, r]));

  // When editing, surface every org member so capacity can be set for anyone.
  // Otherwise only show members with capacity or assigned work.
  const displayUsers = canEdit
    ? allUsers
    : allUsers.filter((u) => {
        const r = byUser.get(u.id);
        return r && (r.capacityPoints > 0 || r.assignedPoints > 0);
      });

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const u of allUsers) {
      const cap = byUser.get(u.id)?.capacityPoints ?? 0;
      init[u.id] = cap ? String(cap) : "";
    }
    return init;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setIsSaving(true);
    try {
      const entries = displayUsers
        .map((u) => ({
          userId: u.id,
          capacityPoints: draft[u.id]?.trim() ? Number(draft[u.id]) : 0,
        }))
        .filter((e) => Number.isFinite(e.capacityPoints));
      const res = await fetch(`/api/sprints/${sprintId}/capacity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Échec de l'enregistrement");
        return;
      }
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  if (displayUsers.length === 0) {
    return (
      <p className="text-[13px] text-izi-gray py-6 text-center">
        Aucune capacité définie pour ce sprint.
      </p>
    );
  }

  const totalCapacity = displayUsers.reduce(
    (s, u) => s + (byUser.get(u.id)?.capacityPoints ?? 0),
    0
  );
  const totalAssigned = displayUsers.reduce(
    (s, u) => s + (byUser.get(u.id)?.assignedPoints ?? 0),
    0
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-[12px] text-izi-gray">
          Capacité totale{" "}
          <span className="font-mono font-semibold text-dark">{totalCapacity} pts</span> ·
          assigné{" "}
          <span className="font-mono font-semibold text-dark">{totalAssigned} pts</span>
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {isSaving ? "Enregistrement…" : "Enregistrer la capacité"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-[10px] border border-border-soft bg-white">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-izi-gray-lt bg-izi-gray-lt/30 text-izi-gray">
              <th className="text-left py-2 px-3 text-[9px] font-semibold uppercase tracking-[0.07em]">
                Membre
              </th>
              <th className="text-center py-2 px-3 text-[9px] font-semibold uppercase tracking-[0.07em] w-[110px]">
                Capacité
              </th>
              <th className="text-center py-2 px-3 text-[9px] font-semibold uppercase tracking-[0.07em] w-[90px]">
                Assigné
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-semibold uppercase tracking-[0.07em]">
                Charge
              </th>
            </tr>
          </thead>
          <tbody>
            {displayUsers.map((u) => {
              const r = byUser.get(u.id);
              const assigned = r?.assignedPoints ?? 0;
              const util = r?.utilizationPct ?? 0;
              return (
                <tr key={u.id} className="border-b border-izi-gray-lt last:border-b-0">
                  <td className="py-2 px-3 text-dark">{u.name}</td>
                  <td className="py-2 px-3 text-center">
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={draft[u.id] ?? ""}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [u.id]: e.target.value }))
                        }
                        placeholder="0"
                        className="w-[64px] rounded-[6px] border border-border-soft bg-white px-2 py-1 text-[12px] text-center text-dark focus:outline-none focus:border-teal"
                      />
                    ) : (
                      <span className="font-mono text-dark">{r?.capacityPoints ?? 0}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center font-mono text-dark">{assigned}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-izi-gray-lt overflow-hidden min-w-[60px]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, util)}%`,
                            backgroundColor: barColor(util),
                          }}
                        />
                      </div>
                      <span
                        className="font-mono text-[10px] w-[42px] text-right"
                        style={{ color: util > 100 ? "#e23c4a" : "#5f6e7a" }}
                      >
                        {util}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
