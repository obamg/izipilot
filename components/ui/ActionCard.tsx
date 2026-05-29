"use client";

import type { ActionStatus, ActionPriority } from "@prisma/client";
import { ActionStatusBadge } from "./ActionStatusBadge";
import { ActionPriorityBadge } from "./ActionPriorityBadge";

const PRIORITY_ACCENT: Record<ActionPriority, string> = {
  LOW: "#b3e0e0",
  MEDIUM: "#185FA5",
  HIGH: "#f4a900",
  URGENT: "#e23c4a",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function formatDue(iso: string): { label: string; relative: string | null; overdue: boolean } {
  const d = new Date(iso);
  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  let relative: string | null = null;
  if (diff < 0) relative = `${Math.abs(diff)}j de retard`;
  else if (diff === 0) relative = "aujourd'hui";
  else if (diff === 1) relative = "demain";
  else if (diff <= 7) relative = `dans ${diff}j`;
  return { label, relative, overdue: diff < 0 };
}

export interface ActionCardProps {
  id: string;
  title: string;
  description?: string | null;
  context?: string | null;
  assigneeName: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
  onClick?: (id: string) => void;
}

export function ActionCard({
  id,
  title,
  description,
  context,
  assigneeName,
  status,
  priority,
  dueDate,
  onClick,
}: ActionCardProps) {
  const isClosed = status === "DONE" || status === "CANCELLED";
  const due = dueDate ? formatDue(dueDate) : null;
  const isOverdue = !!due?.overdue && !isClosed;
  const accent = status === "BLOCKED" ? "#e23c4a" : PRIORITY_ACCENT[priority];
  const interactive = !!onClick;

  return (
    <div
      onClick={interactive ? () => onClick(id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(id);
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`group relative overflow-hidden rounded-2xl border bg-white p-4 transition-all ${
        isOverdue ? "border-[var(--red-lt)]" : "border-[#deeaea]"
      } ${
        interactive
          ? "cursor-pointer hover:border-teal-md hover:shadow-[0_6px_20px_-10px_rgba(28,58,74,0.22)] focus:outline-none focus-visible:border-teal focus-visible:shadow-[0_6px_20px_-10px_rgba(28,58,74,0.22)]"
          : ""
      } ${isClosed ? "opacity-60" : ""}`}
    >
      <span
        aria-hidden
        className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-start justify-between gap-2 pl-1.5">
        <ActionStatusBadge status={status} />
        <ActionPriorityBadge priority={priority} />
      </div>

      <h3
        className={`mt-2.5 pl-1.5 text-[13px] font-semibold leading-snug text-dark ${
          isClosed ? "line-through" : ""
        }`}
      >
        {title}
      </h3>

      {description && (
        <p className="mt-1 pl-1.5 text-[11px] leading-relaxed text-izi-gray line-clamp-2">
          {description}
        </p>
      )}

      {context && (
        <p className="mt-1.5 pl-1.5 text-[10px] font-medium text-teal-dk truncate">
          {context}
        </p>
      )}

      <div className="mt-3 pt-3 pl-1.5 flex items-center justify-between gap-2 border-t border-[#eef3f4]">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-lt text-[10px] font-semibold text-teal-dk"
          >
            {initials(assigneeName)}
          </span>
          <span className="truncate text-[11px] font-medium text-dark">
            {assigneeName}
          </span>
        </div>

        {due && (
          <div
            className={`flex shrink-0 items-center gap-1 text-[10px] ${
              isOverdue ? "text-[var(--red)] font-semibold" : "text-izi-gray"
            }`}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="font-mono">{due.label}</span>
            {due.relative && <span>· {due.relative}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
