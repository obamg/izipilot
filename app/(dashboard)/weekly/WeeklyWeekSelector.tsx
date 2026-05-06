"use client";

import { useRouter } from "next/navigation";

interface Props {
  weekNumber: number;
  year: number;
  currentWeek: number;
  currentYear: number;
}

export function WeeklyWeekSelector({
  weekNumber,
  year,
  currentWeek,
  currentYear,
}: Props) {
  const router = useRouter();
  const isCurrentWeek = weekNumber === currentWeek && year === currentYear;

  function navigateToWeek(w: number, y: number) {
    if (w === currentWeek && y === currentYear) {
      router.push("/weekly");
    } else {
      router.push(`/weekly?week=${w}&year=${y}`);
    }
  }

  function handlePrev() {
    if (weekNumber === 1) navigateToWeek(52, year - 1);
    else navigateToWeek(weekNumber - 1, year);
  }

  function handleNext() {
    if (isCurrentWeek) return;
    if (weekNumber === 52) navigateToWeek(1, year + 1);
    else navigateToWeek(weekNumber + 1, year);
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={handlePrev}
        className="w-7 h-7 flex items-center justify-center rounded-md text-izi-gray hover:bg-izi-gray-lt hover:text-dark transition-colors cursor-pointer"
        aria-label="Semaine pr\u00e9c\u00e9dente"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="font-mono text-sm text-dark-md px-2 font-medium">
        S{String(weekNumber).padStart(2, "0")} &middot; {year}
      </span>
      <button
        onClick={handleNext}
        disabled={isCurrentWeek}
        className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
          isCurrentWeek
            ? "text-izi-gray/30 cursor-not-allowed"
            : "text-izi-gray hover:bg-izi-gray-lt hover:text-dark"
        }`}
        aria-label="Semaine suivante"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </button>
      {!isCurrentWeek && (
        <button
          onClick={() => navigateToWeek(currentWeek, currentYear)}
          className="ml-2 text-xs text-teal hover:text-teal-dk font-medium cursor-pointer"
        >
          Cette semaine
        </button>
      )}
    </div>
  );
}
