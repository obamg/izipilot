// lib/access/import.ts
import { createHash } from "node:crypto";

export interface SeedCsvRow {
  utilisateur: string;
  nomComplet: string;
  departement: string;
  logiciel: string;
  niveauAcces: string;
}

export interface BaselineCsvRow {
  userId: string;
  assetId: string;
  accessLevelId: string;
  sourceUtilisateur: string | null;
  sourceNomComplet: string | null;
  sourceDepartement: string | null;
  sourceLogiciel: string | null;
  sourceNiveauAcces: string | null;
  sourceRow: string | null;
}

export interface SeedPair {
  logiciel: string;
  niveauAcces: string;
}

export type IntraFileStatus = "UNIQUE" | "DUPLICATE" | "INTERNAL_CONFLICT";

export class CsvParseError extends Error {}

const SEED_HEADER = "utilisateur;nom_complet;departement;logiciel;niveau_acces";

function splitLines(content: string): string[] {
  return content.split(/\r\n|\n/).filter((l) => l.length > 0);
}

/**
 * CSV brut à 5 colonnes (spec §11 / phase 2 §3) — format simple, sans champ
 * entre guillemets observé dans l'échantillon réel ; un split naïf suffit.
 */
export function parseSeedCsv(content: string): SeedCsvRow[] {
  const lines = splitLines(content);
  if (lines.length === 0) throw new CsvParseError("Fichier vide");
  const [header, ...dataLines] = lines;
  if (header.trim() !== SEED_HEADER) {
    throw new CsvParseError(`En-tête invalide : attendu "${SEED_HEADER}"`);
  }
  return dataLines.map((line, i) => {
    const cols = line.split(";");
    if (cols.length !== 5) {
      throw new CsvParseError(`Ligne ${i + 2} : attendu 5 colonnes, ${cols.length} trouvée(s)`);
    }
    const [utilisateur, nomComplet, departement, logiciel, niveauAcces] = cols.map((c) => c.trim());
    return { utilisateur, nomComplet, departement, logiciel, niveauAcces };
  });
}

export function extractDistinctPairs(rows: SeedCsvRow[]): SeedPair[] {
  const seen = new Map<string, SeedPair>();
  for (const row of rows) {
    const key = `${row.logiciel}\u0000${row.niveauAcces}`;
    if (!seen.has(key)) {
      seen.set(key, { logiciel: row.logiciel, niveauAcces: row.niveauAcces });
    }
  }
  return [...seen.values()];
}

const BASELINE_REQUIRED_HEADER = ["user_id", "asset_id", "access_level_id"];
const BASELINE_OPTIONAL_COLUMNS = [
  "source_utilisateur",
  "source_nom_complet",
  "source_departement",
  "source_logiciel",
  "source_niveau_acces",
  "source_row",
];

/**
 * CSV normalisé préparé séparément (spec §5) — 3 colonnes obligatoires
 * (identifiants stables), colonnes de provenance optionnelles.
 */
export function parseBaselineCsv(content: string): BaselineCsvRow[] {
  const lines = splitLines(content);
  if (lines.length === 0) throw new CsvParseError("Fichier vide");
  const [headerLine, ...dataLines] = lines;
  const columns = headerLine.trim().split(";");
  if (columns.slice(0, 3).join(";") !== BASELINE_REQUIRED_HEADER.join(";")) {
    throw new CsvParseError(
      `En-tête invalide : les 3 premières colonnes doivent être "${BASELINE_REQUIRED_HEADER.join(";")}"`
    );
  }
  for (const col of columns.slice(3)) {
    if (!BASELINE_OPTIONAL_COLUMNS.includes(col)) {
      throw new CsvParseError(`Colonne de provenance inconnue : "${col}"`);
    }
  }

  return dataLines.map((line, i) => {
    const cols = line.split(";").map((c) => c.trim());
    if (cols.length !== columns.length) {
      throw new CsvParseError(
        `Ligne ${i + 2} : attendu ${columns.length} colonne(s), ${cols.length} trouvée(s)`
      );
    }
    const byColumn = new Map(columns.map((name, idx) => [name, cols[idx]]));
    const userId = byColumn.get("user_id") ?? "";
    const assetId = byColumn.get("asset_id") ?? "";
    const accessLevelId = byColumn.get("access_level_id") ?? "";
    if (!userId || !assetId || !accessLevelId) {
      throw new CsvParseError(
        `Ligne ${i + 2} : user_id, asset_id et access_level_id sont obligatoires`
      );
    }
    return {
      userId,
      assetId,
      accessLevelId,
      sourceUtilisateur: byColumn.get("source_utilisateur") || null,
      sourceNomComplet: byColumn.get("source_nom_complet") || null,
      sourceDepartement: byColumn.get("source_departement") || null,
      sourceLogiciel: byColumn.get("source_logiciel") || null,
      sourceNiveauAcces: byColumn.get("source_niveau_acces") || null,
      sourceRow: byColumn.get("source_row") || null,
    };
  });
}

/**
 * Classe chaque ligne d'un fichier baseline SANS toucher la base : détecte
 * les doublons exacts et les incohérences internes au fichier (même
 * (user_id, asset_id) avec des access_level_id différents). Deux passes :
 * la première construit, par paire (user_id, asset_id), l'ensemble des
 * access_level_id distincts rencontrés — une paire à plusieurs niveaux
 * distincts marque TOUTES ses lignes INTERNAL_CONFLICT (y compris la
 * première lue), pas seulement celles qui arrivent après coup.
 */
export function classifyBaselineRows(rows: BaselineCsvRow[]): IntraFileStatus[] {
  const levelsByPair = new Map<string, Set<string>>();
  for (const row of rows) {
    const pairKey = `${row.userId}\u0000${row.assetId}`;
    const levels = levelsByPair.get(pairKey) ?? new Set<string>();
    levels.add(row.accessLevelId);
    levelsByPair.set(pairKey, levels);
  }

  const seenPair = new Set<string>();
  return rows.map((row) => {
    const pairKey = `${row.userId}\u0000${row.assetId}`;
    const levels = levelsByPair.get(pairKey);
    if (levels && levels.size > 1) return "INTERNAL_CONFLICT";
    if (seenPair.has(pairKey)) return "DUPLICATE";
    seenPair.add(pairKey);
    return "UNIQUE";
  });
}

export function computeFileHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
