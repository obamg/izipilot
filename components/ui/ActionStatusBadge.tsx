import type { ActionStatus } from "@prisma/client";

const ACTION_STATUS_CONFIG: Record<
  ActionStatus,
  { bg: string; text: string; label: string }
> = {
  TODO: { bg: "#f2f6f7", text: "#5f6e7a", label: "À faire" },
  IN_PROGRESS: { bg: "#e0f0ff", text: "#185FA5", label: "En cours" },
  BLOCKED: { bg: "#fceaea", text: "#e23c4a", label: "Bloquée" },
  DONE: { bg: "#e1f5ee", text: "#1d9e75", label: "Terminée" },
  CANCELLED: { bg: "#f2f6f7", text: "#8a9aa5", label: "Annulée" },
};

interface ActionStatusBadgeProps {
  status: ActionStatus;
  className?: string;
}

export function ActionStatusBadge({ status, className = "" }: ActionStatusBadgeProps) {
  const config = ACTION_STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ backgroundColor: config.text }}
      />
      {config.label}
    </span>
  );
}
