# Gestion des accès — Phase 2b : vues de lecture du registre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le registre d'accès (rempli par l'import de la phase 2) lisible, en lecture seule, par chaque employé (ses accès), chaque chef de département (son département actuel), chaque propriétaire/suppléant d'actif (ses actifs) et le CISO/COO (tout), sans jamais rien exposer hors portée.

**Architecture:** Un constructeur de filtre pur (`lib/access/register.ts`) traduit une portée de lecture en clause Prisma `where` et vérifie qu'une vue demandée est couverte par les portées du lecteur. Un service unique (`lib/access/register-server.ts`) recalcule les portées depuis la base à chaque requête, refuse (erreur « not found ») toute vue hors portée, puis compte et pagine **après** filtrage. Trois pages Server Components et une route `GET /api/access/assignments` appellent ce même service.

**Tech Stack:** Next.js 15 App Router (Server Components), Prisma, PostgreSQL, Zod 4, Vitest, TypeScript strict, Tailwind v4. Aucune nouvelle dépendance, aucune migration.

**Spec:** `docs/superpowers/specs/2026-09-29-access-management-phase2b-read-views-design.md` (source de vérité métier : `/Users/mariusokouin/Downloads/FEATURE-PROMPT.md` §2, §3, §12)

## Global Constraints

- **Aucun changement de schéma Prisma, aucune migration** dans cette phase (spec §8).
- `orgId` et `userId` du lecteur viennent **toujours** de la session (`auth()`), jamais d'un paramètre client.
- Filtrer par portée **avant** pagination, totaux, recherche et sérialisation (FEATURE-PROMPT §3 : « Filter by scope before pagination, totals, search, export, and serialization »).
- Les filtres utilisateur (actif, niveau, recherche) sont **toujours combinés en `AND`** avec la clause de portée — jamais en remplacement.
- « Accès courant » = `status IN (ACTIVE, EXPIRED_REMOVAL_PENDING)` ; `REVOKED` n'apparaît jamais.
- Vue hors portée → `notFound()` (page) / `404` (API), y compris pour un identifiant d'une autre organisation. Écart volontaire avec `/access/audit` (redirect / 403), documenté dans la spec §6.
- DTO sans e-mail ni champ RH ; dates en chaîne ISO avant la frontière Server → Client (convention phases 1–2).
- Le COO reste un rôle **explicite** du module ; le rôle IziPilot `MANAGEMENT` ne donne **aucune** visibilité sur le registre.
- Couleurs via tokens Tailwind du projet (`teal`, `gold`, `izi-red`, `izi-gray`, `border-soft`…), jamais d'hex en dur ; jamais de texte gold sur fond gold-lt (CLAUDE.md, WCAG).
- Dates affichées : `toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" })` (même fuseau que `components/access/AccessAuditTable.tsx`).
- Pagination : 25 lignes par page côté écrans ; API `pageSize` 1–100, défaut 25 (même forme de réponse que `/api/access/audit` : `{ data, total, page, pageSize }`).
- Tests base de données : `tests/unit/access-db/*` nécessitent PostgreSQL local (`DATABASE_URL` du `.env`, ex. `docker compose up -d db`).

## Review Focus

- **Un employé change de département** — l'ancien chef ne doit plus voir ses accès, le nouveau oui (« Current access follows the employee's current primary department »). Test : Tâche 4, « suit le département principal actuel ».
- **Le CISO demande un `departmentId` d'une autre organisation** — sa portée `ALL` couvre « tout département » ; une personne raisonnable attend une 404, pas une liste vide en 200. Tests : Tâche 4 (service) et Tâche 5 (route).
- **Un employé simple ajoute `?q=…` ou `?assetId=…` à « Mes accès »** pour tenter de voir d'autres personnes — les filtres doivent seulement affiner. Tests : Tâche 2 (`buildAssignmentQuery`), Tâches 4 et 5.
- **Suppléant d'un chef de département alors que le titulaire est disponible** — pas de vue département, 404 sur l'URL directe. Test : Tâche 4.
- **Le formulaire de filtre envoie `assetId=` (chaîne vide) pour « Toutes »** — une personne raisonnable attend « pas de filtre », pas une 400 ni une remise à zéro silencieuse des autres filtres. Test : Tâche 3.

---

## Task 1 : Correction du résolveur de portée

**Files:**
- Modify: `lib/access/scope.ts` (fonction `resolveReadScopes` et son commentaire)
- Test: `tests/unit/access-scope.test.ts`

**Interfaces:**
- Consumes: `EffectiveRole` (existant, `lib/access/scope.ts`).
- Produces: `resolveReadScopes(userId: string, effectiveRoles: EffectiveRole[], ownedAssetIds: string[]): ReadScope[]` — signature inchangée ; `OWNED_ASSETS` émis dès que `ownedAssetIds.length > 0`, quel que soit le rôle ; `ASSET_ADMINISTRATOR` n'émet plus rien. Ordre stable : `SELF`, `DEPARTMENT`…, `OWNED_ASSETS`, puis `ALL`/`AUDIT`.

- [ ] **Step 1: Mettre à jour les tests existants et en ajouter**

Dans `tests/unit/access-scope.test.ts`, remplacer le test « un propriétaire d'actif voit les affectations de ses actifs possédés » par les trois tests ci-dessous, et remplacer le test « cumule plusieurs portées sans doublon » par le dernier :

```ts
  it("un propriétaire ou suppléant d'actif voit ses actifs, sans aucun rôle du module", () => {
    expect(resolveReadScopes("u1", [], ["asset-1", "asset-2"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1", "asset-2"] },
    ]);
  });

  it("l'Administrateur des actifs sans actif possédé ne voit que lui-même", () => {
    const roles: EffectiveRole[] = [
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, [])).toEqual([{ kind: "SELF", userId: "u1" }]);
  });

  it("l'Administrateur des actifs qui possède un actif le voit comme propriétaire", () => {
    const roles: EffectiveRole[] = [
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1"] },
    ]);
  });

  it("cumule plusieurs portées dans un ordre stable", () => {
    const roles: EffectiveRole[] = [
      { role: "CISO", actsAsPrimary: true, departmentId: null },
      { role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "d1" },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1"] },
      { kind: "ALL" },
    ]);
  });
```

- [ ] **Step 2: Lancer les tests — ils doivent échouer**

Run: `npx vitest run tests/unit/access-scope.test.ts`
Expected: FAIL — « un propriétaire ou suppléant d'actif… » (seulement `SELF` retourné) et « cumule… » (`ALL` avant `DEPARTMENT`, `OWNED_ASSETS` absent).

- [ ] **Step 3: Réécrire `resolveReadScopes`**

Remplacer la fonction et son commentaire dans `lib/access/scope.ts` :

```ts
/**
 * Portées de lecture cumulées pour un utilisateur. SELF est toujours présent :
 * la spec garantit à chacun la visibilité de ses propres accès et demandes
 * (§3, invariant 8). L'ordre — SELF, puis DEPARTMENT, puis OWNED_ASSETS, puis
 * ALL/AUDIT — est stable pour des tests déterministes ; les appelants ne
 * doivent pas s'appuyer sur l'ordre pour le comportement métier.
 *
 * OWNED_ASSETS découle de la possession d'actifs (propriétaire ou suppléant,
 * `ownedAssetIds` calculé côté serveur), pas du rôle ASSET_ADMINISTRATOR : la
 * spec (§2) donne à l'administrateur le catalogue, pas les affectations
 * d'autrui (phase 2b, décision du 2026-09-29).
 */
export function resolveReadScopes(
  userId: string,
  effectiveRoles: EffectiveRole[],
  ownedAssetIds: string[]
): ReadScope[] {
  const departments: ReadScope[] = [];
  const global: ReadScope[] = [];

  for (const r of effectiveRoles) {
    if (r.role === "DEPARTMENT_HEAD" && r.departmentId) {
      departments.push({ kind: "DEPARTMENT", departmentId: r.departmentId });
    }
    if (r.role === "CISO" || r.role === "COO") {
      global.push({ kind: "ALL" });
    }
    if (r.role === "AUDIT_VIEWER") {
      global.push({ kind: "AUDIT" });
    }
  }

  return [
    { kind: "SELF", userId },
    ...departments,
    ...(ownedAssetIds.length > 0 ? [{ kind: "OWNED_ASSETS" as const, assetIds: ownedAssetIds }] : []),
    ...global,
  ];
}
```

- [ ] **Step 4: Lancer les tests — ils doivent passer**

Run: `npx vitest run tests/unit/access-scope.test.ts`
Expected: PASS (tous les tests du fichier).

- [ ] **Step 5: Commit**

```bash
git add lib/access/scope.ts tests/unit/access-scope.test.ts
git commit -m "fix(access): la portée OWNED_ASSETS découle de la possession d'actif, pas du rôle administrateur"
```

---

## Task 2 : Constructeur de filtre pur — `lib/access/register.ts`

**Files:**
- Create: `lib/access/register.ts`
- Test: `tests/unit/access-register.test.ts`

**Interfaces:**
- Consumes: `ReadScope` (`lib/access/scope.ts`).
- Produces :
  - `CURRENT_ASSIGNMENT_STATUSES: readonly ["ACTIVE", "EXPIRED_REMOVAL_PENDING"]`
  - `type RegisterView = { kind: "SELF" } | { kind: "DEPARTMENT"; departmentId: string } | { kind: "ASSET"; assetId?: string }` — `departmentId: "ALL"` = tous départements.
  - `interface RegisterFilters { assetId?: string; levelId?: string; q?: string }`
  - `scopeToAssignmentWhere(orgId: string, scope: ReadScope): Prisma.AccessAssignmentWhereInput`
  - `authorizeView(view: RegisterView, scopes: ReadScope[]): ReadScope | null`
  - `buildAssignmentQuery(orgId: string, scope: ReadScope, filters: RegisterFilters): Prisma.AccessAssignmentWhereInput`
  - `orderByForView(view: RegisterView): Prisma.AccessAssignmentOrderByWithRelationInput[]`
  - `registerNavFlags(scopes: ReadScope[]): { hasDepartmentView: boolean; hasOwnedAssetsView: boolean; canSeeAll: boolean }`
  - `formatPeriod(periodStart: string | null, periodEnd: string | null): string`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/access-register.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import {
  scopeToAssignmentWhere,
  authorizeView,
  buildAssignmentQuery,
  orderByForView,
  registerNavFlags,
  formatPeriod,
} from "@/lib/access/register";
import type { ReadScope } from "@/lib/access/scope";

