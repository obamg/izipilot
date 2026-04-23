import type { KrStatus } from "@prisma/client";
import { STATUS_COLORS } from "@/constants/izichange";

interface StatusBadgeProps {
  status: KrStatus;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = STATUS_COLORS[status];

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
