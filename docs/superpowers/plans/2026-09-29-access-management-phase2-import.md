# Gestion des accès — Phase 2 : import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'Asset Administrator deux outils indépendants pour amorcer le registre d'accès vide (livré en phase 1) à partir de données réelles : un import de catalogue depuis le CSV brut historique, et un chargement de base d'affectations depuis un fichier normalisé préparé séparément.

**Architecture:** Deux nouveaux modèles Prisma (`ImportBatch`, `ImportRow`) enregistrent chaque tentative d'import, commitée ou bloquée. Des fonctions pures (`lib/access/import.ts`) parsent le CSV et détectent les incohérences intra-fichier sans toucher la base ; des fonctions Prisma (`lib/access/import-server.ts`) résolvent chaque ligne contre l'état réel et appliquent le commit. La même fonction de résolution sert à la fois pour la prévisualisation et pour le commit, qui revalide toujours tout depuis zéro — jamais de confiance dans un résultat périmé.

**Tech Stack:** Next.js 15 App Router, Prisma, PostgreSQL, Vitest, TypeScript strict. Aucune nouvelle dépendance npm (parsing CSV fait à la main — format simple, sans champs entre guillemets).

**Spec:** `docs/superpowers/specs/2026-09-29-access-management-phase2-import-design.md` (et la phase 1 : `docs/superpowers/specs/2026-09-28-access-management-phase1-design.md`)

## Global Constraints

