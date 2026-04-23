import type { ActionPriority } from "@prisma/client";

const PRIORITY_CONFIG: Record<
  ActionPriority,
  { bg: string; text: string; label: string }
> = {
  LOW: { bg: "#f2f6f7", text: "#5f6e7a", label: "Basse" },
  MEDIUM: { bg: "#e0f0ff", text: "#185FA5", label: "Moyenne" },
  HIGH: { bg: "#fffbe6", text: "#f4a900", label: "Haute" },
  URGENT: { bg: "#fceaea", text: "#e23c4a", label: "Urgente" },
};

interface ActionPriorityBadgeProps {
  priority: ActionPriority;
  className?: string;
}

export function ActionPriorityBadge({ priority, className = "" }: ActionPriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}
