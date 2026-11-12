/**
 * Version « texte » d'une couleur de statut.
 *
 * Les teintes vives (--green, --gold, --red) sont faites pour les pastilles,
 * barres et donuts ; écrites en texte sur fond clair elles passent sous le
 * seuil WCAG AA (vert 3,4:1, or 2,0:1, rouge 4,2:1). Les variantes -dk
 * (globals.css) atteignent 4,5:1+. Toute autre couleur est renvoyée telle
 * quelle, donc on peut envelopper n'importe quel `style={{ color }}`.
 */
const TEXT_TONE: Record<string, string> = {
  "var(--green)": "var(--green-dk)",
  "var(--gold)": "var(--gold-dk)",
  "var(--red)": "var(--red-dk)",
  "#1d9e75": "var(--green-dk)",
  "#f4a900": "var(--gold-dk)",
  "#e23c4a": "var(--red-dk)",
};

export function textTone<T extends string | undefined>(color: T): T {
  if (color === undefined) return color;
  return (TEXT_TONE[color.toLowerCase()] ?? color) as T;
}
