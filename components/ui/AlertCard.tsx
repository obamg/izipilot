"use client";

import type { AlertSeverity } from "@prisma/client";

interface AlertCardProps {
  id: string;
  title: string;
  subtitle: string;
  severity: AlertSeverity;
  actionLabel?: string;
  onAction?: (id: string) => void;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { bg: string; iconBg: string; emoji: string }
> = {
  CRITICAL: { bg: "var(--red-lt)", iconBg: "var(--red)", emoji: "\uD83D\uDD34" },
  HIGH: { bg: "var(--red-lt)", iconBg: "var(--red)", emoji: "\uD83D\uDD34" },
  MEDIUM: { bg: "var(--gold-lt)", iconBg: "var(--gold)", emoji: "\uD83D\uDFE1" },
  LOW: { bg: "var(--gray-lt)", iconBg: "var(--gray)", emoji: "\u26AA" },
};

export function AlertCard({
  id,
  title,
  subtitle,
  severity,
  actionLabel = "Voir",
  onAction,
}: AlertCardProps) {
  const config = SEVERITY_CONFIG[severity];

  return (
    <div
      className="flex items-start gap-[9px] rounded-lg p-[9px] mb-[5px] last:mb-0"
      style={{ backgroundColor: config.bg }}
    >
      <div
        className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0 text-xs"
        style={{ backgroundColor: config.iconBg }}
      >
        <span>{config.emoji}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-dark">{title}</div>
        <div className="text-[10px] text-izi-gray mt-px">{subtitle}</div>
      </div>
      {onAction && (
        <button
          onClick={() => onAction(id)}
          className="text-[10px] font-semibold text-teal border border-teal-md bg-transparent px-[9px] py-[3px] rounded-[5px] cursor-pointer font-sans self-center shrink-0 hover:bg-teal-lt transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