- Import strictement additif : ne jamais modifier une `AccessAssignment` dont `source: "REQUEST"`, ne jamais réactiver un `status: "REVOKED"`, ne jamais révoquer une affectation absente du fichier importé.
- `orgId` vient toujours de la session (`requireAssetAdministrator()`), jamais d'un champ envoyé par le client.
- Commit du mode baseline tout-ou-rien : le lot ne se commite que si zéro ligne a l'issue `UNRESOLVED` ou `CONFLICT`. Aucun commit partiel, aucun filtre ligne par ligne au commit.
- Le commit **revalide entièrement** contre l'état actuel de la base (jamais seulement contre les lignes stockées à la prévisualisation) — c'est la seule réponse à « stale previews block the whole commit », pas un jeton de version séparé.
- Aucune réconciliation d'identité, aucun écran de correspondance utilisateur — spec : « do not build a mapping screen ».
- Réservé à l'Asset Administrator effectif (`requireAssetAdministrator`, `lib/access/asset-admin-guard.ts`) — aucun nouveau rôle du module.
- `tests/fixtures/access/registre_acces_2026-08-27.csv` ne doit jamais être modifié une fois créé (Tâche 2) — spec : « keep the supplied sample unchanged ».
- Les colonnes `source_*`/`departement` du fichier baseline sont de la provenance affichée uniquement, jamais écrites dans `Department`/`DepartmentMember`.
- TypeScript strict, Zod aux frontières API qui en ont besoin, `Math.round()` sur tout score affiché (aucun de cette phase n'affiche de score, mais la règle reste globale au projet), dates sérialisées en ISO string avant de traverser la frontière Server → Client Component (même convention que la phase 1, ex. `app/(dashboard)/access/assets/page.tsx`).

## Review Focus

- **Département source valant littéralement la chaîne `"NULL"`** (texte à 4 caractères présent dans le fichier réel, pas une valeur SQL nulle) — un import naïf pourrait le confondre avec un département réel nommé « NULL » ; une personne raisonnable attend qu'il reste une chaîne de provenance opaque, jamais interprétée.
- **Deux lignes différentes du même fichier baseline désignent le même `(user_id, asset_id)` avec des `access_level_id` différents** — une personne raisonnable attend que ce soit détecté et bloque tout le lot, pas que la dernière ligne lue gagne silencieusement.
- **Ré-upload d'un fichier déjà commité avec succès** — une personne raisonnable attend un no-op complet (aucune deuxième `AccessAssignment` créée), pas un doublon silencieux à chaque nouvel essai du même fichier.
- **Un `access_level_id` qui existe bien en base mais appartient à un actif différent de celui indiqué par `asset_id`** — une personne raisonnable attend un rejet explicite, pas une affectation silencieusement créée avec un niveau qui n'a rien à voir avec l'actif visé.
- **L'état change entre la prévisualisation et le clic « Confirmer »** (ex. un autre administrateur archive le niveau visé entretemps) — une personne raisonnable attend que le commit le détecte et refuse, pas qu'il applique aveuglément un résultat de prévisualisation périmé.

---

## Task 1 : Schéma Prisma — enums et modèles d'import

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration sous `prisma/migrations/` (générée par la commande ci-dessous)

**Interfaces:**
- Produces: enums `ImportMode` (`CATALOGUE_SEED`, `BASELINE_ASSIGNMENTS`), `ImportRowOutcome` (`MATCHED`, `DRAFT_CREATED`, `TO_CREATE`, `NOOP_UNCHANGED`, `NOOP_DUPLICATE`, `UNRESOLVED`, `CONFLICT`) ; modèles `ImportBatch` (`id`, `orgId`, `mode`, `fileHash`, `fileName`, `actorId`, `totalRows`, `committedAt`, `createdAt`, relation `rows`) et `ImportRow` (`id`, `batchId`, `rowIndex`, `sourceFields` en `Json`, `resolvedAssetId`, `resolvedLevelId`, `resolvedUserId`, `outcome`, `reason`).

- [ ] **Step 1: Ajouter les enums et modèles au schéma**

Ouvrir `prisma/schema.prisma`. Ajouter les deux enums à côté des autres enums `Access*` existants (chercher `enum AccessAssignmentSource` pour se situer) :

```prisma
enum ImportMode {
  CATALOGUE_SEED
  BASELINE_ASSIGNMENTS
}

enum ImportRowOutcome {
  MATCHED
  DRAFT_CREATED
  TO_CREATE
  NOOP_UNCHANGED
  NOOP_DUPLICATE
  UNRESOLVED
  CONFLICT
}
```

Ajouter les deux modèles à côté des autres modèles `Access*` (chercher `model AccessAuditEvent` pour se situer, ajouter juste après) :

```prisma
model ImportBatch {
  id          String     @id @default(cuid())
  orgId       String
  mode        ImportMode
  fileHash    String
  fileName    String
  actorId     String
  totalRows   Int
  committedAt DateTime?
  createdAt   DateTime   @default(now())

  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  rows ImportRow[]

  @@index([orgId, mode, createdAt])
  @@map("import_batches")
}

model ImportRow {
  id              String           @id @default(cuid())
  batchId         String
  rowIndex        Int
  sourceFields    Json
  resolvedAssetId String?
  resolvedLevelId String?
  resolvedUserId  String?
  outcome         ImportRowOutcome
  reason          String?

  batch ImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@index([batchId])
  @@map("import_rows")
}
```

Ajouter la relation manquante côté `Organization` : chercher `model Organization` et, dans son bloc de relations (`accessAssignments AccessAssignment[]` ou équivalent), ajouter une ligne `importBatches ImportBatch[]`.

- [ ] **Step 2: Générer la migration**

Prérequis : `docker compose up -d db` (déjà actif dans ce worktree), `.env`/`.env.docker` déjà en place.

Run: `npx prisma migrate dev --name add_import_batches`
Expected: migration créée sous `prisma/migrations/<timestamp>_add_import_batches/migration.sql`, appliquée sans erreur, `Prisma Client` régénéré.

- [ ] **Step 3: Vérifier que la migration est purement additive**

Run: `cat prisma/migrations/<timestamp>_add_import_batches/migration.sql`
Expected: seulement des `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ... ADD CONSTRAINT` (foreign keys) — aucun `DROP`, aucun `ALTER COLUMN` sur une table existante.

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(access): schéma import — ImportBatch, ImportRow"
```

---

## Task 2 : Fonctions pures — parsing CSV et détection intra-fichier

**Files:**
- Create: `lib/access/import.ts`
- Create: `tests/unit/access-import.test.ts`
- Create: `tests/fixtures/access/registre_acces_2026-08-27.csv` (déjà copié dans ce worktree, tel quel, inchangé — vérifier sa présence, ne pas le régénérer)

**Interfaces:**
- Consumes: rien (fonctions pures, aucune dépendance Prisma)
- Produces (utilisé par la Tâche 3 et la Tâche 4) :
  - `interface SeedCsvRow { utilisateur: string; nomComplet: string; departement: string; logiciel: string; niveauAcces: string }`
  - `interface BaselineCsvRow { userId: string; assetId: string; accessLevelId: string; sourceUtilisateur: string | null; sourceNomComplet: string | null; sourceDepartement: string | null; sourceLogiciel: string | null; sourceNiveauAcces: string | null; sourceRow: string | null }`
  - `interface SeedPair { logiciel: string; niveauAcces: string }`
  - `type IntraFileStatus = "UNIQUE" | "DUPLICATE" | "INTERNAL_CONFLICT"`
  - `class CsvParseError extends Error {}`
  - `function parseSeedCsv(content: string): SeedCsvRow[]`
  - `function parseBaselineCsv(content: string): BaselineCsvRow[]`
  - `function extractDistinctPairs(rows: SeedCsvRow[]): SeedPair[]`
  - `function classifyBaselineRows(rows: BaselineCsvRow[]): IntraFileStatus[]`
  - `function computeFileHash(content: string): string`

- [ ] **Step 1: Vérifier la fixture réelle**

Run: `wc -l tests/fixtures/access/registre_acces_2026-08-27.csv && head -3 tests/fixtures/access/registre_acces_2026-08-27.csv`
Expected: 477 lignes (1 en-tête + 476 lignes de données), première ligne de données commençant par `abdoul.soumanou;Abdoul SOUMANOU;NULL;AWS - DocumentDB;AWS - DocumentDB-contributor`. Ce fichier existe déjà dans ce worktree — si absent, s'arrêter et demander : il ne doit jamais être reconstruit à la main (spec : contenu réel, inchangé).

- [ ] **Step 2: Écrire les tests des fonctions pures**

Créer `tests/unit/access-import.test.ts` :

```typescript
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
```

- [ ] **Step 3: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-import.test.ts`
Expected: FAIL — `lib/access/import.ts` n'existe pas encore.

- [ ] **Step 4: Implémenter `lib/access/import.ts`**

```typescript
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
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-import.test.ts`
Expected: tous PASS.

- [ ] **Step 6: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add lib/access/import.ts tests/unit/access-import.test.ts tests/fixtures/access/registre_acces_2026-08-27.csv
git commit -m "feat(access): fonctions pures de parsing/dédoublonnage CSV import"
```

---

## Task 3 : Accès Prisma — catalogue seed (prévisualisation et commit)

**Files:**
- Create: `lib/access/import-server.ts` (ce fichier grandit à la Tâche 4 et 5 — ne créer ici que la partie seed + les types/helpers partagés)
- Test: `tests/unit/access-db/import-server.test.ts` (ce fichier grandit aux Tâches 4 et 5)

**Interfaces:**
- Consumes: `parseSeedCsv`, `extractDistinctPairs`, `computeFileHash` (Tâche 2) ; `requireAssetAdministrator` n'est PAS utilisé ici (c'est le travail de la route, Tâche 6) — ces fonctions prennent `orgId`/`actorId` déjà résolus.
- Produces (consommé par la Tâche 6 et les Tâches 4/5 de ce même fichier) :
  - `interface ImportRowDTO { id: string; rowIndex: number; sourceFields: Record<string, string | null>; resolvedAssetId: string | null; resolvedLevelId: string | null; resolvedUserId: string | null; outcome: ImportRowOutcome; reason: string | null }`
  - `interface ImportBatchDTO { id: string; mode: ImportMode; fileName: string; fileHash: string; actorId: string; actorName: string | null; totalRows: number; committedAt: Date | null; createdAt: Date; rows: ImportRowDTO[] }`
  - `class ImportError extends Error {}`
  - `function previewCatalogueSeed(orgId: string, actorId: string, fileName: string, content: string): Promise<ImportBatchDTO>`
  - `function commitCatalogueSeed(orgId: string, actorId: string, batchId: string): Promise<ImportBatchDTO>`

- [ ] **Step 1: Écrire les tests DB pour le mode seed**

Créer `tests/unit/access-db/import-server.test.ts` :

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { previewCatalogueSeed, commitCatalogueSeed, ImportError } from "@/lib/access/import-server";

describe("import-server — catalogue seed", () => {
  let orgId: string;
  let actorId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Import Org", slug: `test-import-${Date.now()}` },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: { orgId, email: `actor-${Date.now()}@example.com`, name: "Actor", role: "CEO" },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.importBatch.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  const SEED_CSV =
    "utilisateur;nom_complet;departement;logiciel;niveau_acces\n" +
    "u1;U1;NULL;NOUVEAU-LOGICIEL;NOUVEAU-LOGICIEL-reader\n" +
    "u2;U2;NULL;NOUVEAU-LOGICIEL;NOUVEAU-LOGICIEL-admin\n";

  it("prévisualisation : ne crée rien, marque tout DRAFT_CREATED pour un catalogue vide", async () => {
    const batch = await previewCatalogueSeed(orgId, actorId, "seed.csv", SEED_CSV);
    expect(batch.totalRows).toBe(2);
    expect(batch.committedAt).toBeNull();
    expect(batch.rows.every((r) => r.outcome === "DRAFT_CREATED")).toBe(true);

    const assetCount = await prisma.accessAsset.count({ where: { orgId } });
    expect(assetCount).toBe(0);
  });

  it("commit : crée l'actif UNE SEULE FOIS pour 2 niveaux du même nouveau logiciel", async () => {
    const preview = await previewCatalogueSeed(orgId, actorId, "seed.csv", SEED_CSV);
    const committed = await commitCatalogueSeed(orgId, actorId, preview.id);

    expect(committed.committedAt).not.toBeNull();
    const assets = await prisma.accessAsset.findMany({ where: { orgId, name: "NOUVEAU-LOGICIEL" } });
    expect(assets).toHaveLength(1);
    const levels = await prisma.accessLevel.findMany({ where: { assetId: assets[0].id } });
    expect(levels.map((l) => l.name).sort()).toEqual([
      "NOUVEAU-LOGICIEL-admin",
      "NOUVEAU-LOGICIEL-reader",
    ]);
    expect(levels.every((l) => l.priority === null && l.isAdmin === null)).toBe(true);
  });

  it("un deuxième commit du même lot échoue", async () => {
    const preview = await previewCatalogueSeed(orgId, actorId, "seed.csv", SEED_CSV);
    await commitCatalogueSeed(orgId, actorId, preview.id);
    await expect(commitCatalogueSeed(orgId, actorId, preview.id)).rejects.toThrow(ImportError);
  });

  it("une paire déjà au catalogue est MATCHED, rien n'est recréé", async () => {
    const asset = await prisma.accessAsset.create({ data: { orgId, name: "DEJA-LA" } });
    await prisma.accessLevel.create({ data: { assetId: asset.id, name: "DEJA-LA-reader" } });

    const csv =
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\nu1;U1;NULL;DEJA-LA;DEJA-LA-reader\n";
    const preview = await previewCatalogueSeed(orgId, actorId, "seed2.csv", csv);
    expect(preview.rows[0].outcome).toBe("MATCHED");
    expect(preview.rows[0].resolvedAssetId).toBe(asset.id);

    const committed = await commitCatalogueSeed(orgId, actorId, preview.id);
    expect(committed.rows[0].outcome).toBe("MATCHED");
    const levelCount = await prisma.accessLevel.count({ where: { assetId: asset.id } });
    expect(levelCount).toBe(1);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/import-server.test.ts`
Expected: FAIL — `lib/access/import-server.ts` n'existe pas.

- [ ] **Step 3: Implémenter `lib/access/import-server.ts` (types partagés + mode seed)**

```typescript
// lib/access/import-server.ts
import type { Prisma, ImportMode, ImportRowOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { parseSeedCsv, extractDistinctPairs, computeFileHash, type SeedPair } from "./import";

export interface ImportRowDTO {
  id: string;
  rowIndex: number;
  sourceFields: Record<string, string | null>;
  resolvedAssetId: string | null;
  resolvedLevelId: string | null;
  resolvedUserId: string | null;
  outcome: ImportRowOutcome;
  reason: string | null;
}

export interface ImportBatchDTO {
  id: string;
  mode: ImportMode;
  fileName: string;
  fileHash: string;
  actorId: string;
  actorName: string | null;
  totalRows: number;
  committedAt: Date | null;
  createdAt: Date;
  rows: ImportRowDTO[];
}

export class ImportError extends Error {}

type BatchWithRows = Prisma.ImportBatchGetPayload<{ include: { rows: true } }>;

function toBatchDTO(batch: BatchWithRows, actorName: string | null): ImportBatchDTO {
  return {
    id: batch.id,
    mode: batch.mode,
    fileName: batch.fileName,
    fileHash: batch.fileHash,
    actorId: batch.actorId,
    actorName,
    totalRows: batch.totalRows,
    committedAt: batch.committedAt,
    createdAt: batch.createdAt,
    rows: batch.rows
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .map((r) => ({
        id: r.id,
        rowIndex: r.rowIndex,
        sourceFields: r.sourceFields as Record<string, string | null>,
        resolvedAssetId: r.resolvedAssetId,
        resolvedLevelId: r.resolvedLevelId,
        resolvedUserId: r.resolvedUserId,
        outcome: r.outcome,
        reason: r.reason,
      })),
  };
}

async function actorNameFor(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

async function resolveSeedPair(
  orgId: string,
  pair: SeedPair
): Promise<{ outcome: "MATCHED" | "DRAFT_CREATED"; resolvedAssetId: string | null; resolvedLevelId: string | null }> {
  const asset = await prisma.accessAsset.findFirst({
    where: { orgId, name: pair.logiciel, archivedAt: null },
  });
  if (!asset) return { outcome: "DRAFT_CREATED", resolvedAssetId: null, resolvedLevelId: null };
  const level = await prisma.accessLevel.findFirst({
    where: { assetId: asset.id, name: pair.niveauAcces, archivedAt: null },
  });
  if (!level) return { outcome: "DRAFT_CREATED", resolvedAssetId: asset.id, resolvedLevelId: null };
  return { outcome: "MATCHED", resolvedAssetId: asset.id, resolvedLevelId: level.id };
}

export async function previewCatalogueSeed(
  orgId: string,
  actorId: string,
  fileName: string,
  content: string
): Promise<ImportBatchDTO> {
  const rows = parseSeedCsv(content);
  const pairs = extractDistinctPairs(rows);
  const fileHash = computeFileHash(content);
  const resolved = await Promise.all(pairs.map((pair) => resolveSeedPair(orgId, pair)));

  const batch = await prisma.importBatch.create({
    data: {
      orgId,
      mode: "CATALOGUE_SEED",
      fileHash,
      fileName,
      actorId,
      totalRows: pairs.length,
      rows: {
        create: pairs.map((pair, i) => ({
          rowIndex: i,
          sourceFields: pair as unknown as Prisma.InputJsonValue,
          resolvedAssetId: resolved[i].resolvedAssetId,
          resolvedLevelId: resolved[i].resolvedLevelId,
          outcome: resolved[i].outcome,
        })),
      },
    },
    include: { rows: true },
  });
  return toBatchDTO(batch, await actorNameFor(actorId));
}

export async function commitCatalogueSeed(
  orgId: string,
  actorId: string,
  batchId: string
): Promise<ImportBatchDTO> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, orgId, mode: "CATALOGUE_SEED" },
    include: { rows: true },
  });
  if (!batch) throw new ImportError("Lot d'import introuvable");
  if (batch.committedAt) throw new ImportError("Ce lot a déjà été commité");

  const rowsSorted = [...batch.rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const pairs = rowsSorted.map((r) => r.sourceFields as unknown as SeedPair);

  const updated = await prisma.$transaction(async (tx) => {
    const assetIdByName = new Map<string, string>();

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      let assetId = assetIdByName.get(pair.logiciel);
      if (!assetId) {
        const existing = await tx.accessAsset.findFirst({
          where: { orgId, name: pair.logiciel, archivedAt: null },
        });
        const asset = existing ?? (await tx.accessAsset.create({ data: { orgId, name: pair.logiciel } }));
        assetId = asset.id;
        assetIdByName.set(pair.logiciel, assetId);
      }

      let level = await tx.accessLevel.findFirst({
        where: { assetId, name: pair.niveauAcces, archivedAt: null },
      });
      const outcome: "MATCHED" | "DRAFT_CREATED" = level ? "MATCHED" : "DRAFT_CREATED";
      if (!level) {
        level = await tx.accessLevel.create({
          data: { assetId, name: pair.niveauAcces, priority: null, isAdmin: null },
        });
      }

      await tx.importRow.update({
        where: { id: rowsSorted[i].id },
        data: { resolvedAssetId: assetId, resolvedLevelId: level.id, outcome },
      });
    }

    const committed = await tx.importBatch.update({
      where: { id: batchId },
      data: { committedAt: new Date() },
      include: { rows: true },
    });

    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "IMPORT",
      scopeId: batchId,
      eventType: "IMPORT_COMMITTED",
      objectType: "ImportBatch",
      objectId: batchId,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: { mode: "CATALOGUE_SEED", totalRows: committed.totalRows },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return committed;
  });

  return toBatchDTO(updated, await actorNameFor(actorId));
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/import-server.test.ts`
Expected: les 4 tests du describe "catalogue seed" PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/import-server.ts tests/unit/access-db/import-server.test.ts
git commit -m "feat(access): résolution et commit — mode catalogue seed"
```

---

## Task 4 : Accès Prisma — baseline assignments (résolution, tout-ou-rien, revalidation)

**Files:**
- Modify: `lib/access/import-server.ts` (ajouter la partie baseline au fichier de la Tâche 3)
- Modify: `tests/unit/access-db/import-server.test.ts` (ajouter un nouveau `describe`)

**Interfaces:**
- Consumes: `ImportBatchDTO`, `ImportRowDTO`, `ImportError`, `toBatchDTO`, `actorNameFor` (Tâche 3, même fichier) ; `parseBaselineCsv`, `classifyBaselineRows`, `computeFileHash`, `BaselineCsvRow` (Tâche 2).
- Produces (consommé par la Tâche 6) :
  - `function previewBaselineAssignments(orgId: string, actorId: string, fileName: string, content: string): Promise<ImportBatchDTO>`
  - `function commitBaselineAssignments(orgId: string, actorId: string, batchId: string): Promise<ImportBatchDTO>`

C'est la tâche la plus sensible du plan : tout-ou-rien au commit, revalidation complète, jamais de résurrection d'un `REVOKED`, jamais de modification d'un `source: "REQUEST"`.

- [ ] **Step 1: Ajouter les tests baseline**

Ajouter à `tests/unit/access-db/import-server.test.ts`, dans un nouveau `describe` au même niveau que celui de la Tâche 3 :

```typescript
describe("import-server — baseline assignments", () => {
  let orgId: string;
  let actorId: string;
  let employeeId: string;
  let assetId: string;
  let levelAId: string;
  let levelBId: string;
  let otherAssetId: string;
  let otherLevelId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Baseline Org", slug: `test-baseline-${Date.now()}` },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: { orgId, email: `actor-bl-${Date.now()}@example.com`, name: "Actor", role: "CEO" },
    });
    actorId = actor.id;
    const employee = await prisma.user.create({
      data: { orgId, email: `emp-${Date.now()}@example.com`, name: "Employee", role: "PO" },
    });
    employeeId = employee.id;
    await prisma.accessProfile.create({ data: { orgId, userId: employeeId, lifecycle: "ACTIVE" } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset" } });
    assetId = asset.id;
    const levelA = await prisma.accessLevel.create({ data: { assetId, name: "Level A" } });
    levelAId = levelA.id;
    const levelB = await prisma.accessLevel.create({ data: { assetId, name: "Level B" } });
    levelBId = levelB.id;

    const otherAsset = await prisma.accessAsset.create({ data: { orgId, name: "Other Asset" } });
    otherAssetId = otherAsset.id;
    const otherLevel = await prisma.accessLevel.create({ data: { assetId: otherAssetId, name: "Other Level" } });
    otherLevelId = otherLevel.id;
  });

  afterAll(async () => {
    await prisma.importBatch.deleteMany({ where: { orgId } });
    await prisma.accessAssignmentEvent.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("ligne valide : TO_CREATE en prévisualisation, ACTIVE/IMPORTED_UNREVIEWED/LEGACY_IMPORT au commit", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("TO_CREATE");
    expect(preview.committedAt).toBeNull();

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).not.toBeNull();
    expect(committed.rows[0].outcome).toBe("TO_CREATE");

    const assignment = await prisma.accessAssignment.findFirst({ where: { userId: employeeId, assetId } });
    expect(assignment).not.toBeNull();
    expect(assignment?.status).toBe("ACTIVE");
    expect(assignment?.verification).toBe("IMPORTED_UNREVIEWED");
    expect(assignment?.source).toBe("LEGACY_IMPORT");
    expect(assignment?.levelId).toBe(levelAId);

    const event = await prisma.accessAssignmentEvent.findFirst({ where: { assignmentId: assignment?.id } });
    expect(event?.sourceType).toBe("IMPORT");
    expect(event?.sourceId).toBe(preview.id);
    expect(event?.outcome).toBe("ASSIGNED");

    // Nettoyage pour les tests suivants du même describe.
    await prisma.accessAssignmentEvent.deleteMany({ where: { assignmentId: assignment?.id } });
    await prisma.accessAssignment.delete({ where: { id: assignment!.id } });
  });

  it("access_level_id existant mais appartenant à un AUTRE actif → UNRESOLVED, jamais accepté", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${otherLevelId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("UNRESOLVED");
    expect(preview.rows[0].reason).toMatch(/introuvable|appartenant/i);

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).toBeNull();
    const assignment = await prisma.accessAssignment.findFirst({ where: { userId: employeeId, assetId } });
    expect(assignment).toBeNull();
  });

  it("deux lignes du même fichier pour (employé, actif) avec des niveaux différents → CONFLICT, tout le lot bloqué", async () => {
    const csv =
      `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}\n${employeeId};${assetId};${levelBId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows.every((r) => r.outcome === "CONFLICT")).toBe(true);

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).toBeNull();
    const count = await prisma.accessAssignment.count({ where: { userId: employeeId, assetId } });
    expect(count).toBe(0);
  });

  it("employé OFFBOARDING/DEPARTED → UNRESOLVED", async () => {
    const departed = await prisma.user.create({
      data: { orgId, email: `departed-${Date.now()}@example.com`, name: "Departed", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: departed.id, lifecycle: "DEPARTED" } });

    const csv = `user_id;asset_id;access_level_id\n${departed.id};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("UNRESOLVED");

    await prisma.accessProfile.deleteMany({ where: { userId: departed.id } });
    await prisma.user.delete({ where: { id: departed.id } });
  });

  it("ré-upload du même fichier après commit réussi : no-op complet, aucune deuxième création", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const first = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    await commitBaselineAssignments(orgId, actorId, first.id);

    const second = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(second.rows[0].outcome).toBe("NOOP_UNCHANGED");
    const committedSecond = await commitBaselineAssignments(orgId, actorId, second.id);
    expect(committedSecond.committedAt).not.toBeNull();

    const count = await prisma.accessAssignment.count({ where: { userId: employeeId, assetId } });
    expect(count).toBe(1);

    const assignment = await prisma.accessAssignment.findFirstOrThrow({ where: { userId: employeeId, assetId } });
    await prisma.accessAssignmentEvent.deleteMany({ where: { assignmentId: assignment.id } });
    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
  });

  it("affectation native (source REQUEST) existante avec un niveau différent → CONFLICT, jamais écrasée", async () => {
    const native = await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelAId, status: "ACTIVE", source: "REQUEST" },
    });

    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelBId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("CONFLICT");

    await commitBaselineAssignments(orgId, actorId, preview.id);
    const unchanged = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: native.id } });
    expect(unchanged.levelId).toBe(levelAId);
    expect(unchanged.source).toBe("REQUEST");

    await prisma.accessAssignment.delete({ where: { id: native.id } });
  });

  it("affectation REVOKED existante → CONFLICT, jamais ressuscitée", async () => {
    const revoked = await prisma.accessAssignment.create({
      data: {
        orgId, userId: employeeId, assetId, levelId: levelAId,
        status: "REVOKED", source: "LEGACY_IMPORT", revokedAt: new Date(),
      },
    });

    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("CONFLICT");

    await commitBaselineAssignments(orgId, actorId, preview.id);
    const stillRevoked = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: revoked.id } });
    expect(stillRevoked.status).toBe("REVOKED");

    await prisma.accessAssignment.delete({ where: { id: revoked.id } });
  });

  it("revalidation au commit : un niveau archivé entre la prévisualisation et le commit bloque le lot", async () => {
    const toArchive = await prisma.accessLevel.create({ data: { assetId, name: "À archiver" } });
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${toArchive.id}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("TO_CREATE");

    await prisma.accessLevel.update({ where: { id: toArchive.id }, data: { archivedAt: new Date() } });

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).toBeNull();
    expect(committed.rows[0].outcome).toBe("UNRESOLVED");
    const count = await prisma.accessAssignment.count({ where: { userId: employeeId, assetId } });
    expect(count).toBe(0);

    await prisma.accessLevel.delete({ where: { id: toArchive.id } });
  });

  it("un deuxième commit d'un lot déjà commité échoue", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    await commitBaselineAssignments(orgId, actorId, preview.id);
    await expect(commitBaselineAssignments(orgId, actorId, preview.id)).rejects.toThrow(ImportError);

    const assignment = await prisma.accessAssignment.findFirstOrThrow({ where: { userId: employeeId, assetId } });
    await prisma.accessAssignmentEvent.deleteMany({ where: { assignmentId: assignment.id } });
    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
  });
});
```

Ajouter l'import correspondant en tête du fichier de test :

```typescript
import { previewBaselineAssignments, commitBaselineAssignments } from "@/lib/access/import-server";
```

(fusionner avec l'import existant de la Tâche 3 plutôt que dupliquer la ligne `import ... from "@/lib/access/import-server"`.)

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/import-server.test.ts`
Expected: FAIL — `previewBaselineAssignments`/`commitBaselineAssignments` n'existent pas encore.

