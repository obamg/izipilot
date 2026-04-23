"use client";

import type { ActionStatus, ActionPriority } from "@prisma/client";
import { ActionStatusBadge } from "./ActionStatusBadge";
import { ActionPriorityBadge } from "./ActionPriorityBadge";

interface ActionCardProps {
  id: string;
  title: string;
  assigneeName: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
  commentCount: number;
  onStatusChange?: (id: string, status: ActionStatus) => void;
  onClick?: (id: string) => void;
}

const STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "TODO", label: "À faire" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "BLOCKED", label: "Bloquée" },
  { value: "DONE", label: "Terminée" },
  { value: "CANCELLED", label: "Annulée" },
];

export function ActionCard({
  id,
  title,
  assigneeName,
  status,
  priority,
  dueDate,
  commentCount,
  onStatusChange,
  onClick,
}: ActionCardProps) {
  const isOverdue = dueDate && new Date(dueDate) < new Date() && status !== "DONE" && status !== "CANCELLED";

  return (
    <div
      className="flex items-center gap-3 rounded-[10px] border border-[#deeaea] bg-white px-3 py-2.5 cursor-pointer hover:border-teal-md transition-colors"
      onClick={() => onClick?.(id)}
    >
      {/* Status quick-change */}
      <select
        value={status}
        onChange={(e) => {
          e.stopPropagation();
          onStatusChange?.(id, e.target.value as ActionStatus);
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-6 w-6 appearance-none rounded-full border-2 cursor-pointer shrink-0"
        style={{
          borderColor: status === "DONE" ? "var(--green)" : status === "BLOCKED" ? "var(--red)" : "var(--gray)",
          backgroundColor: status === "DONE" ? "var(--green)" : "transparent",
        }}
        aria-label={`Statut de l'action: ${status}`}
        title="Changer le statut"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-[11px] font-semibold ${status === "DONE" ? "line-through text-izi-gray" : "text-dark"}`}>
          {title}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-izi-gray">{assigneeName}</span>
          {dueDate && (
            <span className={`text-[10px] font-mono ${isOverdue ? "text-[var(--red)] font-semibold" : "text-izi-gray"}`}>
              {new Date(dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
          )}
          {commentCount > 0 && (
            <span className="text-[10px] text-izi-gray">{commentCount} com.</span>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1 shrink-0">
        <ActionPriorityBadge priority={priority} />
        <ActionStatusBadge status={status} />
      </div>
    </div>
  );
}
