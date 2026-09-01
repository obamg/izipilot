"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { ActionPriorityBadge } from "@/components/ui/ActionPriorityBadge";
import type { SprintTaskItem } from "./types";

interface BacklogPanelProps {
  /** Déjà filtrées par l'appelant. */
  tasks: SprintTaskItem[];
  /** Taille du backlog avant filtrage — sert à distinguer « vide » de « masqué ». */
  totalCount?: number;
  targetSprintId: string;
  targetSprintName: string;
  currentUserRole: UserRole;
  onEdit?: (task: SprintTaskItem) => void;
  onCreate?: () => void;
}

export function BacklogPanel({
  tasks,
  totalCount,
  targetSprintId,
  targetSprintName,
  currentUserRole,
  onEdit,
  onCreate,
}: BacklogPanelProps) {
  const router = useRouter();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage =
    currentUserRole === "CEO" ||
    currentUserRole === "MANAGEMENT" ||
    currentUserRole === "PO";

  const total = totalCount ?? tasks.length;
  const hidden = total - tasks.length;

  async function addToSprint(taskId: string) {
    setError(null);
    setMovingId(taskId);
    try {
      const res = await fetch(`/api/sprint-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId: targetSprintId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Échec du déplacement");
        return;
      }
      router.refresh();
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] text-izi-gray">
          {hidden > 0 ? (
            <>
              Backlog — {tasks.length} tâche{tasks.length > 1 ? "s" : ""} sur {total}
            </>
          ) : (
            <>
              Backlog — {total} tâche{total > 1 ? "s" : ""} non planifiée
              {total > 1 ? "s" : ""}
            </>
          )}
        </p>
        {canManage && onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="text-[12px] font-medium text-teal hover:text-teal-dk"
          >
            + Nouvelle tâche
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
          {error}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border-soft p-8 text-center text-[13px] text-izi-gray">
          {hidden > 0
            ? "Aucune tâche du backlog ne correspond aux filtres."
            : "Le backlog est vide."}
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-[8px] border border-border-soft bg-white p-2.5"
            >
              <button
                type="button"
                onClick={() => onEdit?.(task)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {task.team && (
                    <span
                      className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ color: task.team.color, backgroundColor: `${task.team.color}1a` }}
                    >
                      {task.team.code}
                    </span>
                  )}
                  <span className="text-[13px] font-medium text-dark truncate">{task.title}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-izi-gray">
                  <ActionPriorityBadge priority={task.priority} />
                  <span>{task.assigneeName ?? "Non assignée"}</span>
                  {task.storyPoints != null && (
                    <span className="font-mono text-teal">{task.storyPoints} pts</span>
                  )}
                </div>
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={() => addToSprint(task.id)}
                  disabled={movingId === task.id}
                  className="shrink-0 rounded-[7px] border border-teal-md bg-teal-lt px-2.5 py-1.5 text-[11px] font-medium text-teal-dk hover:bg-teal-md/40 transition-colors disabled:opacity-50"
                  title={`Ajouter à ${targetSprintName}`}
                >
                  {movingId === task.id ? "…" : "→ Sprint"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
