import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSeedCsv,
  parseBaselineCsv,
  extractDistinctPairs,
  classifyBaselineRows,
  computeFileHash,
  CsvParseError,
} from "@/lib/access/import";

const REAL_SEED_CSV = readFileSync(
  join(process.cwd(), "tests/fixtures/access/registre_acces_2026-08-27.csv"),
  "utf8"
);

describe("parseSeedCsv", () => {
  it("parse le fichier réel avec les bons comptes", () => {
    const rows = parseSeedCsv(REAL_SEED_CSV);
    expect(rows).toHaveLength(476);
    expect(new Set(rows.map((r) => r.utilisateur)).size).toBe(49);
    expect(new Set(rows.map((r) => r.logiciel)).size).toBe(101);
  });

  it("conserve la chaîne littérale NULL du département sans l'interpréter", () => {
    const rows = parseSeedCsv(REAL_SEED_CSV);
    const withNullDept = rows.filter((r) => r.departement === "NULL");
    expect(withNullDept).toHaveLength(7);
  });

  it("rejette un en-tête invalide", () => {
    const bad = "a;b;c;d;e\nx;y;z;w;v";
    expect(() => parseSeedCsv(bad)).toThrow(CsvParseError);
  });

  it("rejette une ligne avec un nombre de colonnes incorrect", () => {
    const bad = "utilisateur;nom_complet;departement;logiciel;niveau_acces\na;b;c;d";
    expect(() => parseSeedCsv(bad)).toThrow(CsvParseError);
  });

  it("trim les champs", () => {
    const content =
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\n a.b ; A B ; D ; Logiciel ; Niveau ";
    const rows = parseSeedCsv(content);
    expect(rows[0]).toEqual({
      utilisateur: "a.b",
      nomComplet: "A B",
      departement: "D",
      logiciel: "Logiciel",
      niveauAcces: "Niveau",
    });
  });
});

describe("extractDistinctPairs", () => {
  it("extrait 186 paires distinctes du fichier réel", () => {
    const rows = parseSeedCsv(REAL_SEED_CSV);
    const pairs = extractDistinctPairs(rows);
    expect(pairs).toHaveLength(186);
  });

  it("dédoublonne logiciel+niveau, ignore utilisateur/département", () => {
    const rows = parseSeedCsv(
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\n" +
        "u1;U1;D1;LOG;NIV\n" +
        "u2;U2;D2;LOG;NIV\n" +
        "u3;U3;NULL;LOG;NIV2\n"
    );
    expect(extractDistinctPairs(rows)).toEqual([
      { logiciel: "LOG", niveauAcces: "NIV" },
      { logiciel: "LOG", niveauAcces: "NIV2" },
    ]);
  });
});

describe("parseBaselineCsv", () => {
  const HEADER = "user_id;asset_id;access_level_id";

  it("parse les 3 colonnes obligatoires", () => {
    const rows = parseBaselineCsv(`${HEADER}\nu1;a1;l1\nu2;a2;l2`);
    expect(rows).toEqual([
      {
        userId: "u1", assetId: "a1", accessLevelId: "l1",
        sourceUtilisateur: null, sourceNomComplet: null, sourceDepartement: null,
        sourceLogiciel: null, sourceNiveauAcces: null, sourceRow: null,
      },
      {
        userId: "u2", assetId: "a2", accessLevelId: "l2",
        sourceUtilisateur: null, sourceNomComplet: null, sourceDepartement: null,
        sourceLogiciel: null, sourceNiveauAcces: null, sourceRow: null,
      },
    ]);
  });

  it("parse les colonnes de provenance optionnelles quand présentes", () => {
    const rows = parseBaselineCsv(
      `${HEADER};source_utilisateur;source_row\nu1;a1;l1;abdoul.soumanou;3`
    );
    expect(rows[0].sourceUtilisateur).toBe("abdoul.soumanou");
    expect(rows[0].sourceRow).toBe("3");
    expect(rows[0].sourceNomComplet).toBeNull();
  });

  it("rejette un en-tête dont les 3 premières colonnes ne sont pas user_id;asset_id;access_level_id", () => {
    expect(() => parseBaselineCsv("a;b;c\nx;y;z")).toThrow(CsvParseError);
  });

  it("rejette une colonne de provenance inconnue", () => {
    expect(() => parseBaselineCsv(`${HEADER};colonne_inconnue\nu1;a1;l1;x`)).toThrow(CsvParseError);
  });

  it("rejette une ligne où user_id, asset_id ou access_level_id est vide", () => {
    expect(() => parseBaselineCsv(`${HEADER}\n;a1;l1`)).toThrow(CsvParseError);
  });
});

describe("classifyBaselineRows", () => {
  it("marque UNIQUE une ligne qui n'apparaît qu'une fois", () => {
    const rows = parseBaselineCsv("user_id;asset_id;access_level_id\nu1;a1;l1");
    expect(classifyBaselineRows(rows)).toEqual(["UNIQUE"]);
  });

  it("marque DUPLICATE la répétition exacte d'une ligne déjà vue", () => {
    const rows = parseBaselineCsv(
      "user_id;asset_id;access_level_id\nu1;a1;l1\nu1;a1;l1"
    );
    expect(classifyBaselineRows(rows)).toEqual(["UNIQUE", "DUPLICATE"]);
  });

  it("marque INTERNAL_CONFLICT les DEUX lignes quand le même (user,asset) porte des niveaux différents", () => {
    const rows = parseBaselineCsv(
      "user_id;asset_id;access_level_id\nu1;a1;l1\nu1;a1;l2"
    );
    expect(classifyBaselineRows(rows)).toEqual(["INTERNAL_CONFLICT", "INTERNAL_CONFLICT"]);
  });

  it("une ligne DUPLICATE ne compte pas comme UNIQUE pour un (user,asset) déjà vu avec un niveau différent ensuite", () => {
    // 3 lignes : u1/a1/l1, un doublon exact de la première, puis u1/a1/l2
    // (conflit). Les 3 lignes portent la même paire (user,asset) → les 3
    // sont INTERNAL_CONFLICT dès qu'un niveau distinct apparaît dans le
    // fichier pour cette paire, quel que soit l'ordre de lecture.
    const rows = parseBaselineCsv(
      "user_id;asset_id;access_level_id\nu1;a1;l1\nu1;a1;l1\nu1;a1;l2"
    );
    expect(classifyBaselineRows(rows)).toEqual([
      "INTERNAL_CONFLICT",
      "INTERNAL_CONFLICT",
      "INTERNAL_CONFLICT",
    ]);
  });
});

describe("computeFileHash", () => {
  it("est déterministe et sensible au contenu", () => {
    const h1 = computeFileHash("abc");
    const h2 = computeFileHash("abc");
    const h3 = computeFileHash("abd");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
