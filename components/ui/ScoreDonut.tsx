"use client";

interface ScoreDonutProps {
  score: number; // 0-100
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "var(--green)";
  if (score >= 40) return "var(--gold)";
  return "var(--red)";
}

export function ScoreDonut({
  score,
  size = 38,
  strokeWidth = 3.5,
  className = "",
}: ScoreDonutProps) {
  const rounded = Math.round(score);
  const color = getScoreColor(rounded);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (rounded / 100) * circumference;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--gray-lt)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span
        className="absolute font-mono text-[10px] font-semibold"
        style={{ color }}
      >
        {rounded}%
      </span>
    </div>
  );
}

/** Filled circle version (like in the design reference form section) */
export function ScoreDonutFilled({
  score,
  size = 38,
  className = "",
}: Omit<ScoreDonutProps, "strokeWidth">) {
  const rounded = Math.round(score);
  const color = getScoreColor(rounded);

  return (
    <div
      className={`flex items-center justify-center rounded-full shrink-0 font-mono text-xs font-semibold text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color }}
    >
      {rounded}%
    </div>
  );
}
