"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SprintStatusBadge } from "./SprintStatusBadge";
import { SprintFormModal } from "./SprintFormModal";
import type { SprintSummary } from "./types";

interface SprintHeaderProps {
  sprint: SprintSummary;
  canManage: boolean;
  daysRemaining: number;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function SprintHeader({ sprint, canManage, daysRemaining }: SprintHeaderProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function patchStatus(status: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'opération");
        return;
      }
      const carry = data.carry;
      if (carry && carry.count > 0) {
        const n = carry.count;
        const s = n > 1 ? "s" : "";
        setNotice(
          carry.toBacklog
            ? `${n} tâche${s} non terminée${s} renvoyée${s} au backlog.`
            : `${n} tâche${s} non terminée${s} reportée${s} vers ${carry.toSprintName}.`
        );
      } else if (data.spawned > 0) {
        const n = data.spawned;
        const s = n > 1 ? "s" : "";
        setNotice(`${n} tâche${s} récurrente${s} ajoutée${s} à ce sprint.`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Supprimer ce sprint ? Ses tâches retournent au backlog.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Échec de la suppression");
        setBusy(false);
        return;
      }
      router.push("/sprints");
    } catch {
      setBusy(false);
    }
  }

  const pct = sprint.stats.percentComplete;

  return (
    <div className="mb-5 rounded-[12px] border border-border-soft bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[11px] font-semibold text-teal bg-teal-lt px-1.5 py-0.5 rounded">
              #{sprint.number}
            </span>
            <SprintStatusBadge status={sprint.status} />
            {sprint.status === "ACTIVE" && (
              <span className="text-[11px] text-izi-gray">
                {daysRemaining} jour{daysRemaining > 1 ? "s" : ""} restant
                {daysRemaining > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <h1 className="font-serif text-xl text-dark">{sprint.name}</h1>
          {sprint.goal && (
            <p className="text-[13px] text-izi-gray mt-1 max-w-2xl">{sprint.goal}</p>
          )}
          <p className="font-mono text-[11px] text-izi-gray mt-1.5">
            {fmt(sprint.startDate)} → {fmt(sprint.endDate)}
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {sprint.status === "PLANNED" && (
              <button
                type="button"
                onClick={() => patchStatus("ACTIVE")}
                disabled={busy}
                className="rounded-[7px] bg-green px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Démarrer
              </button>
            )}
            {sprint.status === "ACTIVE" && (
              <button
                type="button"
                onClick={() => patchStatus("COMPLETED")}
                disabled={busy}
                className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
              >
                Clôturer
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-[7px] border border-border-soft bg-white px-3 py-1.5 text-[12px] font-medium text-izi-gray hover:bg-gray-lt transition-colors"
            >
              Modifier
            </button>
            {(sprint.status === "PLANNED" || sprint.status === "ACTIVE") && (
              <button
                type="button"
                onClick={() => patchStatus("CANCELLED")}
                disabled={busy}
                className="rounded-[7px] border border-border-soft bg-white px-3 py-1.5 text-[12px] font-medium text-izi-gray hover:bg-gray-lt transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
            )}
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-[7px] border border-red/30 bg-white px-3 py-1.5 text-[12px] font-medium text-red hover:bg-red-lt transition-colors disabled:opacity-50"
            >
              Supprimer
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
          {error}
        </div>
      )}

      {notice && (
        <div className="mt-3 rounded-[7px] border border-teal-md bg-teal-lt px-3 py-2 text-[11px] text-teal-dk">
          {notice}
        </div>
      )}

      {/* Progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-izi-gray mb-1">
          <span>
            {sprint.stats.donePoints}/{sprint.stats.totalPoints} pts ·{" "}
            {sprint.stats.doneTasks}/{sprint.stats.totalTasks} tâches
          </span>
          <span className="font-mono font-semibold text-dark">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-izi-gray-lt overflow-hidden">
          <div
            className="h-full rounded-full bg-teal transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {editing && (
        <SprintFormModal
          sprint={{
            id: sprint.id,
            name: sprint.name,
            goal: sprint.goal,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
