interface KrProgressBarProps {
  score: number; // 0-100
  delta?: number; // vs previous week
  label?: string;
  showScore?: boolean;
  className?: string;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "var(--green)";
  if (score >= 40) return "var(--gold)";
  return "var(--red)";
}

export function KrProgressBar({
  score,
  delta,
  label,
  showScore = true,
  className = "",
}: KrProgressBarProps) {
  const rounded = Math.round(score);
  const color = getScoreColor(rounded);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && (
        <span className="text-[10px] text-dark-md flex-1 min-w-0 truncate">
          {label}
        </span>
      )}
      <div className="w-[70px] h-1 bg-izi-gray-lt rounded-sm overflow-hidden shrink-0">
        <div
          className="h-1 rounded-sm transition-all duration-300"
          style={{ backgroundColor: color, width: `${Math.min(rounded, 100)}%` }}
        />
      </div>
      {showScore && (
        <span
          className="font-mono text-[10px] font-semibold min-w-[28px] text-right shrink-0"
          style={{ color }}
        >
          {rounded}%
        </span>
      )}
      {delta !== undefined && delta !== 0 && (
        <span
          className={`text-[9px] font-medium shrink-0 ${
            delta > 0 ? "text-izi-green" : "text-izi-red"
          }`}
        >
          {delta > 0 ? "+" : ""}
          {Math.round(delta)}
        </span>
      )}
    </div>
  );
}