- [ ] **Step 3: Ajouter la partie baseline à `lib/access/import-server.ts`**

Ajouter en haut du fichier, à l'import existant de `./import` :

```typescript
import { parseBaselineCsv, classifyBaselineRows, type BaselineCsvRow } from "./import";
```

Ajouter à la fin du fichier :

```typescript
interface ResolvedBaselineRow {
  outcome: ImportRowOutcome;
  resolvedUserId: string | null;
  resolvedAssetId: string | null;
  resolvedLevelId: string | null;
  reason: string | null;
}

async function resolveBaselineRow(orgId: string, row: BaselineCsvRow): Promise<ResolvedBaselineRow> {
  const [user, profile, asset, level] = await Promise.all([
    prisma.user.findFirst({ where: { id: row.userId, orgId }, select: { id: true } }),
    prisma.accessProfile.findFirst({ where: { userId: row.userId, orgId }, select: { lifecycle: true } }),
    prisma.accessAsset.findFirst({ where: { id: row.assetId, orgId, archivedAt: null }, select: { id: true } }),
    prisma.accessLevel.findFirst({
      where: { id: row.accessLevelId, assetId: row.assetId, archivedAt: null },
      select: { id: true },
    }),
  ]);

  if (!user) {
    return { outcome: "UNRESOLVED", resolvedUserId: null, resolvedAssetId: null, resolvedLevelId: null, reason: "Utilisateur introuvable dans cette organisation" };
  }
  if (!profile || profile.lifecycle !== "ACTIVE") {
    return { outcome: "UNRESOLVED", resolvedUserId: user.id, resolvedAssetId: null, resolvedLevelId: null, reason: "Utilisateur non actif (en départ ou parti)" };
  }
  if (!asset) {
    return { outcome: "UNRESOLVED", resolvedUserId: user.id, resolvedAssetId: null, resolvedLevelId: null, reason: "Actif introuvable dans cette organisation" };
  }
  if (!level) {
    return { outcome: "UNRESOLVED", resolvedUserId: user.id, resolvedAssetId: asset.id, resolvedLevelId: null, reason: "Niveau introuvable ou n'appartenant pas à cet actif" };
  }

  const existing = await prisma.accessAssignment.findFirst({ where: { userId: user.id, assetId: asset.id } });
  if (!existing) {
    return { outcome: "TO_CREATE", resolvedUserId: user.id, resolvedAssetId: asset.id, resolvedLevelId: level.id, reason: null };
  }
  if (existing.status === "ACTIVE" && existing.levelId === level.id) {
    return { outcome: "NOOP_UNCHANGED", resolvedUserId: user.id, resolvedAssetId: asset.id, resolvedLevelId: level.id, reason: null };
  }
  return {
    outcome: "CONFLICT",
    resolvedUserId: user.id,
    resolvedAssetId: asset.id,
    resolvedLevelId: level.id,
    reason:
      existing.status !== "ACTIVE"
        ? "Une affectation existe déjà pour cet employé et cet actif mais n'est plus active — non réactivée automatiquement"
        : "Une affectation active différente existe déjà pour cet employé et cet actif",
  };
}

async function resolveBaselineBatch(
  orgId: string,
  rows: BaselineCsvRow[]
): Promise<ResolvedBaselineRow[]> {
  const classifications = classifyBaselineRows(rows);
  return Promise.all(
    rows.map((row, i) => {
      if (classifications[i] === "INTERNAL_CONFLICT") {
        return Promise.resolve<ResolvedBaselineRow>({
          outcome: "CONFLICT",
          resolvedUserId: null,
          resolvedAssetId: null,
          resolvedLevelId: null,
          reason: "Incohérence dans le fichier : ce couple employé/actif porte plusieurs niveaux différents dans ce fichier",
        });
      }
      if (classifications[i] === "DUPLICATE") {
        return Promise.resolve<ResolvedBaselineRow>({
          outcome: "NOOP_DUPLICATE",
          resolvedUserId: null,
          resolvedAssetId: null,
          resolvedLevelId: null,
          reason: null,
        });
      }
      return resolveBaselineRow(orgId, row);
    })
  );
}

export async function previewBaselineAssignments(
  orgId: string,
  actorId: string,
  fileName: string,
  content: string
): Promise<ImportBatchDTO> {
  const rows = parseBaselineCsv(content);
  const fileHash = computeFileHash(content);
  const resolved = await resolveBaselineBatch(orgId, rows);

  const batch = await prisma.importBatch.create({
    data: {
      orgId,
      mode: "BASELINE_ASSIGNMENTS",
      fileHash,
      fileName,
      actorId,
      totalRows: rows.length,
      rows: {
        create: rows.map((row, i) => ({
          rowIndex: i,
          sourceFields: row as unknown as Prisma.InputJsonValue,
          resolvedUserId: resolved[i].resolvedUserId,
          resolvedAssetId: resolved[i].resolvedAssetId,
          resolvedLevelId: resolved[i].resolvedLevelId,
          outcome: resolved[i].outcome,
          reason: resolved[i].reason,
        })),
      },
    },
    include: { rows: true },
  });
  return toBatchDTO(batch, await actorNameFor(actorId));
}

/**
 * Revalide TOUJOURS entièrement contre l'état actuel de la base avant de
 * commiter — jamais confiance dans les lignes stockées à la prévisualisation
 * (spec : « stale previews... block the whole commit »). Tout-ou-rien : le
 * lot ne se commite que si zéro ligne UNRESOLVED/CONFLICT après revalidation.
 */
export async function commitBaselineAssignments(
  orgId: string,
  actorId: string,
  batchId: string
): Promise<ImportBatchDTO> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, orgId, mode: "BASELINE_ASSIGNMENTS" },
    include: { rows: true },
  });
  if (!batch) throw new ImportError("Lot d'import introuvable");
  if (batch.committedAt) throw new ImportError("Ce lot a déjà été commité");

  const rowsSorted = [...batch.rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const sourceRows = rowsSorted.map((r) => r.sourceFields as unknown as BaselineCsvRow);
  const resolved = await resolveBaselineBatch(orgId, sourceRows);
  const hasBlockingRow = resolved.some((r) => r.outcome === "UNRESOLVED" || r.outcome === "CONFLICT");

  const updated = await prisma.$transaction(async (tx) => {
    for (let i = 0; i < rowsSorted.length; i++) {
      await tx.importRow.update({
        where: { id: rowsSorted[i].id },
        data: {
          resolvedUserId: resolved[i].resolvedUserId,
          resolvedAssetId: resolved[i].resolvedAssetId,
          resolvedLevelId: resolved[i].resolvedLevelId,
          outcome: resolved[i].outcome,
          reason: resolved[i].reason,
        },
      });
    }

    if (hasBlockingRow) {
      return tx.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { rows: true } });
    }

    for (const r of resolved) {
      if (r.outcome !== "TO_CREATE") continue;
      const assignment = await tx.accessAssignment.create({
        data: {
          orgId,
          userId: r.resolvedUserId as string,
          assetId: r.resolvedAssetId as string,
          levelId: r.resolvedLevelId as string,
          status: "ACTIVE",
          verification: "IMPORTED_UNREVIEWED",
          source: "LEGACY_IMPORT",
          periodStart: new Date(),
        },
      });
      await tx.accessAssignmentEvent.create({
        data: {
          orgId,
          assignmentId: assignment.id,
          userId: assignment.userId,
          assetId: assignment.assetId,
          beforeLevelId: null,
          afterLevelId: assignment.levelId,
          actorId,
          actorRole: "ASSET_ADMINISTRATOR",
          sourceType: "IMPORT",
          sourceId: batchId,
          outcome: "ASSIGNED",
        },
      });
    }

    const committed = await tx.importBatch.update({
      where: { id: batchId },
      data: { committedAt: new Date() },
      include: { rows: true },
    });

    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "IMPORT",
      scopeId: batchId,
      eventType: "IMPORT_COMMITTED",
      objectType: "ImportBatch",
      objectId: batchId,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: { mode: "BASELINE_ASSIGNMENTS", totalRows: committed.totalRows },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return committed;
  });

  return toBatchDTO(updated, await actorNameFor(actorId));
}
```

