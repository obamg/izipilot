/**
 * Shared ISO 8601 week utilities.
 * Single source of truth — do NOT duplicate week calculations elsewhere.
 */

/**
 * Get the ISO 8601 week number and year for a given date.
 * The ISO week year may differ from the calendar year at year boundaries.
 */
export function getISOWeek(date: Date): { weekNumber: number; year: number } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday in current week determines the ISO year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNumber =
    1 +
    Math.round(
      ((d.getTime() - yearStart.getTime()) / 86400000 -
        3 +
        ((yearStart.getDay() + 6) % 7)) /
        7
    );
  return { weekNumber, year: d.getFullYear() };
}

/**
 * Get the Monday (start) of a given ISO week.
 */
export function getISOWeekStart(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Monday=1
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
