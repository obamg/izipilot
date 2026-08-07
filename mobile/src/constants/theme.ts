// IziPilot design system — mirrors the web CSS variables (CLAUDE.md).
// Statuts OKR immuables : vert ≥70, gold 40–69, rouge <40, gris non démarré.

export const colors = {
  teal: "#008081",
  tealDk: "#005f60",
  tealLt: "#e6f7f7",
  tealMd: "#b3e0e0",
  dark: "#1c3a4a",
  darkMd: "#2e3e4b",
  red: "#e23c4a",
  redLt: "#fceaea",
  gold: "#f4a900",
  goldLt: "#fffbe6",
  green: "#1d9e75",
  greenLt: "#e1f5ee",
  gray: "#5f6e7a",
  grayLt: "#f2f6f7",
  borderSoft: "#deeaea",
  white: "#ffffff",
  // Sidebar/nav active tint on dark
  tealOnDark: "#7dd8d8",
} as const;

export const fonts = {
  serif: "DMSerifDisplay_400Regular",
  sans: "DMSans_400Regular",
  sansMedium: "DMSans_500Medium",
  sansSemiBold: "DMSans_600SemiBold",
  sansLight: "DMSans_300Light",
  mono: "DMMono_400Regular",
  monoMedium: "DMMono_500Medium",
} as const;

export function statusColor(status: string, scorePercent?: number): string {
  if (status === "NOT_STARTED") return colors.gray;
  if (typeof scorePercent === "number") {
    if (scorePercent >= 70) return colors.green;
    if (scorePercent >= 40) return colors.gold;
    return colors.red;
  }
  if (status === "ON_TRACK") return colors.green;
  if (status === "AT_RISK") return colors.gold;
  if (status === "BLOCKED") return colors.red;
  return colors.gray;
}

export const STATUS_LABELS: Record<string, string> = {
  ON_TRACK: "En bonne voie",
  AT_RISK: "Attention",
  BLOCKED: "Bloqué",
  NOT_STARTED: "Non démarré",
};