- [ ] **Step 4: Lancer tous les tests du fichier, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/import-server.test.ts`
Expected: tous PASS (les 4 tests seed de la Tâche 3 + les 9 tests baseline de cette tâche).

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/import-server.ts tests/unit/access-db/import-server.test.ts
git commit -m "feat(access): résolution et commit tout-ou-rien — mode baseline assignments"
```

---

## Task 5 : Accès Prisma — historique des lots

**Files:**
- Modify: `lib/access/import-server.ts`
- Modify: `tests/unit/access-db/import-server.test.ts`

**Interfaces:**
- Consumes: `toBatchDTO`, `ImportBatchDTO` (Tâches 3/4, même fichier).
- Produces (consommé par la Tâche 8) : `function listImportBatches(orgId: string, mode?: ImportMode): Promise<ImportBatchDTO[]>`

- [ ] **Step 1: Ajouter le test**

Ajouter un troisième `describe` à `tests/unit/access-db/import-server.test.ts` :

```typescript
describe("import-server — historique", () => {
  let orgId: string;
  let actorId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test History Org", slug: `test-history-${Date.now()}` },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: { orgId, email: `actor-hist-${Date.now()}@example.com`, name: "Actor", role: "CEO" },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.importBatch.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("liste les lots de l'org, triés du plus récent au plus ancien, filtrable par mode", async () => {
    await previewCatalogueSeed(
      orgId, actorId, "a.csv",
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\nu;U;NULL;L;N\n"
    );
    await previewBaselineAssignments(orgId, actorId, "b.csv", "user_id;asset_id;access_level_id\nu1;a1;l1\n");

    const all = await listImportBatches(orgId);
    expect(all).toHaveLength(2);
    expect(all[0].fileName).toBe("b.csv");
    expect(all[0].actorName).toBe("Actor");

    const seedOnly = await listImportBatches(orgId, "CATALOGUE_SEED");
    expect(seedOnly).toHaveLength(1);
    expect(seedOnly[0].fileName).toBe("a.csv");
  });

  it("n'affiche jamais les lots d'une autre organisation", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "Other Org", slug: `other-${Date.now()}` },
    });
    const otherActor = await prisma.user.create({
      data: { orgId: otherOrg.id, email: `other-${Date.now()}@example.com`, name: "Other", role: "CEO" },
    });
    await previewCatalogueSeed(
      otherOrg.id, otherActor.id, "isolated.csv",
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\nu;U;NULL;L;N\n"
    );

    const mine = await listImportBatches(orgId);
    expect(mine.some((b) => b.fileName === "isolated.csv")).toBe(false);

    await prisma.importBatch.deleteMany({ where: { orgId: otherOrg.id } });
    await prisma.user.delete({ where: { id: otherActor.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});
```

