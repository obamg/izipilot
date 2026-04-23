"use client";

interface WeekSelectorProps {
  weekNumber: number;
  year: number;
  onChange: (week: number, year: number) => void;
}

export function WeekSelector({ weekNumber, year, onChange }: WeekSelectorProps) {
  function handlePrev() {
    if (weekNumber === 1) {
      onChange(52, year - 1);
    } else {
      onChange(weekNumber - 1, year);
    }
  }

  function handleNext() {
    if (weekNumber === 52) {
      onChange(1, year + 1);
    } else {
      onChange(weekNumber + 1, year);
    }
  }

  return (
    <div className="inline-flex items-center gap-1 bg-white/[0.06] rounded-xl px-1">
      <button
        onClick={handlePrev}
        className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
        aria-label="Semaine precedente"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="font-mono text-[11px] text-white/40 px-2 py-1">
        S{String(weekNumber).padStart(2, "0")} &middot; {year}
      </span>
      <button
        onClick={handleNext}
        className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
        aria-label="Semaine suivante"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </button>
    </div>
  );
}