const ORG = "org-1";

describe("scopeToAssignmentWhere", () => {
  it("SELF limite à l'utilisateur", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "SELF", userId: "u1" })).toEqual({
      orgId: ORG,
      userId: "u1",
    });
  });

  it("DEPARTMENT suit le département principal actuel via AccessProfile", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "DEPARTMENT", departmentId: "d1" })).toEqual({
      orgId: ORG,
      user: { accessProfile: { primaryDepartmentId: "d1" } },
    });
  });

  it("OWNED_ASSETS limite aux actifs possédés", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "OWNED_ASSETS", assetIds: ["a1", "a2"] })).toEqual({
      orgId: ORG,
      assetId: { in: ["a1", "a2"] },
    });
  });

  it("ALL couvre toute l'organisation, et seulement elle", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "ALL" })).toEqual({ orgId: ORG });
  });

  it("AUDIT et NONE ne correspondent à rien", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "AUDIT" })).toEqual({ orgId: ORG, id: { in: [] } });
    expect(scopeToAssignmentWhere(ORG, { kind: "NONE" })).toEqual({ orgId: ORG, id: { in: [] } });
  });

  it("porte orgId pour toutes les portées", () => {
    const scopes: ReadScope[] = [
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
      { kind: "OWNED_ASSETS", assetIds: ["a1"] },
      { kind: "ALL" },
      { kind: "AUDIT" },
      { kind: "NONE" },
    ];
    for (const s of scopes) {
      expect(scopeToAssignmentWhere(ORG, s)).toMatchObject({ orgId: ORG });
    }
  });
});

describe("authorizeView", () => {
  const employee: ReadScope[] = [{ kind: "SELF", userId: "u1" }];
  const headOfD1: ReadScope[] = [
    { kind: "SELF", userId: "u1" },
    { kind: "DEPARTMENT", departmentId: "d1" },
  ];
  const ciso: ReadScope[] = [{ kind: "SELF", userId: "u1" }, { kind: "ALL" }];
  const owner: ReadScope[] = [
    { kind: "SELF", userId: "u1" },
    { kind: "OWNED_ASSETS", assetIds: ["a1", "a2"] },
  ];

  it("SELF est toujours accordée", () => {
    expect(authorizeView({ kind: "SELF" }, employee)).toEqual({ kind: "SELF", userId: "u1" });
  });

  it("le chef de d1 voit d1, pas d2", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d1" }, headOfD1)).toEqual({
      kind: "DEPARTMENT",
      departmentId: "d1",
    });
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d2" }, headOfD1)).toBeNull();
  });

  it("« Toutes » est refusée à un chef de département", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "ALL" }, headOfD1)).toBeNull();
  });

  it("le CISO voit « Toutes » et n'importe quel département", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "ALL" }, ciso)).toEqual({ kind: "ALL" });
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d9" }, ciso)).toEqual({
      kind: "DEPARTMENT",
      departmentId: "d9",
    });
  });

  it("un employé simple n'a ni vue département ni vue actifs", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d1" }, employee)).toBeNull();
    expect(authorizeView({ kind: "ASSET" }, employee)).toBeNull();
  });

  it("le propriétaire voit tous ses actifs, ou un seul, jamais un actif non possédé", () => {
    expect(authorizeView({ kind: "ASSET" }, owner)).toEqual({
      kind: "OWNED_ASSETS",
      assetIds: ["a1", "a2"],
    });
    expect(authorizeView({ kind: "ASSET", assetId: "a2" }, owner)).toEqual({
      kind: "OWNED_ASSETS",
      assetIds: ["a2"],
    });
    expect(authorizeView({ kind: "ASSET", assetId: "a3" }, owner)).toBeNull();
  });

  it("le CISO sans actif possédé n'a pas la vue actifs (ALL ne la donne pas)", () => {
    expect(authorizeView({ kind: "ASSET" }, ciso)).toBeNull();
  });
});

describe("buildAssignmentQuery", () => {
  it("combine portée, statut courant et filtres en AND", () => {
    const where = buildAssignmentQuery(
      ORG,
      { kind: "SELF", userId: "u1" },
      { assetId: "a1", levelId: "l1", q: "  Awa " }
    );
    expect(where).toEqual({
      orgId: ORG,
      AND: [
        { orgId: ORG, userId: "u1" },
        { status: { in: ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] } },
        { assetId: "a1" },
        { levelId: "l1" },
        { user: { name: { contains: "Awa", mode: "insensitive" } } },
      ],
    });
  });

  it("les filtres n'élargissent jamais la portée : la clause SELF reste dans le AND, aucun OR", () => {
    const where = buildAssignmentQuery(ORG, { kind: "SELF", userId: "u1" }, { q: "autre personne" });
    expect(where.AND).toContainEqual({ orgId: ORG, userId: "u1" });
    expect(where).not.toHaveProperty("OR");
  });

  it("ignore une recherche vide ou faite d'espaces", () => {
    const where = buildAssignmentQuery(ORG, { kind: "ALL" }, { q: "   " });
    expect(where.AND).toHaveLength(2);
  });

  it("exclut toujours REVOKED", () => {
    const where = buildAssignmentQuery(ORG, { kind: "ALL" }, {});
    expect(where.AND).toContainEqual({ status: { in: ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] } });
  });
});

describe("orderByForView", () => {
  it("vue département : par employé puis actif", () => {
    expect(orderByForView({ kind: "DEPARTMENT", departmentId: "d1" })).toEqual([
      { user: { name: "asc" } },
      { asset: { name: "asc" } },
      { id: "asc" },
    ]);
  });

  it("vue « Toutes » : par département, puis employé", () => {
    expect(orderByForView({ kind: "DEPARTMENT", departmentId: "ALL" })).toEqual([
      { user: { accessProfile: { primaryDepartment: { name: "asc" } } } },
      { user: { name: "asc" } },
      { asset: { name: "asc" } },
      { id: "asc" },
    ]);
  });

  it("mes accès et vue actifs : par actif puis employé", () => {
    const expected = [{ asset: { name: "asc" } }, { user: { name: "asc" } }, { id: "asc" }];
    expect(orderByForView({ kind: "SELF" })).toEqual(expected);
    expect(orderByForView({ kind: "ASSET" })).toEqual(expected);
  });
});

describe("registerNavFlags", () => {
  it("employé simple : aucune vue supplémentaire", () => {
    expect(registerNavFlags([{ kind: "SELF", userId: "u1" }])).toEqual({
      hasDepartmentView: false,
      hasOwnedAssetsView: false,
      canSeeAll: false,
    });
  });

  it("CISO : vue département et « Toutes », pas de vue actifs", () => {
    expect(registerNavFlags([{ kind: "SELF", userId: "u1" }, { kind: "ALL" }])).toEqual({
      hasDepartmentView: true,
      hasOwnedAssetsView: false,
      canSeeAll: true,
    });
  });

  it("chef + propriétaire", () => {
    expect(
      registerNavFlags([
        { kind: "SELF", userId: "u1" },
        { kind: "DEPARTMENT", departmentId: "d1" },
        { kind: "OWNED_ASSETS", assetIds: ["a1"] },
      ])
    ).toEqual({ hasDepartmentView: true, hasOwnedAssetsView: true, canSeeAll: false });
  });

  it("AUDIT ne donne aucune vue du registre", () => {
    expect(registerNavFlags([{ kind: "SELF", userId: "u1" }, { kind: "AUDIT" }])).toEqual({
      hasDepartmentView: false,
      hasOwnedAssetsView: false,
      canSeeAll: false,
    });
  });
});

describe("formatPeriod", () => {
  it("période inconnue (cas des accès importés)", () => {
    expect(formatPeriod(null, null)).toBe("Non renseignée");
  });

  it("début seul : en cours", () => {
    expect(formatPeriod("2026-03-01T10:00:00.000Z", null)).toBe("Depuis le 01/03/2026 · en cours");
  });

  it("début et fin", () => {
    expect(formatPeriod("2026-03-01T10:00:00.000Z", "2026-06-30T10:00:00.000Z")).toBe(
      "01/03/2026 → 30/06/2026"
    );
  });

  it("fin seule", () => {
    expect(formatPeriod(null, "2026-06-30T10:00:00.000Z")).toBe("Jusqu'au 30/06/2026");
  });
});
```

- [ ] **Step 2: Lancer les tests — ils doivent échouer**

Run: `npx vitest run tests/unit/access-register.test.ts`
Expected: FAIL — `Cannot find module '@/lib/access/register'` (ou équivalent).

- [ ] **Step 3: Implémenter `lib/access/register.ts`**

```ts
// lib/access/register.ts
// Vues de lecture du registre (phase 2b) — logique pure, sans accès base.
// Toute requête du registre passe par buildAssignmentQuery : la clause de
// portée est toujours un terme d'un AND, les filtres utilisateur ne peuvent
// donc qu'affiner (FEATURE-PROMPT §3 : filtrer par portée avant pagination,
// totaux, recherche et sérialisation).
import type { Prisma } from "@prisma/client";
import type { ReadScope } from "./scope";

export const CURRENT_ASSIGNMENT_STATUSES = ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] as const;

export type RegisterView =
  | { kind: "SELF" }
  | { kind: "DEPARTMENT"; departmentId: string } // "ALL" = tous départements
  | { kind: "ASSET"; assetId?: string };

export interface RegisterFilters {
  assetId?: string;
  levelId?: string;
  q?: string;
}

export function scopeToAssignmentWhere(
  orgId: string,
  scope: ReadScope
): Prisma.AccessAssignmentWhereInput {
  switch (scope.kind) {
    case "SELF":
      return { orgId, userId: scope.userId };
    case "DEPARTMENT":
      return { orgId, user: { accessProfile: { primaryDepartmentId: scope.departmentId } } };
    case "OWNED_ASSETS":
      return { orgId, assetId: { in: scope.assetIds } };
    case "ALL":
      return { orgId };
    case "AUDIT":
    case "NONE":
      // AUDIT donne le journal d'audit, pas le registre.
      return { orgId, id: { in: [] } };
  }
}

/**
 * Portée effective à appliquer pour la vue demandée, ou null si aucune des
 * portées du lecteur ne la couvre. Un département précis est couvert par sa
 * propre portée DEPARTMENT ou par ALL ; « Toutes » exige ALL ; la vue actifs
 * exige OWNED_ASSETS (ALL ne la donne pas — elle est propre aux propriétaires).
 */