Ajouter `listImportBatches` à l'import existant de `@/lib/access/import-server` en tête du fichier de test.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/import-server.test.ts`
Expected: FAIL — `listImportBatches` n'existe pas.

- [ ] **Step 3: Implémenter `listImportBatches`**

Ajouter à la fin de `lib/access/import-server.ts` :

```typescript
export async function listImportBatches(orgId: string, mode?: ImportMode): Promise<ImportBatchDTO[]> {
  const batches = await prisma.importBatch.findMany({
    where: { orgId, ...(mode && { mode }) },
    include: { rows: true },
    orderBy: { createdAt: "desc" },
  });

  const actorIds = [...new Set(batches.map((b) => b.actorId))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name]));

  return batches.map((b) => toBatchDTO(b, nameById.get(b.actorId) ?? null));
}
```

- [ ] **Step 4: Lancer tous les tests du fichier, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/import-server.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/import-server.ts tests/unit/access-db/import-server.test.ts
git commit -m "feat(access): historique des lots d'import"
```

---

## Task 6 : Routes API — catalogue seed

**Files:**
- Create: `app/api/access/imports/catalogue-seed/route.ts`
- Create: `app/api/access/imports/catalogue-seed/[batchId]/commit/route.ts`

**Interfaces:**
- Consumes: `requireAssetAdministrator`, `AssetAdminAccessDeniedError` (`lib/access/asset-admin-guard.ts`, phase 1) ; `previewCatalogueSeed`, `commitCatalogueSeed`, `ImportError` (Tâche 3) ; `CsvParseError` (Tâche 2).
- Produces: `POST /api/access/imports/catalogue-seed` (multipart, champ `file`) → `201 { data: ImportBatchDTO }` ; `POST /api/access/imports/catalogue-seed/:batchId/commit` → `200 { data: ImportBatchDTO }`.

Ces routes n'ont pas de test dédié (comme les autres routes du module en phase 1) — elles sont exercées par la vérification manuelle de la Tâche 11 et transitivement par les tests de la Tâche 3/4 qui appellent directement les fonctions `*-server`.

- [ ] **Step 1: Route de prévisualisation**

Créer `app/api/access/imports/catalogue-seed/route.ts` :

```typescript
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { previewCatalogueSeed } from "@/lib/access/import-server";
import { CsvParseError } from "@/lib/access/import";

