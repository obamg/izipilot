import type { SprintStatus } from "@prisma/client";

const SPRINT_STATUS_CONFIG: Record<
  SprintStatus,
  { bg: string; text: string; label: string }
> = {
  PLANNED: { bg: "#f2f6f7", text: "#5f6e7a", label: "Planifié" },
  ACTIVE: { bg: "#e1f5ee", text: "#1d9e75", label: "En cours" },
  COMPLETED: { bg: "#e0f0ff", text: "#185FA5", label: "Clôturé" },
  CANCELLED: { bg: "#f2f6f7", text: "#8a9aa5", label: "Annulé" },
};

interface SprintStatusBadgeProps {
  status: SprintStatus;
  className?: string;
}

export function SprintStatusBadge({ status, className = "" }: SprintStatusBadgeProps) {
  const config = SPRINT_STATUS_CONFIG[status];
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