export function authorizeView(view: RegisterView, scopes: ReadScope[]): ReadScope | null {
  switch (view.kind) {
    case "SELF":
      return scopes.find((s) => s.kind === "SELF") ?? null;
    case "DEPARTMENT": {
      const hasAll = scopes.some((s) => s.kind === "ALL");
      if (view.departmentId === "ALL") return hasAll ? { kind: "ALL" } : null;
      const own = scopes.find(
        (s) => s.kind === "DEPARTMENT" && s.departmentId === view.departmentId
      );
      if (own) return own;
      return hasAll ? { kind: "DEPARTMENT", departmentId: view.departmentId } : null;
    }
    case "ASSET": {
      const owned = scopes.find(
        (s): s is Extract<ReadScope, { kind: "OWNED_ASSETS" }> => s.kind === "OWNED_ASSETS"
      );
      if (!owned) return null;
      if (!view.assetId) return owned;
      return owned.assetIds.includes(view.assetId)
        ? { kind: "OWNED_ASSETS", assetIds: [view.assetId] }
        : null;
    }
  }
}

export function buildAssignmentQuery(
  orgId: string,
  scope: ReadScope,
  filters: RegisterFilters
): Prisma.AccessAssignmentWhereInput {
  const and: Prisma.AccessAssignmentWhereInput[] = [
    scopeToAssignmentWhere(orgId, scope),
    { status: { in: [...CURRENT_ASSIGNMENT_STATUSES] } },
  ];
  if (filters.assetId) and.push({ assetId: filters.assetId });
  if (filters.levelId) and.push({ levelId: filters.levelId });
  const q = filters.q?.trim();
  if (q) and.push({ user: { name: { contains: q, mode: "insensitive" } } });
  return { orgId, AND: and };
}

export function orderByForView(
  view: RegisterView
): Prisma.AccessAssignmentOrderByWithRelationInput[] {
  if (view.kind === "DEPARTMENT" && view.departmentId === "ALL") {
    // Tri via relations optionnelles (LEFT JOIN) : PostgreSQL place les
    // employés sans département principal en dernier en tri ascendant.
    return [
      { user: { accessProfile: { primaryDepartment: { name: "asc" } } } },
      { user: { name: "asc" } },
      { asset: { name: "asc" } },
      { id: "asc" },
    ];
  }
  if (view.kind === "DEPARTMENT") {
    return [{ user: { name: "asc" } }, { asset: { name: "asc" } }, { id: "asc" }];
  }
  return [{ asset: { name: "asc" } }, { user: { name: "asc" } }, { id: "asc" }];
}

export function registerNavFlags(scopes: ReadScope[]): {
  hasDepartmentView: boolean;
  hasOwnedAssetsView: boolean;
  canSeeAll: boolean;
} {
  const canSeeAll = scopes.some((s) => s.kind === "ALL");
  return {
    hasDepartmentView: canSeeAll || scopes.some((s) => s.kind === "DEPARTMENT"),
    hasOwnedAssetsView: scopes.some((s) => s.kind === "OWNED_ASSETS"),
    canSeeAll,
  };
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}

export function formatPeriod(periodStart: string | null, periodEnd: string | null): string {
  if (periodStart && periodEnd) return `${formatDay(periodStart)} → ${formatDay(periodEnd)}`;
  if (periodStart) return `Depuis le ${formatDay(periodStart)} · en cours`;
  if (periodEnd) return `Jusqu'au ${formatDay(periodEnd)}`;
  return "Non renseignée";
}
```

- [ ] **Step 4: Lancer les tests et vérifier les types**

Run: `npx vitest run tests/unit/access-register.test.ts && npx tsc --noEmit`
Expected: PASS ; aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/register.ts tests/unit/access-register.test.ts
git commit -m "feat(access): constructeur de filtre du registre (portées → clauses Prisma)"
```

---

## Task 3 : Schéma de requête Zod et traduction en vue