export const runtime = "nodejs";

const MAX_SEED_FILE_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/access/imports/catalogue-seed
 * Multipart, champ `file`. Prévisualise sans rien créer — voir Tâche 3.
 */
export async function POST(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  let file: File | null = null;
  try {
    const form = (await request.formData()) as unknown as globalThis.FormData;
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return Response.json({ error: "Corps multipart invalide" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ error: "Aucun fichier reçu" }, { status: 400 });
  }
  if (file.size > MAX_SEED_FILE_BYTES) {
    return Response.json({ error: "Fichier trop lourd (max 2 Mo)" }, { status: 413 });
  }

  const content = await file.text();
  try {
    const batch = await previewCatalogueSeed(ctx.orgId, ctx.userId, file.name.slice(0, 200), content);
    return Response.json({ data: batch }, { status: 201 });
  } catch (err) {
    if (err instanceof CsvParseError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Route de commit**

Créer `app/api/access/imports/catalogue-seed/[batchId]/commit/route.ts` :

```typescript
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { commitCatalogueSeed, ImportError } from "@/lib/access/import-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const { batchId } = await params;

  try {
    const batch = await commitCatalogueSeed(ctx.orgId, ctx.userId, batchId);
    return Response.json({ data: batch });
  } catch (err) {
    if (err instanceof ImportError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/api/access/imports/catalogue-seed` et `/api/access/imports/catalogue-seed/[batchId]/commit` apparaissent dans la sortie du build.

- [ ] **Step 4: Commit**

```bash
git add app/api/access/imports/catalogue-seed/
git commit -m "feat(access): routes API — import catalogue seed"
```

---

## Task 7 : Routes API — baseline assignments

**Files:**
- Create: `app/api/access/imports/baseline/route.ts`
- Create: `app/api/access/imports/baseline/[batchId]/commit/route.ts`

**Interfaces:**
- Consumes: mêmes gardes que la Tâche 6 ; `previewBaselineAssignments`, `commitBaselineAssignments`, `ImportError` (Tâche 4) ; `CsvParseError` (Tâche 2).
- Produces: `POST /api/access/imports/baseline` (multipart) → `201 { data: ImportBatchDTO }` ; `POST /api/access/imports/baseline/:batchId/commit` → `200 { data: ImportBatchDTO }` (avec `committedAt: null` en réponse si le lot reste bloqué — ce n'est pas une erreur HTTP, c'est un résultat normal que le client interprète).

- [ ] **Step 1: Route de prévisualisation**

Créer `app/api/access/imports/baseline/route.ts` :

```typescript
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { previewBaselineAssignments } from "@/lib/access/import-server";
import { CsvParseError } from "@/lib/access/import";

export const runtime = "nodejs";

const MAX_BASELINE_FILE_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/access/imports/baseline
 * Multipart, champ `file`. Prévisualise sans rien créer — voir Tâche 4.
 */
export async function POST(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  let file: File | null = null;
  try {
    const form = (await request.formData()) as unknown as globalThis.FormData;
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return Response.json({ error: "Corps multipart invalide" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ error: "Aucun fichier reçu" }, { status: 400 });
  }
  if (file.size > MAX_BASELINE_FILE_BYTES) {
    return Response.json({ error: "Fichier trop lourd (max 5 Mo)" }, { status: 413 });
  }

  const content = await file.text();
  try {
    const batch = await previewBaselineAssignments(ctx.orgId, ctx.userId, file.name.slice(0, 200), content);
    return Response.json({ data: batch }, { status: 201 });
  } catch (err) {
    if (err instanceof CsvParseError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Route de commit**

Créer `app/api/access/imports/baseline/[batchId]/commit/route.ts` :

```typescript
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { commitBaselineAssignments, ImportError } from "@/lib/access/import-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const { batchId } = await params;

  try {
    const batch = await commitBaselineAssignments(ctx.orgId, ctx.userId, batchId);
    return Response.json({ data: batch });
  } catch (err) {
    if (err instanceof ImportError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; les deux routes apparaissent dans la sortie du build.

- [ ] **Step 4: Commit**

```bash
git add app/api/access/imports/baseline/
git commit -m "feat(access): routes API — import baseline assignments"
```

---

## Task 8 : Route API — historique des imports

**Files:**
- Create: `app/api/access/imports/route.ts`

**Interfaces:**
- Consumes: `requireAssetAdministrator`, `AssetAdminAccessDeniedError` ; `listImportBatches` (Tâche 5).
- Produces: `GET /api/access/imports?mode=CATALOGUE_SEED|BASELINE_ASSIGNMENTS` → `200 { data: ImportBatchDTO[] }` (mode omis = tous les lots).

- [ ] **Step 1: Implémenter la route**

```typescript
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { listImportBatches } from "@/lib/access/import-server";
import type { ImportMode } from "@prisma/client";

const VALID_MODES: ImportMode[] = ["CATALOGUE_SEED", "BASELINE_ASSIGNMENTS"];

export async function GET(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const { searchParams } = new URL(request.url);
  const modeParam = searchParams.get("mode");
  const mode =
    modeParam && VALID_MODES.includes(modeParam as ImportMode) ? (modeParam as ImportMode) : undefined;

  const data = await listImportBatches(ctx.orgId, mode);
  return Response.json({ data });
}
```

- [ ] **Step 2: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/api/access/imports` apparaît dans la sortie du build.

- [ ] **Step 3: Commit**

```bash
git add app/api/access/imports/route.ts
git commit -m "feat(access): route API — historique des imports"
```

---

## Task 9 : Écran — page d'import et panneau catalogue seed

**Files:**
- Create: `app/(dashboard)/access/assets/import/page.tsx`
- Create: `components/access/ImportSeedPanel.tsx`

**Interfaces:**
- Consumes: `getEffectiveRoleHolders` (phase 1, `lib/access/roles-server.ts`), `listImportBatches` (Tâche 5), `AdminPageHeader` (`components/admin/AdminPageHeader.tsx`, props `title`/`subtitle`/`action`).
- Produces: composant `ImportSeedPanel` (auto-suffisant, upload + prévisualisation + commit du mode seed), consommé par cette page et complété par les Tâches 10/11.

- [ ] **Step 1: Créer la page**

```tsx
// app/(dashboard)/access/assets/import/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listImportBatches } from "@/lib/access/import-server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ImportSeedPanel } from "@/components/access/ImportSeedPanel";

export default async function AccessImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAssetAdmin = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!isAssetAdmin) redirect("/dashboard");

  const batches = await listImportBatches(orgId);

  // Next.js sérialise les props d'un composant serveur vers un composant
  // client en JSON : les champs Date doivent devenir des chaînes ISO avant
  // de traverser cette frontière (même convention que app/(dashboard)/access/assets/page.tsx).
  const serializedBatches = batches.map((b) => ({
    ...b,
    committedAt: b.committedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Import du catalogue et des accès"
        subtitle="Amorcer le registre à partir de données existantes"
      />
      <div className="space-y-6 mt-4">
        <ImportSeedPanel />
        {/* ImportBaselinePanel (Tâche 10) et ImportHistoryList (Tâche 11) viennent ici */}
        {JSON.stringify(serializedBatches).length >= 0 /* placeholder retiré Tâche 11 */}
      </div>
    </div>
  );
}
```

**Note pour l'implémenteur** : la ligne `{JSON.stringify(...)}` est un test de fumée temporaire pour vérifier que `serializedBatches` compile sans avertissement TypeScript « variable inutilisée » avant que la Tâche 11 ne le remplace par `<ImportHistoryList batches={serializedBatches} />`. Elle **doit** être retirée à la Tâche 11 — si elle apparaît encore dans le build final de la Tâche 12, c'est une erreur d'implémentation.

- [ ] **Step 2: Créer `ImportSeedPanel`**

```tsx
// components/access/ImportSeedPanel.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RowDTO {
  id: string;
  sourceFields: Record<string, string | null>;
  outcome: string;
}
interface BatchDTO {
  id: string;
  totalRows: number;
  committedAt: string | null;
  rows: RowDTO[];
}

const MAX_SEED_FILE_BYTES = 2 * 1024 * 1024;

export function ImportSeedPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBatch(null);
    if (file.size > MAX_SEED_FILE_BYTES) {
      setError("Fichier trop lourd (max 2 Mo)");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/access/imports/catalogue-seed", { method: "POST", body });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de l'analyse du fichier");
        return;
      }
      setBatch(payload.data);
    } catch {
      setError("Échec de l'envoi — vérifiez votre connexion");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function commit() {
    if (!batch) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/imports/catalogue-seed/${batch.id}/commit`, { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de la confirmation");
        return;
      }
      setBatch(payload.data);
      router.refresh();
    } finally {
      setCommitting(false);
    }
  }

  const matched = batch?.rows.filter((r) => r.outcome === "MATCHED").length ?? 0;
  const draftCreated = batch?.rows.filter((r) => r.outcome === "DRAFT_CREATED").length ?? 0;

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4">
      <h2 className="font-serif text-[16px] text-dark mb-1">Amorcer le catalogue (seed)</h2>
      <p className="text-[12px] text-izi-gray mb-3">
        Fichier brut à 5 colonnes (utilisateur;nom_complet;departement;logiciel;niveau_acces).
        Crée les actifs et niveaux manquants — aucune affectation employé n&apos;est créée.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="block w-full text-[12px] text-izi-gray file:mr-3 file:rounded-[8px] file:border-0 file:bg-teal-lt file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-teal-dk hover:file:bg-teal-md disabled:opacity-50"
        aria-label="Charger le CSV du catalogue"
      />
      {uploading && <p className="mt-2 text-[12px] text-teal-dk">Analyse en cours…</p>}
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}

      {batch && (
        <div className="mt-4">
          <p className="text-[12px] text-dark mb-2">
            {batch.totalRows} paire(s) logiciel/niveau — {matched} déjà au catalogue, {draftCreated} à créer.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-[8px] border border-border-soft">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-izi-gray text-left bg-gray-lt">
                  <th className="py-1 px-2 font-medium">Logiciel</th>
                  <th className="py-1 px-2 font-medium">Niveau</th>
                  <th className="py-1 px-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="py-1 px-2">{r.sourceFields.logiciel}</td>
                    <td className="py-1 px-2">{r.sourceFields.niveauAcces}</td>
                    <td className="py-1 px-2">{r.outcome === "MATCHED" ? "Déjà au catalogue" : "Sera créé"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batch.committedAt ? (
            <p className="mt-2 text-[12px] text-izi-green">
              Importé le {new Date(batch.committedAt).toLocaleString("fr-FR")}.
            </p>
          ) : (
            <button
              type="button"
              onClick={commit}
              disabled={committing}
              className="mt-3 rounded-[6px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {committing ? "Confirmation…" : "Confirmer l'import"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/access/assets/import` apparaît dans la sortie du build.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/access/assets/import/page.tsx" components/access/ImportSeedPanel.tsx
git commit -m "feat(access): écran d'import — page et panneau catalogue seed"
```

---

## Task 10 : Écran — panneau baseline assignments

**Files:**
- Create: `components/access/ImportBaselinePanel.tsx`
- Modify: `app/(dashboard)/access/assets/import/page.tsx` (ajouter le panneau)

**Interfaces:**
- Consumes: routes de la Tâche 7 (`/api/access/imports/baseline`, `/api/access/imports/baseline/:batchId/commit`).
- Produces: composant `ImportBaselinePanel`, auto-suffisant.

- [ ] **Step 1: Créer `ImportBaselinePanel`**

```tsx
// components/access/ImportBaselinePanel.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RowDTO {
  id: string;
  rowIndex: number;
  outcome: string;
  reason: string | null;
}
interface BatchDTO {
  id: string;
  totalRows: number;
  committedAt: string | null;
  rows: RowDTO[];
}

const MAX_BASELINE_FILE_BYTES = 5 * 1024 * 1024;
const OUTCOME_LABELS: Record<string, string> = {
  TO_CREATE: "Sera créé",
  NOOP_UNCHANGED: "Déjà à jour (rien à faire)",
  NOOP_DUPLICATE: "Doublon dans le fichier",
  UNRESOLVED: "Non résolu",
  CONFLICT: "Conflit",
};

export function ImportBaselinePanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setBatch(null);
    if (file.size > MAX_BASELINE_FILE_BYTES) {
      setError("Fichier trop lourd (max 5 Mo)");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/access/imports/baseline", { method: "POST", body });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de l'analyse du fichier");
        return;
      }
      setBatch(payload.data);
    } catch {
      setError("Échec de l'envoi — vérifiez votre connexion");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function commit() {
    if (!batch) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/imports/baseline/${batch.id}/commit`, { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de la confirmation");
        return;
      }
      setBatch(payload.data);
      router.refresh();
    } finally {
      setCommitting(false);
    }
  }

  const counts = (batch?.rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});
  const hasBlocking = (batch?.rows ?? []).some((r) => r.outcome === "UNRESOLVED" || r.outcome === "CONFLICT");

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4">
      <h2 className="font-serif text-[16px] text-dark mb-1">Charger une base d&apos;affectations</h2>
      <p className="text-[12px] text-izi-gray mb-3">
        Fichier normalisé (user_id;asset_id;access_level_id) préparé séparément.
        La moindre ligne en erreur bloque tout le lot — corrigez le fichier et rechargez-le.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="block w-full text-[12px] text-izi-gray file:mr-3 file:rounded-[8px] file:border-0 file:bg-teal-lt file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-teal-dk hover:file:bg-teal-md disabled:opacity-50"
        aria-label="Charger le CSV de baseline"
      />
      {uploading && <p className="mt-2 text-[12px] text-teal-dk">Analyse en cours…</p>}
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}

      {batch && (
        <div className="mt-4">
          <p className="text-[12px] text-dark mb-2">
            {batch.totalRows} ligne(s) —{" "}
            {Object.entries(counts)
              .map(([outcome, count]) => `${OUTCOME_LABELS[outcome] ?? outcome} : ${count}`)
              .join(" · ")}
          </p>
          <div className="max-h-64 overflow-y-auto rounded-[8px] border border-border-soft">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-izi-gray text-left bg-gray-lt">
                  <th className="py-1 px-2 font-medium">Ligne</th>
                  <th className="py-1 px-2 font-medium">Statut</th>
                  <th className="py-1 px-2 font-medium">Motif</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="py-1 px-2">{r.rowIndex + 2}</td>
                    <td
                      className={`py-1 px-2 ${
                        r.outcome === "UNRESOLVED" || r.outcome === "CONFLICT" ? "text-red font-medium" : ""
                      }`}
                    >
                      {OUTCOME_LABELS[r.outcome] ?? r.outcome}
                    </td>
                    <td className="py-1 px-2">{r.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batch.committedAt ? (
            <p className="mt-2 text-[12px] text-izi-green">
              Importé le {new Date(batch.committedAt).toLocaleString("fr-FR")}.
            </p>
          ) : hasBlocking ? (
            <p className="mt-3 text-[12px] text-red font-medium">
              Ce lot contient des lignes bloquantes — corrigez le fichier source et rechargez-le.
              Aucun commit partiel n&apos;est possible.
            </p>
          ) : (
            <button
              type="button"
              onClick={commit}
              disabled={committing}
              className="mt-3 rounded-[6px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {committing ? "Confirmation…" : "Confirmer l'import"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ajouter le panneau à la page**

Dans `app/(dashboard)/access/assets/import/page.tsx`, ajouter l'import `import { ImportBaselinePanel } from "@/components/access/ImportBaselinePanel";` et insérer `<ImportBaselinePanel />` juste après `<ImportSeedPanel />` dans le `<div className="space-y-6 mt-4">`.

- [ ] **Step 3: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add components/access/ImportBaselinePanel.tsx "app/(dashboard)/access/assets/import/page.tsx"
git commit -m "feat(access): écran d'import — panneau baseline assignments"
```

---

## Task 11 : Écran — historique, intégration finale, entrée depuis /access/assets

**Files:**
- Create: `components/access/ImportHistoryList.tsx`
- Modify: `app/(dashboard)/access/assets/import/page.tsx` (retirer le placeholder de la Tâche 9, brancher l'historique)
- Modify: `app/(dashboard)/access/assets/page.tsx` (ajouter un lien vers l'écran d'import)

**Interfaces:**
- Consumes: `serializedBatches` produit par la page (Tâche 9).
- Produces: composant `ImportHistoryList`.

- [ ] **Step 1: Créer `ImportHistoryList`**

```tsx
// components/access/ImportHistoryList.tsx
interface BatchSummary {
  id: string;
  mode: string;
  fileName: string;
  actorName: string | null;
  totalRows: number;
  committedAt: string | null;
  createdAt: string;
}

const MODE_LABELS: Record<string, string> = {
  CATALOGUE_SEED: "Amorçage catalogue",
  BASELINE_ASSIGNMENTS: "Base d'affectations",
};

export function ImportHistoryList({ batches }: { batches: BatchSummary[] }) {
  if (batches.length === 0) {
    return <p className="text-[12px] text-izi-gray">Aucun import effectué pour l&apos;instant.</p>;
  }
  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4">
      <h2 className="font-serif text-[16px] text-dark mb-3">Historique des imports</h2>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="py-1 font-medium">Date</th>
            <th className="py-1 font-medium">Mode</th>
            <th className="py-1 font-medium">Fichier</th>
            <th className="py-1 font-medium">Par</th>
            <th className="py-1 font-medium">Lignes</th>
            <th className="py-1 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-t border-border-soft">
              <td className="py-1">{new Date(b.createdAt).toLocaleString("fr-FR")}</td>
              <td className="py-1">{MODE_LABELS[b.mode] ?? b.mode}</td>
              <td className="py-1">{b.fileName}</td>
              <td className="py-1">{b.actorName ?? "—"}</td>
              <td className="py-1">{b.totalRows}</td>
              <td className="py-1">{b.committedAt ? "Importé" : "Bloqué / en attente"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Finaliser la page d'import**

Remplacer entièrement `app/(dashboard)/access/assets/import/page.tsx` par :

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listImportBatches } from "@/lib/access/import-server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ImportSeedPanel } from "@/components/access/ImportSeedPanel";
import { ImportBaselinePanel } from "@/components/access/ImportBaselinePanel";
import { ImportHistoryList } from "@/components/access/ImportHistoryList";

export default async function AccessImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAssetAdmin = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!isAssetAdmin) redirect("/dashboard");

  const batches = await listImportBatches(orgId);
  const serializedBatches = batches.map((b) => ({
    ...b,
    committedAt: b.committedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Import du catalogue et des accès"
        subtitle="Amorcer le registre à partir de données existantes"
      />
      <div className="space-y-6 mt-4">
        <ImportSeedPanel />
        <ImportBaselinePanel />
        <ImportHistoryList batches={serializedBatches} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Ajouter un lien depuis `/access/assets`**

Dans `app/(dashboard)/access/assets/page.tsx`, ajouter l'import `import Link from "next/link";` en tête, puis passer un `action` à `<AdminPageHeader>` (chercher le bloc `<AdminPageHeader title="Administration des actifs" .../>` identifié à la Tâche 9 — le remplacer) :

```tsx
<AdminPageHeader
  title="Administration des actifs"
  subtitle={`${assets.length} application${assets.length > 1 ? "s" : ""} au catalogue`}
  action={
    <Link
      href="/access/assets/import"
      className="inline-flex items-center rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors no-underline"
    >
      Importer…
    </Link>
  }
/>
```

- [ ] **Step 4: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur, aucun avertissement « variable inutilisée » sur `serializedBatches` (le placeholder de la Tâche 9 doit avoir disparu).

- [ ] **Step 5: Commit**

```bash
git add components/access/ImportHistoryList.tsx "app/(dashboard)/access/assets/import/page.tsx" "app/(dashboard)/access/assets/page.tsx"
git commit -m "feat(access): écran d'import — historique, intégration finale, lien depuis /access/assets"
```

---

## Task 12 : Vérification finale de la phase 2

**Files:** aucun fichier nouveau — tâche de vérification globale.

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les tests passent, y compris `tests/unit/access-import.test.ts` et `tests/unit/access-db/import-server.test.ts` (nécessite `docker compose up -d db` actif sur le port 5435 de ce worktree).

- [ ] **Step 2: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: aucune erreur nouvelle dans `lib/access/`, `app/api/access/`, `app/(dashboard)/access/`, `components/access/`. Les avertissements préexistants ailleurs dans le projet (ex. `components/layout/Sidebar.tsx`, déjà connus depuis la phase 1) sont acceptables.

- [ ] **Step 4: Build de production**

Run: `npm run build`
Expected: build réussi ; `/access/assets/import`, `/api/access/imports`, `/api/access/imports/catalogue-seed`, `/api/access/imports/catalogue-seed/[batchId]/commit`, `/api/access/imports/baseline`, `/api/access/imports/baseline/[batchId]/commit` apparaissent dans la sortie du build.

- [ ] **Step 5: Revue manuelle des 5 points du Review Focus**

Reprendre la liste « Review Focus » en tête de ce document et confirmer pour chacun qu'un test réel existe et passe (pas seulement mentionné dans un commentaire) :
1. Département `"NULL"` littéral — Tâche 2, test « conserve la chaîne littérale NULL ».
2. Deux niveaux différents pour le même (user_id, asset_id) dans un fichier → CONFLICT bloquant — Tâche 2 (`classifyBaselineRows`) + Tâche 4 (test dédié).
3. Ré-upload d'un fichier déjà commité → no-op complet — Tâche 4, test dédié.
4. `access_level_id` d'un autre actif → UNRESOLVED — Tâche 4, test dédié.
5. Revalidation détecte un changement entre prévisualisation et commit → bloque — Tâche 4, test dédié (niveau archivé entretemps).

Si un point manque un test réel, l'ajouter avant de considérer la phase 2 terminée.

- [ ] **Step 6: Vérification manuelle en navigateur**

Build de production locale (`npm run build && npm start`, ou `next dev` si plus rapide pour cette vérification), connexion avec un compte détenant `ASSET_ADMINISTRATOR` effectif (voir phase 1 pour l'attribution du rôle) :
- `/access/assets` affiche le lien « Importer… » vers `/access/assets/import`.
- Upload de `tests/fixtures/access/registre_acces_2026-08-27.csv` dans le panneau seed → prévisualisation affichant 186 paires, toutes `DRAFT_CREATED` sur un catalogue vide → confirmer → 101 actifs créés, 186 niveaux, tous avec priorité/isAdmin `null`.
- Upload d'un petit fichier baseline fabriqué à la main (3-4 lignes, avec un `user_id`/`asset_id`/`access_level_id` réels de l'org de test) contenant une ligne volontairement invalide → la prévisualisation affiche le blocage, le bouton « Confirmer » est absent, un message explique qu'aucun commit partiel n'est possible.
- Corriger le fichier (retirer la ligne invalide), re-uploader → prévisualisation propre → confirmer → l'écran `/access/audit` (phase 1) affiche bien un événement `IMPORT_COMMITTED`.

- [ ] **Step 7: Commit final si des ajustements ont été faits**

```bash
git add -A
git commit -m "chore(access): vérification finale de la phase 2 (tests, types, lint, build)"
```

Si aucun ajustement n'était nécessaire, ne rien committer à cette étape.
