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
  { bg: string; iconBg: string }
> = {
  CRITICAL: { bg: "var(--red-lt)", iconBg: "var(--red)" },
  HIGH: { bg: "var(--red-lt)", iconBg: "var(--red)" },
  MEDIUM: { bg: "var(--gold-lt)", iconBg: "var(--gold)" },
  LOW: { bg: "var(--gray-lt)", iconBg: "var(--gray)" },
};

function SeverityGlyph({ severity }: { severity: AlertSeverity }) {
  // White-on-color glyph rendered inside the iconBg chip.
  if (severity === "CRITICAL" || severity === "HIGH") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (severity === "MEDIUM") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="white" className="w-2.5 h-2.5" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}

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
        className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0"
        style={{ backgroundColor: config.iconBg }}
      >
        <SeverityGlyph severity={severity} />
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