**Files:**
- Modify: `lib/validations/access.ts` (ajout en fin de fichier)
- Modify: `lib/access/register.ts` (ajout de `registerRequestFromQuery`)
- Test: `tests/unit/access-register.test.ts` (ajout d'un `describe`)

**Interfaces:**
- Consumes: `RegisterView`, `RegisterFilters` (Tâche 2).
- Produces :
  - `registerQuerySchema` (Zod) et `type RegisterQuery = z.infer<typeof registerQuerySchema>` — `view: "me" | "department" | "owned-assets"` (défaut `"me"`), `departmentId?`, `assetId?`, `levelId?`, `q?`, `page: number` (défaut 1), `pageSize: number` (1–100, défaut 25). Une chaîne vide vaut « absent ».
  - `registerRequestFromQuery(query: RegisterQuery): { view: RegisterView; filters: RegisterFilters } | null` — `null` si `view: "department"` sans `departmentId`.

- [ ] **Step 1: Écrire les tests**

Dans `tests/unit/access-register.test.ts`, ajouter `registerRequestFromQuery` à l'import existant de `@/lib/access/register`, ajouter l'import :

```ts
import { registerQuerySchema } from "@/lib/validations/access";
```

puis en fin de fichier :

```ts
describe("registerQuerySchema + registerRequestFromQuery", () => {
  it("valeurs par défaut", () => {
    const parsed = registerQuerySchema.parse({});
    expect(parsed).toEqual({ view: "me", page: 1, pageSize: 25 });
    expect(registerRequestFromQuery(parsed)).toEqual({ view: { kind: "SELF" }, filters: {} });
  });

  it("une chaîne vide (option « Toutes » d'un formulaire GET) vaut absent, sans perdre les autres filtres", () => {
    const parsed = registerQuerySchema.parse({
      view: "department",
      departmentId: "d1",
      assetId: "",
      levelId: "",
      q: "Awa",
      page: "2",
    });
    expect(parsed).toEqual({
      view: "department",
      departmentId: "d1",
      q: "Awa",
      page: 2,
      pageSize: 25,
    });
  });

  it("rejette une page non numérique et un pageSize trop grand", () => {
    expect(registerQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
    expect(registerQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });

  it("rejette une recherche de plus de 100 caractères", () => {
    expect(registerQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });

  it("vue département : departmentId obligatoire, assetId devient un filtre", () => {
    expect(registerRequestFromQuery(registerQuerySchema.parse({ view: "department" }))).toBeNull();
    expect(
      registerRequestFromQuery(
        registerQuerySchema.parse({ view: "department", departmentId: "ALL", assetId: "a1" })
      )
    ).toEqual({
      view: { kind: "DEPARTMENT", departmentId: "ALL" },
      filters: { assetId: "a1" },
    });
  });

  it("vue actifs : assetId restreint la vue elle-même, pas un filtre", () => {
    expect(
      registerRequestFromQuery(
        registerQuerySchema.parse({ view: "owned-assets", assetId: "a1", levelId: "l1" })
      )
    ).toEqual({
      view: { kind: "ASSET", assetId: "a1" },
      filters: { levelId: "l1" },
    });
  });
});
```

- [ ] **Step 2: Lancer les tests — ils doivent échouer**

Run: `npx vitest run tests/unit/access-register.test.ts`
Expected: FAIL — `registerQuerySchema` / `registerRequestFromQuery` introuvables.

- [ ] **Step 3: Ajouter le schéma dans `lib/validations/access.ts`**

En fin de fichier :

```ts
// ── Registre — vues de lecture (phase 2b) ────────────────────────────────
// Un formulaire GET envoie "" pour l'option « Toutes » : on la traite comme
// absente plutôt que de faire échouer toute la requête.
// (.optional().transform plutôt que z.preprocess : en Zod 4, un preprocess
// autour d'un champ optionnel peut rendre la clé obligatoire.)
const optionalId = z
  .string()
  .max(64)
  .optional()
  .transform((v) => (v ? v : undefined));

export const registerQuerySchema = z.object({
  view: z.enum(["me", "department", "owned-assets"]).default("me"),
  departmentId: optionalId,
  assetId: optionalId,
  levelId: optionalId,
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type RegisterQuery = z.infer<typeof registerQuerySchema>;
```

- [ ] **Step 4: Ajouter `registerRequestFromQuery` dans `lib/access/register.ts`**

Ajouter l'import en tête du fichier :

```ts
import type { RegisterQuery } from "@/lib/validations/access";
```

et en fin de fichier :

```ts
/**
 * Traduit une requête validée en vue + filtres. Pour la vue actifs, assetId
 * restreint la vue (et passe donc par authorizeView) ; pour les autres vues,
 * c'est un simple filtre combiné en AND.
 */
export function registerRequestFromQuery(
  query: RegisterQuery
): { view: RegisterView; filters: RegisterFilters } | null {
  const filters: RegisterFilters = {};
  if (query.levelId) filters.levelId = query.levelId;
  if (query.q) filters.q = query.q;

  if (query.view === "owned-assets") {
    return { view: { kind: "ASSET", ...(query.assetId && { assetId: query.assetId }) }, filters };
  }
  if (query.assetId) filters.assetId = query.assetId;
  if (query.view === "department") {
    if (!query.departmentId) return null;
    return { view: { kind: "DEPARTMENT", departmentId: query.departmentId }, filters };
  }
  return { view: { kind: "SELF" }, filters };
}
```

- [ ] **Step 5: Lancer les tests et vérifier les types**

Run: `npx vitest run tests/unit/access-register.test.ts && npx tsc --noEmit`
Expected: PASS ; aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add lib/validations/access.ts lib/access/register.ts tests/unit/access-register.test.ts
git commit -m "feat(access): schéma de requête du registre (Zod) et traduction en vue"
```

---

## Task 4 : Service de lecture — `lib/access/register-server.ts`

**Files:**
- Create: `lib/access/register-server.ts`
- Test: `tests/unit/access-db/register-server.test.ts`

**Interfaces:**
- Consumes: `getEffectiveRoleHolders(orgId: string, userId: string): Promise<EffectiveRole[]>` (`lib/access/roles-server.ts`), `resolveReadScopes` (Tâche 1), `authorizeView`, `buildAssignmentQuery`, `orderByForView`, `registerNavFlags`, `RegisterView`, `RegisterFilters` (Tâche 2).
- Produces :
  - `class RegisterNotFoundError extends Error`
  - `interface AssignmentRowDTO { id: string; userId: string; userName: string; departmentName: string | null; lifecycle: AccessLifecycle | null; assetId: string; assetName: string; assetArchived: boolean; levelName: string | null; status: AccessAssignmentStatus; verification: AccessVerification | null; source: AccessAssignmentSource; periodStart: string | null; periodEnd: string | null }` (enums importés de `@prisma/client`)
  - `getOwnedAssetIds(orgId: string, userId: string): Promise<string[]>`
  - `getViewerScopes(orgId: string, userId: string): Promise<ReadScope[]>`
  - `listAssignments(input: { viewer: { userId: string; orgId: string }; view: RegisterView; filters: RegisterFilters; pagination: { page: number; pageSize: number } }): Promise<{ rows: AssignmentRowDTO[]; total: number }>`
  - `interface RegisterNav { hasDepartmentView: boolean; hasOwnedAssetsView: boolean; canSeeAll: boolean; defaultDepartmentId: string | null; departments: { id: string; name: string }[]; ownedAssets: { id: string; name: string; levels: { id: string; name: string }[] }[] }`
  - `getRegisterNav(orgId: string, userId: string): Promise<RegisterNav>`
  - `listAssetOptions(orgId: string): Promise<{ id: string; name: string }[]>`

- [ ] **Step 1: Écrire les tests (base réelle)**

Créer `tests/unit/access-db/register-server.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listAssignments,
  getOwnedAssetIds,
  getRegisterNav,
  RegisterNotFoundError,
} from "@/lib/access/register-server";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("register-server — vues de lecture du registre", () => {
  let orgId: string;
  let otherOrgId: string;
  let otherDeptId: string;
  const u: Record<string, string> = {};
  let d1: string;
  let d2: string;
  let assetX: string;
  let assetY: string;
  let assetArchived: string;

  async function createUser(orgIdArg: string, label: string) {
    const user = await prisma.user.create({
      data: {
        orgId: orgIdArg,
        email: `test-register-${label}-${stamp}@example.com`,
        name: `Register ${label}`,
        role: "PO",
      },
    });
    return user.id;
  }

  beforeAll(async () => {
    orgId = (await prisma.organization.create({
      data: { name: "Test Register Org", slug: `test-register-${stamp}` },
    })).id;
    otherOrgId = (await prisma.organization.create({
      data: { name: "Test Register Other Org", slug: `test-register-other-${stamp}` },
    })).id;

    for (const label of ["head1", "head2", "backupHead1", "emp1", "emp2", "ciso", "owner", "backupOwner", "adminOnly", "plain"]) {
      u[label] = await createUser(orgId, label);
    }
    const otherOwner = await createUser(otherOrgId, "otherOwner");

    d1 = (await prisma.department.create({
      data: { orgId, code: `RG1-${stamp}`, name: "Register D1", color: "#000000", ownerId: u.head1 },
    })).id;
    d2 = (await prisma.department.create({
      data: { orgId, code: `RG2-${stamp}`, name: "Register D2", color: "#000000", ownerId: u.head2 },
    })).id;
    otherDeptId = (await prisma.department.create({
      data: { orgId: otherOrgId, code: `RGX-${stamp}`, name: "Other D", color: "#000000", ownerId: otherOwner },
    })).id;

    await prisma.accessProfile.createMany({
      data: [
        { orgId, userId: u.emp1, primaryDepartmentId: d1 },
        { orgId, userId: u.emp2, primaryDepartmentId: d2 },
        { orgId, userId: u.head1, primaryDepartmentId: d1 },
        { orgId, userId: u.plain, primaryDepartmentId: null },
      ],
    });

    // Suppléant de d1, titulaire (head1) disponible et non marqué indisponible.
    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "DEPARTMENT_HEAD", departmentId: d1, backupUserId: u.backupHead1 },
    });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: u.ciso } });
    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "ASSET_ADMINISTRATOR", userId: u.adminOnly },
    });

    assetX = (await prisma.accessAsset.create({
      data: { orgId, name: `Register X ${stamp}`, ownerId: u.owner, backupOwnerId: u.backupOwner },
    })).id;
    assetY = (await prisma.accessAsset.create({ data: { orgId, name: `Register Y ${stamp}` } })).id;
    assetArchived = (await prisma.accessAsset.create({
      data: { orgId, name: `Register Z ${stamp}`, ownerId: u.owner, archivedAt: new Date() },
    })).id;

    await prisma.accessAssignment.createMany({
      data: [
        { orgId, userId: u.emp1, assetId: assetX, status: "ACTIVE", verification: "IMPORTED_UNREVIEWED" },
        { orgId, userId: u.emp1, assetId: assetY, status: "EXPIRED_REMOVAL_PENDING" },
        { orgId, userId: u.emp2, assetId: assetX, status: "ACTIVE" },
        { orgId, userId: u.emp2, assetId: assetY, status: "REVOKED" },
        { orgId, userId: u.head1, assetId: assetY, status: "ACTIVE" },
        { orgId, userId: u.plain, assetId: assetArchived, status: "ACTIVE" },
      ],
    });
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await prisma.accessAssignment.deleteMany({ where: { orgId: id } });
      await prisma.accessAsset.deleteMany({ where: { orgId: id } });
      await prisma.accessRoleAssignment.deleteMany({ where: { orgId: id } });
      await prisma.accessProfile.deleteMany({ where: { orgId: id } });
      await prisma.department.deleteMany({ where: { orgId: id } });
      await prisma.user.deleteMany({ where: { orgId: id } });
      await prisma.organization.delete({ where: { id } });
    }
  });

  const page = { page: 1, pageSize: 25 };
  const viewer = (label: string) => ({ userId: u[label], orgId });

  it("Mes accès : uniquement les siens, REVOKED exclu, retrait en attente inclus", async () => {
    const { rows, total } = await listAssignments({
      viewer: viewer("emp1"), view: { kind: "SELF" }, filters: {}, pagination: page,
    });
    expect(total).toBe(2);
    expect(rows.every((r) => r.userId === u.emp1)).toBe(true);
    expect(rows.map((r) => r.status).sort()).toEqual(["ACTIVE", "EXPIRED_REMOVAL_PENDING"]);
    const x = rows.find((r) => r.assetId === assetX)!;
    expect(x.departmentName).toBe("Register D1");
    expect(x.verification).toBe("IMPORTED_UNREVIEWED");
    expect(x).not.toHaveProperty("email");
  });

  it("Mes accès : une recherche sur un autre nom ne révèle rien", async () => {
    const { rows, total } = await listAssignments({
      viewer: viewer("emp1"), view: { kind: "SELF" }, filters: { q: "emp2" }, pagination: page,
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it("chef de d1 : voit d1, pas d2", async () => {
    const { rows } = await listAssignments({
      viewer: viewer("head1"), view: { kind: "DEPARTMENT", departmentId: d1 }, filters: {}, pagination: page,
    });
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([u.emp1, u.head1]));
    await expect(
      listAssignments({
        viewer: viewer("head1"), view: { kind: "DEPARTMENT", departmentId: d2 }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("suppléant de chef avec titulaire disponible : pas de vue département", async () => {
    await expect(
      listAssignments({
        viewer: viewer("backupHead1"), view: { kind: "DEPARTMENT", departmentId: d1 }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("suit le département principal actuel", async () => {
    await prisma.accessProfile.update({ where: { userId: u.emp1 }, data: { primaryDepartmentId: d2 } });
    try {
      const d1Rows = await listAssignments({
        viewer: viewer("head1"), view: { kind: "DEPARTMENT", departmentId: d1 }, filters: {}, pagination: page,
      });
      expect(d1Rows.rows.some((r) => r.userId === u.emp1)).toBe(false);
      const d2Rows = await listAssignments({
        viewer: viewer("head2"), view: { kind: "DEPARTMENT", departmentId: d2 }, filters: {}, pagination: page,
      });
      expect(d2Rows.rows.some((r) => r.userId === u.emp1)).toBe(true);
    } finally {
      await prisma.accessProfile.update({ where: { userId: u.emp1 }, data: { primaryDepartmentId: d1 } });
    }
  });

  it("CISO : « Toutes » couvre l'org, n'importe quel département, et « Sans département » en dernier", async () => {
    const all = await listAssignments({
      viewer: viewer("ciso"), view: { kind: "DEPARTMENT", departmentId: "ALL" }, filters: {}, pagination: page,
    });
    expect(all.total).toBe(5); // 6 affectations − 1 REVOKED
    expect(all.rows.at(-1)?.departmentName).toBeNull(); // « plain », sans département
    const d2Rows = await listAssignments({
      viewer: viewer("ciso"), view: { kind: "DEPARTMENT", departmentId: d2 }, filters: {}, pagination: page,
    });
    expect(d2Rows.rows.map((r) => r.userId)).toEqual([u.emp2]);
  });

  it("CISO : un département d'une autre organisation donne NOT_FOUND, pas une liste vide", async () => {
    await expect(
      listAssignments({
        viewer: viewer("ciso"), view: { kind: "DEPARTMENT", departmentId: otherDeptId }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("propriétaire et suppléant d'actif voient toutes les affectations de l'actif, tous départements", async () => {
    for (const label of ["owner", "backupOwner"]) {
      const { rows } = await listAssignments({
        viewer: viewer(label), view: { kind: "ASSET" }, filters: {}, pagination: page,
      });
      expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([u.emp1, u.emp2]));
      expect(rows.every((r) => r.assetId === assetX)).toBe(true);
    }
  });

  it("actif archivé : hors de la portée propriétaire, mais visible dans Mes accès", async () => {
    expect(await getOwnedAssetIds(orgId, u.owner)).toEqual([assetX]);
    await expect(
      listAssignments({
        viewer: viewer("owner"), view: { kind: "ASSET", assetId: assetArchived }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
    const mine = await listAssignments({
      viewer: viewer("plain"), view: { kind: "SELF" }, filters: {}, pagination: page,
    });
    expect(mine.rows[0]?.assetArchived).toBe(true);
  });

  it("Administrateur des actifs sans actif possédé : pas de vue actifs", async () => {
    await expect(
      listAssignments({ viewer: viewer("adminOnly"), view: { kind: "ASSET" }, filters: {}, pagination: page })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("le total est compté après filtrage et avant pagination", async () => {
    const { rows, total } = await listAssignments({
      viewer: viewer("ciso"),
      view: { kind: "DEPARTMENT", departmentId: "ALL" },
      filters: { assetId: assetX },
      pagination: { page: 1, pageSize: 1 },
    });
    expect(total).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it("getRegisterNav reflète les portées", async () => {
    const plain = await getRegisterNav(orgId, u.plain);
    expect(plain).toMatchObject({
      hasDepartmentView: false, hasOwnedAssetsView: false, canSeeAll: false, defaultDepartmentId: null,
    });

    const head = await getRegisterNav(orgId, u.head1);
    expect(head).toMatchObject({ hasDepartmentView: true, canSeeAll: false, defaultDepartmentId: d1 });
    expect(head.departments.map((d) => d.id)).toEqual([d1]);

    const ciso = await getRegisterNav(orgId, u.ciso);
    expect(ciso).toMatchObject({ hasDepartmentView: true, canSeeAll: true, defaultDepartmentId: "ALL" });
    expect(ciso.departments.map((d) => d.id).sort()).toEqual([d1, d2].sort());

    const owner = await getRegisterNav(orgId, u.owner);
    expect(owner.hasOwnedAssetsView).toBe(true);
    expect(owner.ownedAssets.map((a) => a.id)).toEqual([assetX]);
  });
});
```

- [ ] **Step 2: Lancer les tests — ils doivent échouer**

Run: `npx vitest run tests/unit/access-db/register-server.test.ts`
Expected: FAIL — module `@/lib/access/register-server` introuvable.

- [ ] **Step 3: Implémenter `lib/access/register-server.ts`**

```ts
// lib/access/register-server.ts
// Service de lecture du registre (phase 2b). Les portées sont recalculées
// depuis la base à chaque appel — jamais reçues du client. Toute vue non
// couverte lève RegisterNotFoundError (404 côté API, notFound() côté page).
import type {
  AccessAssignmentSource,
  AccessAssignmentStatus,
  AccessLifecycle,
  AccessVerification,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "./roles-server";
import { resolveReadScopes, type ReadScope } from "./scope";
import {
  authorizeView,
  buildAssignmentQuery,
  orderByForView,
  registerNavFlags,
  type RegisterFilters,
  type RegisterView,
} from "./register";

export class RegisterNotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "RegisterNotFoundError";
  }
}

export interface AssignmentRowDTO {
  id: string;
  userId: string;
  userName: string;
  departmentName: string | null;
  lifecycle: AccessLifecycle | null;
  assetId: string;
  assetName: string;
  assetArchived: boolean;
  levelName: string | null;
  status: AccessAssignmentStatus;
  verification: AccessVerification | null;
  source: AccessAssignmentSource;
  periodStart: string | null;
  periodEnd: string | null;
}

export async function getOwnedAssetIds(orgId: string, userId: string): Promise<string[]> {
  const assets = await prisma.accessAsset.findMany({
    where: { orgId, archivedAt: null, OR: [{ ownerId: userId }, { backupOwnerId: userId }] },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return assets.map((a) => a.id);
}

export async function getViewerScopes(orgId: string, userId: string): Promise<ReadScope[]> {
  const [roles, ownedAssetIds] = await Promise.all([
    getEffectiveRoleHolders(orgId, userId),
    getOwnedAssetIds(orgId, userId),
  ]);
  return resolveReadScopes(userId, roles, ownedAssetIds);
}

export async function listAssignments(input: {
  viewer: { userId: string; orgId: string };
  view: RegisterView;
  filters: RegisterFilters;
  pagination: { page: number; pageSize: number };
}): Promise<{ rows: AssignmentRowDTO[]; total: number }> {
  const { viewer, view, filters, pagination } = input;

  const scopes = await getViewerScopes(viewer.orgId, viewer.userId);
  const scope = authorizeView(view, scopes);
  if (!scope) throw new RegisterNotFoundError();

  // ALL couvre « n'importe quel département » : sans cette vérification, un
  // departmentId d'une autre organisation renverrait une liste vide en 200
  // au lieu d'une 404 (spec §6).
  if (view.kind === "DEPARTMENT" && view.departmentId !== "ALL") {
    const dept = await prisma.department.findFirst({
      where: { id: view.departmentId, orgId: viewer.orgId },
      select: { id: true },
    });
    if (!dept) throw new RegisterNotFoundError();
  }

  const where = buildAssignmentQuery(viewer.orgId, scope, filters);
  const [total, rows] = await prisma.$transaction([
    prisma.accessAssignment.count({ where }),
    prisma.accessAssignment.findMany({
      where,
      orderBy: orderByForView(view),
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        status: true,
        verification: true,
        source: true,
        periodStart: true,
        periodEnd: true,
        user: {
          select: {
            id: true,
            name: true,
            accessProfile: {
              select: { lifecycle: true, primaryDepartment: { select: { name: true } } },
            },
          },
        },
        asset: { select: { id: true, name: true, archivedAt: true } },
        level: { select: { name: true } },
      },
    }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      userId: r.user.id,
      userName: r.user.name,
      departmentName: r.user.accessProfile?.primaryDepartment?.name ?? null,
      lifecycle: r.user.accessProfile?.lifecycle ?? null,
      assetId: r.asset.id,
      assetName: r.asset.name,
      assetArchived: r.asset.archivedAt !== null,
      levelName: r.level?.name ?? null,
      status: r.status,
      verification: r.verification,
      source: r.source,
      periodStart: r.periodStart?.toISOString() ?? null,
      periodEnd: r.periodEnd?.toISOString() ?? null,
    })),
  };
}

export interface RegisterNav {
  hasDepartmentView: boolean;
  hasOwnedAssetsView: boolean;
  canSeeAll: boolean;
  /** Département affiché par défaut : le sien d'abord, sinon « Toutes ». */
  defaultDepartmentId: string | null;
  departments: { id: string; name: string }[];
  ownedAssets: { id: string; name: string; levels: { id: string; name: string }[] }[];
}

export async function getRegisterNav(orgId: string, userId: string): Promise<RegisterNav> {
  const scopes = await getViewerScopes(orgId, userId);
  const flags = registerNavFlags(scopes);
  const ownDepartmentIds = scopes.flatMap((s) => (s.kind === "DEPARTMENT" ? [s.departmentId] : []));
  const ownedAssetIds = scopes.flatMap((s) => (s.kind === "OWNED_ASSETS" ? s.assetIds : []));

  const [departments, ownedAssets] = await Promise.all([
    flags.hasDepartmentView
      ? prisma.department.findMany({
          where: { orgId, ...(flags.canSeeAll ? {} : { id: { in: ownDepartmentIds } }) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    ownedAssetIds.length
      ? prisma.accessAsset.findMany({
          where: { orgId, id: { in: ownedAssetIds } },
          select: {
            id: true,
            name: true,
            levels: {
              where: { archivedAt: null },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return {
    ...flags,
    defaultDepartmentId: ownDepartmentIds[0] ?? (flags.canSeeAll ? "ALL" : null),
    departments,
    ownedAssets,
  };
}

/** Options du filtre « application » de la vue département (catalogue non archivé). */
export async function listAssetOptions(orgId: string): Promise<{ id: string; name: string }[]> {
  return prisma.accessAsset.findMany({
    where: { orgId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
```

- [ ] **Step 4: Lancer les tests — ils doivent passer**

Run: `npx vitest run tests/unit/access-db/register-server.test.ts`
Expected: PASS (base locale démarrée).

- [ ] **Step 5: Vérifier types et suites voisines**

Run: `npx tsc --noEmit && npx vitest run tests/unit/access-db tests/unit/access-scope.test.ts tests/unit/access-register.test.ts`
Expected: aucune erreur de type ; toutes les suites passent (dont `roles-server.test.ts`, inchangé).

- [ ] **Step 6: Commit**

```bash
git add lib/access/register-server.ts tests/unit/access-db/register-server.test.ts
git commit -m "feat(access): service de lecture du registre filtré par portée"
```

---

## Task 5 : Route API — `GET /api/access/assignments`

**Files:**
- Create: `app/api/access/assignments/route.ts`
- Test: `tests/unit/access-db/assignments-route.test.ts`

**Interfaces:**
- Consumes: `auth()` (`lib/auth.ts`, session `{ user: { id, orgId } }`), `registerQuerySchema`, `registerRequestFromQuery` (Tâche 3), `listAssignments`, `RegisterNotFoundError` (Tâche 4).
- Produces: `GET /api/access/assignments?view=me|department|owned-assets&departmentId=&assetId=&levelId=&q=&page=&pageSize=` → `200 { data: AssignmentRowDTO[], total, page, pageSize }` ; `400 { error, details }` ; `401` sans session ; `404 { error: "Not found" }` hors portée.

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/access-db/assignments-route.test.ts`. C'est le premier test de route du projet : on appelle directement le handler `GET` avec une `Request`, et on remplace `auth()` par un mock pour choisir le lecteur.

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// vi.mock est hissé au-dessus des imports : le mock doit être créé par vi.hoisted.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: () => sessionMock() }));

import { GET } from "@/app/api/access/assignments/route";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("GET /api/access/assignments", () => {
  let orgId: string;
  let otherOrgId: string;
  let otherDeptId: string;
  let d1: string;
  const u: Record<string, string> = {};

  async function call(query: string, as: string | null) {
    sessionMock.mockResolvedValue(as ? { user: { id: u[as], orgId } } : null);
    return GET(new Request(`http://localhost/api/access/assignments?${query}`));
  }

  beforeAll(async () => {
    orgId = (await prisma.organization.create({
      data: { name: "Test Route Org", slug: `test-route-${stamp}` },
    })).id;
    otherOrgId = (await prisma.organization.create({
      data: { name: "Test Route Other", slug: `test-route-other-${stamp}` },
    })).id;
    for (const label of ["head", "emp", "ciso"]) {
      u[label] = (await prisma.user.create({
        data: { orgId, email: `test-route-${label}-${stamp}@example.com`, name: `Route ${label}`, role: "PO" },
      })).id;
    }
    const otherUser = (await prisma.user.create({
      data: { orgId: otherOrgId, email: `test-route-other-${stamp}@example.com`, name: "Route other", role: "PO" },
    })).id;
    d1 = (await prisma.department.create({
      data: { orgId, code: `RT1-${stamp}`, name: "Route D1", color: "#000000", ownerId: u.head },
    })).id;
    otherDeptId = (await prisma.department.create({
      data: { orgId: otherOrgId, code: `RTX-${stamp}`, name: "Route DX", color: "#000000", ownerId: otherUser },
    })).id;
    await prisma.accessProfile.create({ data: { orgId, userId: u.emp, primaryDepartmentId: d1 } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: u.ciso } });
    const asset = await prisma.accessAsset.create({ data: { orgId, name: `Route asset ${stamp}` } });
    await prisma.accessAssignment.createMany({
      data: [
        { orgId, userId: u.emp, assetId: asset.id, status: "ACTIVE" },
        { orgId, userId: u.head, assetId: asset.id, status: "ACTIVE" },
      ],
    });
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await prisma.accessAssignment.deleteMany({ where: { orgId: id } });
      await prisma.accessAsset.deleteMany({ where: { orgId: id } });
      await prisma.accessRoleAssignment.deleteMany({ where: { orgId: id } });
      await prisma.accessProfile.deleteMany({ where: { orgId: id } });
      await prisma.department.deleteMany({ where: { orgId: id } });
      await prisma.user.deleteMany({ where: { orgId: id } });
      await prisma.organization.delete({ where: { id } });
    }
  });

  it("401 sans session", async () => {
    expect((await call("view=me", null)).status).toBe(401);
  });

  it("200 Mes accès, forme { data, total, page, pageSize }", async () => {
    const res = await call("view=me", "emp");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(body.data[0].userId).toBe(u.emp);
  });

  it("un filtre q sur Mes accès ne révèle aucun autre employé", async () => {
    const body = await (await call("view=me&q=head", "emp")).json();
    expect(body.total).toBe(0);
  });

  it("404 pour un employé simple sur la vue département", async () => {
    expect((await call(`view=department&departmentId=${d1}`, "emp")).status).toBe(404);
  });

  it("404 pour le CISO sur un département d'une autre organisation", async () => {
    expect((await call(`view=department&departmentId=${otherDeptId}`, "ciso")).status).toBe(404);
  });

  it("200 pour le chef sur son département, total avant pagination", async () => {
    const body = await (await call(`view=department&departmentId=${d1}&pageSize=1`, "head")).json();
    expect(body.total).toBe(1); // seul emp a d1 comme département principal
    expect(body.data).toHaveLength(1);
  });

  it("400 sur paramètre invalide ou vue département sans departmentId", async () => {
    expect((await call("view=nimporte", "emp")).status).toBe(400);
    expect((await call("view=department", "head")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Lancer les tests — ils doivent échouer**

Run: `npx vitest run tests/unit/access-db/assignments-route.test.ts`
Expected: FAIL — module `@/app/api/access/assignments/route` introuvable.

- [ ] **Step 3: Implémenter la route**

Créer `app/api/access/assignments/route.ts` :

```ts
// app/api/access/assignments/route.ts
// Lecture du registre (phase 2b). Aucun rôle requis pour « Mes accès » ; les
// autres vues sont autorisées par listAssignments à partir des portées
// recalculées en base. Hors portée → 404, jamais 403 (spec §6).
import { auth } from "@/lib/auth";
import { registerQuerySchema } from "@/lib/validations/access";
import { registerRequestFromQuery } from "@/lib/access/register";
import { listAssignments, RegisterNotFoundError } from "@/lib/access/register-server";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = registerQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const req = registerRequestFromQuery(parsed.data);
  if (!req) {
    return Response.json(
      { error: "Validation error", details: { departmentId: ["Requis pour la vue département"] } },
      { status: 400 }
    );
  }

  const { page, pageSize } = parsed.data;
  try {
    const result = await listAssignments({
      viewer: { userId: session.user.id, orgId: session.user.orgId },
      view: req.view,
      filters: req.filters,
      pagination: { page, pageSize },
    });
    return Response.json({ data: result.rows, total: result.total, page, pageSize });
  } catch (err) {
    if (err instanceof RegisterNotFoundError) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Lancer les tests et vérifier les types**

Run: `npx vitest run tests/unit/access-db/assignments-route.test.ts && npx tsc --noEmit`
Expected: PASS ; aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add app/api/access/assignments/route.ts tests/unit/access-db/assignments-route.test.ts
git commit -m "feat(access): route GET /api/access/assignments"
```

---

## Task 6 : Tableau partagé et page « Mes accès »

**Files:**
- Create: `components/access/AssignmentsTable.tsx`
- Create: `app/(dashboard)/access/me/page.tsx`

**Interfaces:**
- Consumes: `AssignmentRowDTO`, `listAssignments` (Tâche 4), `formatPeriod` (Tâche 2), `registerQuerySchema` (Tâche 3), `AdminPageHeader` (`components/admin/AdminPageHeader.tsx`, props `title`, `subtitle?`, `action?`).
- Produces: `AssignmentsTable` (Server Component, sans `"use client"`) :
  ```ts
  interface AssignmentsTableProps {
    rows: AssignmentRowDTO[];
    total: number;
    page: number;
    pageSize: number;
    basePath: string;                       // ex. "/access/department"
    baseQuery: Record<string, string>;      // filtres courants conservés dans les liens de pagination
    showEmployee: boolean;
    showDepartment: boolean;
    groupBy: "employee" | "asset" | null;
    emptyMessage: string;
  }
  ```

Pas de test unitaire dédié (rendu pur, comme les autres composants du module) ; couvert par le build et la vérification navigateur (Tâche 10).

- [ ] **Step 1: Créer `components/access/AssignmentsTable.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { AssignmentRowDTO } from "@/lib/access/register-server";
import { formatPeriod } from "@/lib/access/register";

interface AssignmentsTableProps {
  rows: AssignmentRowDTO[];
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  baseQuery: Record<string, string>;
  showEmployee: boolean;
  showDepartment: boolean;
  groupBy: "employee" | "asset" | null;
  emptyMessage: string;
}

const SOURCE_LABEL: Record<AssignmentRowDTO["source"], string> = {
  LEGACY_IMPORT: "Import",
  REQUEST: "Demande",
};

const LIFECYCLE_SUFFIX: Record<string, string> = {
  OFFBOARDING: " — départ en cours",
  DEPARTED: " — parti",
};

function pageHref(basePath: string, baseQuery: Record<string, string>, page: number) {
  const params = new URLSearchParams(baseQuery);
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

function Badge({ children, tone }: { children: ReactNode; tone: "gray" | "gold" | "red" }) {
  // Texte sombre sur fond blanc ou gris clair : jamais gold sur gold-lt (WCAG, CLAUDE.md).
  const cls = {
    gray: "bg-izi-gray-lt text-izi-gray border-border-soft",
    gold: "bg-white text-dark-md border-gold",
    red: "bg-white text-dark-md border-izi-red",
  }[tone];
  return (
    <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function AssignmentsTable({
  rows,
  total,
  page,
  pageSize,
  basePath,
  baseQuery,
  showEmployee,
  showDepartment,
  groupBy,
  emptyMessage,
}: AssignmentsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = 4 + (showEmployee ? 1 : 0) + (showDepartment ? 1 : 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
        {emptyMessage}
      </div>
    );
  }

  let previousGroup: string | null = null;

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] border border-border-soft bg-white overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border-soft text-izi-gray text-left">
              {showEmployee && <th className="px-4 py-2 font-medium">Employé</th>}
              {showDepartment && <th className="px-4 py-2 font-medium">Département</th>}
              <th className="px-4 py-2 font-medium">Application</th>
              <th className="px-4 py-2 font-medium">Niveau</th>
              <th className="px-4 py-2 font-medium">Période</th>
              <th className="px-4 py-2 font-medium">Provenance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const groupKey = groupBy === "employee" ? r.userId : groupBy === "asset" ? r.assetId : null;
              const groupLabel =
                groupBy === "employee"
                  ? `${r.userName}${r.lifecycle ? LIFECYCLE_SUFFIX[r.lifecycle] ?? "" : ""}`
                  : r.assetName;
              const groupHeader = groupKey !== null && groupKey !== previousGroup ? groupLabel : null;
              previousGroup = groupKey;
              return (
                <AssignmentRow
                  key={r.id}
                  row={r}
                  groupHeader={groupHeader}
                  columnCount={columnCount}
                  showEmployee={showEmployee}
                  showDepartment={showDepartment}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2 text-[11px]">
          {page > 1 && (
            <Link href={pageHref(basePath, baseQuery, page - 1)} className="text-teal hover:text-teal-dk">
              Précédent
            </Link>
          )}
          <span className="text-izi-gray">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageHref(basePath, baseQuery, page + 1)} className="text-teal hover:text-teal-dk">
              Suivant
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function AssignmentRow({
  row: r,
  groupHeader,
  columnCount,
  showEmployee,
  showDepartment,
}: {
  row: AssignmentRowDTO;
  groupHeader: string | null;
  columnCount: number;
  showEmployee: boolean;
  showDepartment: boolean;
}) {
  return (
    <>
      {groupHeader !== null && (
        <tr className="bg-izi-gray-lt">
          <th colSpan={columnCount} scope="colgroup" className="px-4 py-1.5 text-left text-[11px] font-semibold text-dark">
            {groupHeader}
          </th>
        </tr>
      )}
      <tr className="border-b border-border-soft last:border-0">
        {showEmployee && (
          <td className="px-4 py-2 text-dark">
            {r.userName}
            {r.lifecycle === "OFFBOARDING" && <Badge tone="red">Départ en cours</Badge>}
            {r.lifecycle === "DEPARTED" && <Badge tone="red">Parti</Badge>}
          </td>
        )}
        {showDepartment && (
          <td className="px-4 py-2 text-izi-gray">{r.departmentName ?? "Sans département"}</td>
        )}
        <td className="px-4 py-2 text-dark">
          {r.assetName}
          {r.assetArchived && <Badge tone="gray">Archivé</Badge>}
        </td>
        <td className="px-4 py-2 text-dark">
          {r.levelName ?? "—"}
          {r.status === "EXPIRED_REMOVAL_PENDING" && <Badge tone="gold">Retrait en attente</Badge>}
        </td>
        <td className="px-4 py-2 font-mono text-izi-gray">{formatPeriod(r.periodStart, r.periodEnd)}</td>
        <td className="px-4 py-2 text-izi-gray">
          {SOURCE_LABEL[r.source]}
          {r.verification === "IMPORTED_UNREVIEWED" && <Badge tone="gray">Importé — non vérifié</Badge>}
        </td>
      </tr>
    </>
  );
}
```

- [ ] **Step 2: Créer `app/(dashboard)/access/me/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssignmentsTable } from "@/components/access/AssignmentsTable";
import { listAssignments } from "@/lib/access/register-server";
import { registerQuerySchema } from "@/lib/validations/access";

const PAGE_SIZE = 25;

export default async function MyAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Paramètre invalide → vue par défaut, sans erreur (spec §6).
  const parsed = registerQuerySchema.safeParse(await searchParams);
  const page = parsed.success ? parsed.data.page : 1;

  const { rows, total } = await listAssignments({
    viewer: { userId: session.user.id, orgId: session.user.orgId },
    view: { kind: "SELF" },
    filters: {},
    pagination: { page, pageSize: PAGE_SIZE },
  });

  return (
    <div>
      <AdminPageHeader
        title="Mes accès"
        subtitle={`${total} accès enregistré${total > 1 ? "s" : ""}`}
      />
      <AssignmentsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/access/me"
        baseQuery={{}}
        showEmployee={false}
        showDepartment={false}
        groupBy={null}
        emptyMessage="Aucun accès enregistré pour vous."
      />
    </div>
  );
}
```

- [ ] **Step 3: Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint components/access/AssignmentsTable.tsx "app/(dashboard)/access/me/page.tsx"`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add components/access/AssignmentsTable.tsx "app/(dashboard)/access/me/page.tsx"
git commit -m "feat(access): page « Mes accès » et tableau partagé du registre"
```

---

## Task 7 : Formulaire de filtres et page « Accès du département »

**Files:**
- Create: `components/access/RegisterFilterForm.tsx`
- Create: `app/(dashboard)/access/department/page.tsx`

**Interfaces:**
- Consumes: `getRegisterNav`, `listAssignments`, `listAssetOptions`, `RegisterNotFoundError` (Tâche 4) ; `registerQuerySchema`, `RegisterQuery`, `registerRequestFromQuery` (Tâche 3) ; `AssignmentsTable` (Tâche 6).
- Produces: `RegisterFilterForm` (Server Component, formulaire `GET` natif, sans JS client) :
  ```ts
  interface Option { id: string; name: string }
  interface RegisterFilterFormProps {
    action: string;                                  // chemin de la page
    view: "department" | "owned-assets";
    departments?: { options: Option[]; selected: string; allowAll: boolean };
    assets?: { options: Option[]; selected?: string; label: string };
    levels?: { options: Option[]; selected?: string };
    search?: { value?: string };
  }
  ```

- [ ] **Step 1: Créer `components/access/RegisterFilterForm.tsx`**

```tsx
interface Option {
  id: string;
  name: string;
}

interface RegisterFilterFormProps {
  action: string;
  view: "department" | "owned-assets";
  departments?: { options: Option[]; selected: string; allowAll: boolean };
  assets?: { options: Option[]; selected?: string; label: string };
  levels?: { options: Option[]; selected?: string };
  search?: { value?: string };
}

const fieldCls =
  "rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal";

// Formulaire GET natif : fonctionne sans JavaScript, chaque filtre devient un
// paramètre d'URL validé côté serveur par registerQuerySchema. L'option
// « Toutes » / « Tous » envoie une chaîne vide, que le schéma traite comme absente.
export function RegisterFilterForm({ action, view, departments, assets, levels, search }: RegisterFilterFormProps) {
  const departmentChoices = departments ? departments.options.length + (departments.allowAll ? 1 : 0) : 0;

  return (
    <form method="get" action={action} className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <input type="hidden" name="view" value={view} />
      {departments && departmentChoices > 1 && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          Département
          <select name="departmentId" defaultValue={departments.selected} className={fieldCls}>
            {departments.allowAll && <option value="ALL">Toutes</option>}
            {departments.options.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}
      {departments && departmentChoices <= 1 && (
        <input type="hidden" name="departmentId" value={departments.selected} />
      )}
      {assets && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          {assets.label}
          <select name="assetId" defaultValue={assets.selected ?? ""} className={fieldCls}>
            <option value="">Toutes</option>
            {assets.options.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
      )}
      {levels && levels.options.length > 0 && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          Niveau
          <select name="levelId" defaultValue={levels.selected ?? ""} className={fieldCls}>
            <option value="">Tous</option>
            {levels.options.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      )}
      {search && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          Employé
          <input
            type="search"
            name="q"
            defaultValue={search.value ?? ""}
            maxLength={100}
            placeholder="Nom de l'employé"
            className={fieldCls}
          />
        </label>
      )}
      <button
        type="submit"
        className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors"
      >
        Filtrer
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Créer `app/(dashboard)/access/department/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssignmentsTable } from "@/components/access/AssignmentsTable";
import { RegisterFilterForm } from "@/components/access/RegisterFilterForm";
import {
  getRegisterNav,
  listAssetOptions,
  listAssignments,
  RegisterNotFoundError,
} from "@/lib/access/register-server";
import { registerRequestFromQuery } from "@/lib/access/register";
import { registerQuerySchema, type RegisterQuery } from "@/lib/validations/access";

const PAGE_SIZE = 25;

export default async function DepartmentAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, orgId } = session.user;

  const nav = await getRegisterNav(orgId, userId);
  if (!nav.hasDepartmentView || !nav.defaultDepartmentId) notFound();

  // Paramètre invalide → vue par défaut du lecteur, sans erreur (spec §6).
  const parsed = registerQuerySchema.safeParse(await searchParams);
  const query: RegisterQuery = parsed.success
    ? {
        ...parsed.data,
        view: "department",
        departmentId: parsed.data.departmentId ?? nav.defaultDepartmentId,
        pageSize: PAGE_SIZE,
      }
    : { view: "department", departmentId: nav.defaultDepartmentId, page: 1, pageSize: PAGE_SIZE };
  const req = registerRequestFromQuery(query);
  if (!req || req.view.kind !== "DEPARTMENT") notFound();
  const departmentId = req.view.departmentId;

  let result;
  try {
    result = await listAssignments({
      viewer: { userId, orgId },
      view: req.view,
      filters: req.filters,
      pagination: { page: query.page, pageSize: PAGE_SIZE },
    });
  } catch (err) {
    if (err instanceof RegisterNotFoundError) notFound();
    throw err;
  }

  const assetOptions = await listAssetOptions(orgId);
  const isAll = departmentId === "ALL";
  const departmentName = isAll
    ? "Tous les départements"
    : nav.departments.find((d) => d.id === departmentId)?.name ?? "Département";

  const baseQuery: Record<string, string> = { view: "department", departmentId };
  if (req.filters.assetId) baseQuery.assetId = req.filters.assetId;
  if (req.filters.q) baseQuery.q = req.filters.q;

  return (
    <div>
      <AdminPageHeader
        title="Accès du département"
        subtitle={`${departmentName} · ${result.total} accès courant${result.total > 1 ? "s" : ""}`}
      />
      <RegisterFilterForm
        action="/access/department"
        view="department"
        departments={{ options: nav.departments, selected: departmentId, allowAll: nav.canSeeAll }}
        assets={{ options: assetOptions, selected: req.filters.assetId, label: "Application" }}
        search={{ value: req.filters.q }}
      />
      <AssignmentsTable
        rows={result.rows}
        total={result.total}
        page={query.page}
        pageSize={PAGE_SIZE}
        basePath="/access/department"
        baseQuery={baseQuery}
        showEmployee={false}
        showDepartment={isAll}
        groupBy="employee"
        emptyMessage={
          req.filters.assetId || req.filters.q
            ? "Aucun accès ne correspond à ces filtres."
            : "Aucun employé de ce département n'a d'accès enregistré."
        }
      />
    </div>
  );
}
```

`showEmployee={false}` : l'employé (avec son éventuel suffixe « — départ en cours » / « — parti ») apparaît en en-tête de groupe (`groupBy="employee"`, Tâche 6).

- [ ] **Step 3: Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint components/access/RegisterFilterForm.tsx "app/(dashboard)/access/department/page.tsx"`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add components/access/RegisterFilterForm.tsx "app/(dashboard)/access/department/page.tsx"
git commit -m "feat(access): page « Accès du département » avec filtres et vue « Toutes » CISO/COO"
```

---

## Task 8 : Page « Mes actifs »

**Files:**
- Create: `app/(dashboard)/access/owned-assets/page.tsx`

**Interfaces:**
- Consumes: `getRegisterNav`, `listAssignments`, `RegisterNotFoundError` (Tâche 4) ; `registerQuerySchema`, `RegisterQuery`, `registerRequestFromQuery` (Tâche 3) ; `AssignmentsTable` (Tâche 6) ; `RegisterFilterForm` (Tâche 7).
- Produces: route `/access/owned-assets`.

- [ ] **Step 1: Créer la page**

```tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssignmentsTable } from "@/components/access/AssignmentsTable";
import { RegisterFilterForm } from "@/components/access/RegisterFilterForm";
import { getRegisterNav, listAssignments, RegisterNotFoundError } from "@/lib/access/register-server";
import { registerRequestFromQuery } from "@/lib/access/register";
import { registerQuerySchema, type RegisterQuery } from "@/lib/validations/access";

const PAGE_SIZE = 25;

export default async function OwnedAssetsAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, orgId } = session.user;

  const nav = await getRegisterNav(orgId, userId);
  if (!nav.hasOwnedAssetsView) notFound();

  // Paramètre invalide → vue par défaut, sans erreur (spec §6).
  const parsed = registerQuerySchema.safeParse(await searchParams);
  const query: RegisterQuery = parsed.success
    ? { ...parsed.data, view: "owned-assets", departmentId: undefined, pageSize: PAGE_SIZE }
    : { view: "owned-assets", page: 1, pageSize: PAGE_SIZE };
  const req = registerRequestFromQuery(query);
  if (!req || req.view.kind !== "ASSET") notFound();
  const assetId = req.view.assetId;

  let result;
  try {
    result = await listAssignments({
      viewer: { userId, orgId },
      view: req.view,
      filters: req.filters,
      pagination: { page: query.page, pageSize: PAGE_SIZE },
    });
  } catch (err) {
    if (err instanceof RegisterNotFoundError) notFound();
    throw err;
  }

  const selectedAsset = nav.ownedAssets.find((a) => a.id === assetId);
  const baseQuery: Record<string, string> = { view: "owned-assets" };
  if (assetId) baseQuery.assetId = assetId;
  if (req.filters.levelId) baseQuery.levelId = req.filters.levelId;

  const assetCount = nav.ownedAssets.length;

  return (
    <div>
      <AdminPageHeader
        title="Mes actifs"
        subtitle={`${assetCount} application${assetCount > 1 ? "s" : ""} · ${result.total} accès courant${result.total > 1 ? "s" : ""}`}
      />
      <RegisterFilterForm
        action="/access/owned-assets"
        view="owned-assets"
        assets={{ options: nav.ownedAssets, selected: assetId, label: "Application" }}
        levels={selectedAsset ? { options: selectedAsset.levels, selected: req.filters.levelId } : undefined}
      />
      <AssignmentsTable
        rows={result.rows}
        total={result.total}
        page={query.page}
        pageSize={PAGE_SIZE}
        basePath="/access/owned-assets"
        baseQuery={baseQuery}
        showEmployee
        showDepartment
        groupBy="asset"
        emptyMessage="Personne n'a d'accès enregistré sur ces applications."
      />
    </div>
  );
}
```

- [ ] **Step 2: Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/access/owned-assets/page.tsx"`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/access/owned-assets/page.tsx"
git commit -m "feat(access): page « Mes actifs » pour propriétaires et suppléants d'actif"
```

---

## Task 9 : Navigation — liens conditionnels dans la barre latérale

**Files:**
- Modify: `app/(dashboard)/layout.tsx` (imports ~ligne 16 ; `Promise.all` qui se termine par `getEffectiveRoleHolders(orgId, userId),` ~ligne 116 ; flags ~lignes 147–149 ; props de `DashboardShell` ~lignes 160–163)
- Modify: `components/layout/DashboardShell.tsx` (props ~ligne 27, déstructuration ~ligne 42, passage à `Sidebar` ~ligne 64)
- Modify: `components/layout/Sidebar.tsx` (interface ~ligne 13, déstructuration ~ligne 205, section « Accès » ~lignes 352–416)

**Interfaces:**
- Consumes: `getOwnedAssetIds` (Tâche 4), `resolveReadScopes` (Tâche 1), `registerNavFlags` (Tâche 2).
- Produces: props booléennes `canViewDepartmentAccess` et `canViewOwnedAssetsAccess` sur `DashboardShell` et `Sidebar`.

- [ ] **Step 1: Layout — calculer les flags à partir des portées**

Dans `app/(dashboard)/layout.tsx` :

1. Ajouter les imports :

```ts
import { getOwnedAssetIds } from "@/lib/access/register-server";
import { resolveReadScopes } from "@/lib/access/scope";
import { registerNavFlags } from "@/lib/access/register";
```

2. Dans le `Promise.all` dont le dernier élément est `getEffectiveRoleHolders(orgId, userId),`, ajouter juste après cette ligne :

```ts
    getOwnedAssetIds(orgId, userId),
```

et ajouter `ownedAssetIds` en dernier élément du tableau déstructuré qui reçoit ce `Promise.all` (juste après `accessRoles`).

3. Après `const canViewAccessAudit = …`, ajouter :

```ts
  // Vues du registre (phase 2b) : dérivées des portées, pas des rôles bruts —
  // même logique que les pages et l'API (resolveReadScopes + registerNavFlags).
  const registerFlags = registerNavFlags(resolveReadScopes(userId, accessRoles, ownedAssetIds));
```

4. Ajouter aux props de `<DashboardShell>`, après `canViewAccessAudit={canViewAccessAudit}` :

```tsx
      canViewDepartmentAccess={registerFlags.hasDepartmentView}
      canViewOwnedAssetsAccess={registerFlags.hasOwnedAssetsView}
```

- [ ] **Step 2: DashboardShell — faire suivre les props**

Dans `components/layout/DashboardShell.tsx`, à côté de chacune des trois occurrences de `canViewAccessAudit` (interface, déstructuration, passage à `<Sidebar>`), ajouter respectivement :

```ts
  canViewDepartmentAccess: boolean;
  canViewOwnedAssetsAccess: boolean;
```

```ts
  canViewDepartmentAccess,
  canViewOwnedAssetsAccess,
```

```tsx
          canViewDepartmentAccess={canViewDepartmentAccess}
          canViewOwnedAssetsAccess={canViewOwnedAssetsAccess}
```

- [ ] **Step 3: Sidebar — section « Accès » toujours présente, liens du registre en tête**

Dans `components/layout/Sidebar.tsx` :

1. Dans `interface SidebarProps`, après `canViewAccessAudit?: boolean;` :

```ts
  canViewDepartmentAccess?: boolean;
  canViewOwnedAssetsAccess?: boolean;
```

2. Dans la déstructuration des props, après `canViewAccessAudit,` :

```ts
  canViewDepartmentAccess,
  canViewOwnedAssetsAccess,
```

3. La section « Accès » devient inconditionnelle (« Mes accès » est ouvert à tous). Remplacer le bloc commentaire et la ligne d'ouverture :

```tsx
          {/* Gestion des accès — un lien par droit effectif, pas un lien unique
              pour tout le module (fix wave, Critical C3) : /access/roles est
              réservé au CEO, /access/assets à l'Administrateur des actifs,
              /access/audit au Lecteur d'audit — chacun ne doit voir que le(s)
              lien(s) qu'il peut réellement utiliser. */}
          {(canManageAccessRoles || canManageAccessAssets || canViewAccessAudit) && (
            <>
```

par :

```tsx
          {/* Gestion des accès — un lien par droit effectif, pas un lien unique
              pour tout le module (fix wave, Critical C3). « Mes accès » est
              ouvert à tous (phase 2b) ; département/actifs suivent les portées
              de lecture ; /access/roles est réservé au CEO, /access/assets à
              l'Administrateur des actifs, /access/audit au Lecteur d'audit.
              Masquer un lien n'est qu'un confort : pages et API refusent de
              toute façon. */}
          {
            <>
```

et remplacer la fermeture correspondante de cette section (`            </>` suivi de `          )}`, juste avant la fermeture `</div>` qui précède `{/* Admin section — CEO only */}`) par :

```tsx
            </>
          }
```

4. Juste après le titre de section (`<div …>Accès</div>`), insérer :

```tsx
              <Link
                href="/access/me"
                onClick={onClose}
                className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                  pathname === "/access/me"
                    ? "bg-teal/[0.18] text-[#7dd8d8]"
                    : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                Mes accès
              </Link>
              {canViewDepartmentAccess && (
                <Link
                  href="/access/department"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/department"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <path d="M3 21h18" />
                    <path d="M5 21V7l7-4 7 4v14" />
                    <path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
                  </svg>
                  Accès du département
                </Link>
              )}
              {canViewOwnedAssetsAccess && (
                <Link
                  href="/access/owned-assets"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/owned-assets"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                  Mes actifs
                </Link>
              )}
```

- [ ] **Step 4: Vérifier types, lint et tests existants**

Run: `npx tsc --noEmit && npx eslint "app/(dashboard)/layout.tsx" components/layout/DashboardShell.tsx components/layout/Sidebar.tsx && npm test`
Expected: aucune erreur de type ; pas de nouvelle erreur de lint (les avertissements préexistants de `Sidebar.tsx` sont acceptables) ; toute la suite passe.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/layout.tsx" components/layout/DashboardShell.tsx components/layout/Sidebar.tsx
git commit -m "feat(access): liens « Mes accès », « Accès du département », « Mes actifs » dans la barre latérale"
```

---

## Task 10 : Vérification finale de la phase 2b

**Files:** aucun fichier nouveau — tâche de vérification globale.

**Écart assumé avec la spec §7 (E2E Playwright)** : `tests/e2e/helpers.ts` se connecte par e-mail + mot de passe, alors que la connexion exige désormais un code OTP (`app/(auth)/login/page.tsx`, étape `"otp"`). Les specs E2E existantes ne passent donc plus sans réparation préalable de ce helper, hors périmètre ici. Le parcours E2E prévu par la spec est remplacé par la vérification navigateur du Step 6 ; la réparation du helper E2E est à traiter séparément.

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les tests passent, dont `tests/unit/access-scope.test.ts`, `tests/unit/access-register.test.ts`, `tests/unit/access-db/register-server.test.ts`, `tests/unit/access-db/assignments-route.test.ts`.

- [ ] **Step 2: Types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: aucune erreur nouvelle dans `lib/access/`, `app/api/access/`, `app/(dashboard)/access/`, `components/access/`, `components/layout/`.

- [ ] **Step 4: Build de production**

Run: `npm run build`
Expected: build réussi ; `/access/me`, `/access/department`, `/access/owned-assets` et `/api/access/assignments` apparaissent dans la sortie.

- [ ] **Step 5: Revue des 5 points du Review Focus**

Confirmer qu'un test réel existe et passe pour chacun :
1. Changement de département — Tâche 4, « suit le département principal actuel ».
2. CISO + département d'une autre org → 404 — Tâches 4 et 5.
3. `q`/`assetId` sur « Mes accès » n'élargit rien — Tâche 2 (`buildAssignmentQuery`), Tâches 4 et 5.
4. Suppléant de chef avec titulaire disponible → 404 — Tâche 4.
5. Chaîne vide du formulaire = absent — Tâche 3.

- [ ] **Step 6: Vérification manuelle en navigateur**

Build de production locale sur le port 3005 (`npm run build && PORT=3005 npm start` ; le code OTP de connexion s'affiche dans le log serveur). Avec des données d'import présentes (phase 2) :
- **Employé simple** : « Mes accès » visible dans la barre latérale et liste ses accès ; « Accès du département » et « Mes actifs » absents ; `/access/department` et `/access/owned-assets` saisis à la main → page 404.
- **Chef de département** (propriétaire d'un `Department`) : « Accès du département » liste les employés de son département, groupés par employé ; `?departmentId=<id d'un autre département>` → 404 ; la recherche par nom filtre ; « Toutes » n'est pas proposée.
- **CISO** (rôle attribué dans `/access/roles`) : le sélecteur propose « Toutes » et chaque département ; « Toutes » affiche la colonne Département, avec « Sans département » en fin de liste.
- **Propriétaire d'actif** (renseigné dans `/access/assets`) : « Mes actifs » groupe par application ; choisir une application puis « Filtrer » fait apparaître le filtre Niveau ; les accès importés portent le badge « Importé — non vérifié ».
- **Mobile (375 px)** : les filtres s'empilent en colonne ; le tableau défile horizontalement sans faire déborder la page.

- [ ] **Step 7: Commit final si des ajustements ont été faits**

```bash
git add -A
git commit -m "chore(access): vérification finale de la phase 2b (tests, types, lint, build)"
```

Si aucun ajustement n'était nécessaire, ne rien committer à cette étape.
