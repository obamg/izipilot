# Gestion des accès — Phase 3a : demandes et approbations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un employé de soumettre une demande d'accès (GRANT/UPGRADE/RENEW), à un chef de département/IT/CISO d'en soumettre une réduction/révocation, et calculer + faire appliquer automatiquement la route d'approbation exacte (chef de département → CISO → COO) jusqu'à ce que la demande soit prête pour exécution (phase 3b).

**Architecture:** Deux fonctions pures (`lib/access/routing.ts`) encodent les tableaux de routage du spec sans toucher la base. Des fonctions Prisma (`lib/access/requests-server.ts`) gèrent soumission, décision (avec revalidation systématique — jamais confiance dans un état périmé), révision à version immuable, annulation et lots. Un petit ajout (`lib/access/roles-server.ts`) comble une lacune de la phase 1 : les chefs de département n'ont aujourd'hui aucun mécanisme de suppléant, alors que le routage en dépend directement dès cette phase.

**Tech Stack:** Next.js 15 App Router, Prisma, PostgreSQL, Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-09-29-access-management-phase3a-requests-design.md` (et les phases 1/2 pour le contexte : `docs/superpowers/specs/2026-09-28-access-management-phase1-design.md`, `docs/superpowers/specs/2026-09-29-access-management-phase2-import-design.md`)

## Global Constraints

- Au plus une demande **non terminale** par couple employé/actif — appliqué par une contrainte DB (`@@unique`), jamais seulement par une vérification applicative.
- Aucune auto-approbation : un acteur ne peut jamais décider une étape s'il est l'initiateur, le bénéficiaire, ou a déjà décidé une autre étape de la même version.
- Exemptions COO/CISO réservées au **titulaire réel** (`actsAsPrimary: true`) — un suppléant agissant comme COO/CISO n'en hérite jamais.
- **Revalidation systématique avant toute décision** : reprendre l'état courant de la version, l'éligibilité de l'acteur, et `assignmentVersion`/`catalogueVersion` au moment de la décision — ne jamais appliquer une décision sur un instantané périmé.
- Aucun saut automatique ni approbateur inventé : une étape sans acteur éligible reste un problème de routage visible, jamais contourné.
- `orgId` vient toujours de la session, jamais du client. Actif et bénéficiaire immuables après soumission.
- Audit : chaque mutation écrit un `AccessAuditEvent` via `recordAuditInTx` (transactionnel), jamais `recordAudit`.
- TypeScript strict, dates sérialisées en ISO string avant la frontière Server → Client Component (même convention que les phases 1/2).

## Review Focus

- **Un suppléant CISO/COO/chef de département décide une étape à la place du titulaire, en pensant bénéficier de l'exemption personnelle de ce dernier** — une personne raisonnable attend que l'exemption (`COO_SELF_REQUEST`, saut de l'étape CISO pour un chef de département) ne s'applique jamais à un suppléant, seulement au titulaire réel.
- **Un acteur tente de décider deux étapes différentes de la même version de demande** (par exemple, le chef de département qui a initié une réduction essaie ensuite de "porter la casquette" CISO pour l'approuver) — une personne raisonnable attend un refus explicite, jamais une double signature.
- **Le catalogue ou l'affectation change entre la soumission et la décision** (le niveau visé est archivé, ou l'affectation actuelle a une nouvelle version suite à une autre opération) — une personne raisonnable attend que la décision soit refusée avec un message clair, jamais appliquée aveuglément sur un état obsolète.
- **Une demande de réduction/révocation vers un niveau administrateur** — une personne raisonnable attend qu'elle NE déclenche PAS automatiquement l'étape COO (contrairement à l'octroi), seule une escalade CISO explicite le fait.
- **Un chef de département devient indisponible (parti/désactivé) sans aucun suppléant configuré** — une personne raisonnable attend un problème de routage visible et bloquant (jamais un saut vers CISO), et s'attend à ce qu'un suppléant puisse être configuré pour résoudre la situation — ce que la phase 1 n'a jamais permis (lacune comblée par la Tâche 3 de ce plan).

---

## Task 1 : Schéma Prisma — demandes, versions, étapes d'approbation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration sous `prisma/migrations/` (générée par la commande ci-dessous)

**Interfaces:**
- Produces: enums `AccessRequestKind` (`GRANT`, `UPGRADE`, `RENEW`, `REDUCE`, `REVOKE`), `AccessRequestState` (`PENDING_APPROVAL`, `CLARIFICATION_REQUIRED`, `REVISION_REQUIRED`, `AUTHORIZED_WAITING_START`, `READY_FOR_FULFILMENT`, `REJECTED`, `CANCELLED`), `ApprovalStageRole` (`DEPARTMENT_HEAD`, `CISO`, `COO`), `ApprovalDecision` (`APPROVE`, `REJECT`, `CLARIFY`, `RETURN`) ; modèles `AccessRequest`, `AccessRequestVersion`, `AccessApprovalStage`.

- [ ] **Step 1: Ajouter les enums et modèles au schéma**

Ouvrir `prisma/schema.prisma`. Ajouter les 4 enums à côté des enums `Access*` existants (chercher `enum AccessAssignmentSource` pour se situer) :

```prisma
enum AccessRequestKind {
  GRANT
  UPGRADE
  RENEW
  REDUCE
  REVOKE
}

enum AccessRequestState {
  PENDING_APPROVAL
  CLARIFICATION_REQUIRED
  REVISION_REQUIRED
  AUTHORIZED_WAITING_START
  READY_FOR_FULFILMENT
  REJECTED
  CANCELLED
}

enum ApprovalStageRole {
  DEPARTMENT_HEAD
  CISO
  COO
}

enum ApprovalDecision {
  APPROVE
  REJECT
  CLARIFY
  RETURN
}
```

Ajouter les 3 modèles à côté des modèles `Access*`/`Import*` existants (chercher `model ImportRow` et ajouter juste après) :

```prisma
model AccessRequest {
  id            String   @id @default(cuid())
  orgId         String
  beneficiaryId String
  assetId       String
  createdAt     DateTime @default(now())

  org      Organization           @relation(fields: [orgId], references: [id], onDelete: Cascade)
  versions AccessRequestVersion[]

  @@unique([orgId, beneficiaryId, assetId], map: "one_nonterminal_request_enforced_in_service")
  @@index([orgId, beneficiaryId])
  @@index([orgId, assetId])
  @@map("access_requests")
}

model AccessRequestVersion {
  id                 String              @id @default(cuid())
  requestId          String
  versionNumber      Int
  kind               AccessRequestKind
  initiatorId        String
  targetLevelId      String?
  justification      String              @db.Text
  periodStart        DateTime
  periodEnd          DateTime?
  departmentSnapshot String
  assignmentVersion  Int
  catalogueVersion   Int
  state              AccessRequestState
  exceptionReason    String?
  revision           Int                 @default(1)
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  request AccessRequest         @relation(fields: [requestId], references: [id], onDelete: Cascade)
  stages  AccessApprovalStage[]

  @@unique([requestId, versionNumber])
  @@index([requestId])
  @@map("access_request_versions")
}

model AccessApprovalStage {
  id                    String             @id @default(cuid())
  requestVersionId      String
  sequence              Int
  role                  ApprovalStageRole
  actorId               String?
  actedAsPrimary        Boolean?
  decision              ApprovalDecision?
  reason                String?
  clarificationResponse String?            @db.Text
  decidedAt             DateTime?

  requestVersion AccessRequestVersion @relation(fields: [requestVersionId], references: [id], onDelete: Cascade)

  @@unique([requestVersionId, sequence])
  @@index([requestVersionId])
  @@map("access_approval_stages")
}
```

Ajouter la relation manquante côté `Organization` : chercher `model Organization` et, dans son bloc de relations, ajouter `accessRequests AccessRequest[]`.

- [ ] **Step 2: Générer la migration**

Prérequis : `docker compose up -d db` doit tourner (Postgres pour ce worktree — si absent, le démarrer et copier `.env`/`.env.docker` depuis un worktree existant ou la racine du dépôt, en adaptant le port si un autre worktree occupe déjà 5432/5435 — vérifier avec `docker ps` avant de choisir un port).

Run: `npx prisma migrate dev --name add_access_requests`
Expected: migration créée sous `prisma/migrations/<timestamp>_add_access_requests/migration.sql`, appliquée sans erreur, Prisma Client régénéré.

- [ ] **Step 3: Vérifier que la migration est purement additive**

Run: `cat prisma/migrations/<timestamp>_add_access_requests/migration.sql`
Expected: seulement des `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ... ADD CONSTRAINT` — aucun `DROP`, aucun `ALTER COLUMN` sur une table existante.

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(access): schéma demandes — AccessRequest, AccessRequestVersion, AccessApprovalStage"
```

---

## Task 2 : Fonctions pures — moteur de routage et classification (`lib/access/routing.ts`)

**Files:**
- Create: `lib/access/routing.ts`
- Create: `tests/unit/access-routing.test.ts`

**Interfaces:**
- Consumes: rien (fonctions pures)
- Produces (utilisé par la Tâche 4) :
  - `type ApprovalStageRole = "DEPARTMENT_HEAD" | "CISO" | "COO"`
  - `interface RouteResult { stages: ApprovalStageRole[]; exceptionReason: string | null }`
  - `interface RequesterRole { role: "COO" | "CISO" | "DEPARTMENT_HEAD"; actsAsPrimary: boolean }`
  - `function computeGrantRoute(requesterRoles: RequesterRole[], targetLevelIsAdmin: boolean): RouteResult`
  - `type ReductionInitiatorRole = "DEPARTMENT_HEAD" | "IT_ACCESS_OPERATOR" | "CISO"`
  - `function computeReductionRoute(initiatorRole: ReductionInitiatorRole, beneficiaryIsPrimaryCiso: boolean): ApprovalStageRole[]`
  - `type RequestKind = "GRANT" | "UPGRADE" | "RENEW" | "REDUCE" | "REVOKE"`
  - `class InvalidRequestError extends Error {}`
  - `interface CurrentAccessSnapshot { levelId: string | null; status: "ACTIVE" | "EXPIRED_REMOVAL_PENDING" | "REVOKED"; priority: number | null; periodEnd: Date | null }`
  - `function classifyRequest(current: CurrentAccessSnapshot | null, targetLevelId: string | null, targetPriority: number | null, targetPeriodEnd: Date | null): RequestKind`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/access-routing.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { computeGrantRoute, computeReductionRoute, classifyRequest, InvalidRequestError } from "@/lib/access/routing";

describe("computeGrantRoute", () => {
  it("titulaire COO demandant son propre accès : aucune approbation", () => {
    const result = computeGrantRoute([{ role: "COO", actsAsPrimary: true }], false);
    expect(result).toEqual({ stages: [], exceptionReason: "COO_SELF_REQUEST" });
  });

  it("titulaire CISO demandant son propre accès : COO uniquement, même pour un niveau non-admin", () => {
    const result = computeGrantRoute([{ role: "CISO", actsAsPrimary: true }], false);
    expect(result).toEqual({ stages: ["COO"], exceptionReason: null });
  });

  it("titulaire chef de département demandant son propre accès, niveau non-admin : CISO seul", () => {
    const result = computeGrantRoute([{ role: "DEPARTMENT_HEAD", actsAsPrimary: true }], false);
    expect(result).toEqual({ stages: ["CISO"], exceptionReason: null });
  });

  it("titulaire chef de département demandant son propre accès, niveau admin : CISO puis COO", () => {
    const result = computeGrantRoute([{ role: "DEPARTMENT_HEAD", actsAsPrimary: true }], true);
    expect(result).toEqual({ stages: ["CISO", "COO"], exceptionReason: null });
  });

  it("autre employé, niveau non-admin : chef de département puis CISO", () => {
    const result = computeGrantRoute([], false);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO"], exceptionReason: null });
  });

  it("autre employé, niveau admin : chef de département, CISO, puis COO", () => {
    const result = computeGrantRoute([], true);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO", "COO"], exceptionReason: null });
  });

  it("un SUPPLÉANT agissant comme COO n'hérite jamais de l'exemption personnelle", () => {
    const result = computeGrantRoute([{ role: "COO", actsAsPrimary: false }], false);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO"], exceptionReason: null });
  });

  it("un SUPPLÉANT agissant comme CISO n'hérite jamais du saut direct à COO", () => {
    const result = computeGrantRoute([{ role: "CISO", actsAsPrimary: false }], false);
    expect(result).toEqual({ stages: ["DEPARTMENT_HEAD", "CISO"], exceptionReason: null });
  });
});

describe("computeReductionRoute", () => {
  it("chef de département initie : CISO", () => {
    expect(computeReductionRoute("DEPARTMENT_HEAD", false)).toEqual(["CISO"]);
  });

  it("IT Access Operator initie : CISO", () => {
    expect(computeReductionRoute("IT_ACCESS_OPERATOR", false)).toEqual(["CISO"]);
  });

  it("CISO initie : COO (jamais auto-approbation)", () => {
    expect(computeReductionRoute("CISO", false)).toEqual(["COO"]);
  });

  it("bénéficiaire est le CISO titulaire, quel que soit l'initiateur : COO", () => {
    expect(computeReductionRoute("DEPARTMENT_HEAD", true)).toEqual(["COO"]);
  });

  it("réduction vers un niveau administrateur : toujours CISO seul (jamais COO ajouté automatiquement)", () => {
    // computeReductionRoute ne prend pas targetLevelIsAdmin en paramètre : l'appelant
    // ne doit JAMAIS le lui passer ni ajouter COO lui-même pour ce motif — seule une
    // escalade CISO explicite (Tâche 5) ajoute COO à une réduction.
    expect(computeReductionRoute("DEPARTMENT_HEAD", false)).toEqual(["CISO"]);
  });
});

describe("classifyRequest", () => {
  it("aucune affectation actuelle : GRANT", () => {
    expect(classifyRequest(null, "level-1", 10, null)).toBe("GRANT");
  });

  it("affectation REVOKED existante : traitée comme aucune affectation, GRANT", () => {
    const current = { levelId: "level-1", status: "REVOKED" as const, priority: 10, periodEnd: null };
    expect(classifyRequest(current, "level-2", 20, null)).toBe("GRANT");
  });

  it("cible null avec affectation active existante : REVOKE", () => {
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd: null };
    expect(classifyRequest(current, null, null, null)).toBe("REVOKE");
  });

  it("cible null sans affectation existante : rejeté", () => {
    expect(() => classifyRequest(null, null, null, null)).toThrow(InvalidRequestError);
  });

  it("même niveau, période différente : RENEW", () => {
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd: null };
    const targetEnd = new Date("2027-01-01");
    expect(classifyRequest(current, "level-1", 10, targetEnd)).toBe("RENEW");
  });

  it("même niveau, même période : doublon invalide, rejeté", () => {
    const periodEnd = new Date("2027-01-01");
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd };
    expect(() => classifyRequest(current, "level-1", 10, new Date("2027-01-01"))).toThrow(InvalidRequestError);
  });

  it("priorité cible supérieure : UPGRADE", () => {
    const current = { levelId: "level-1", status: "ACTIVE" as const, priority: 10, periodEnd: null };
    expect(classifyRequest(current, "level-2", 20, null)).toBe("UPGRADE");
  });

  it("priorité cible inférieure : REDUCE", () => {
    const current = { levelId: "level-2", status: "ACTIVE" as const, priority: 20, periodEnd: null };
    expect(classifyRequest(current, "level-1", 10, null)).toBe("REDUCE");
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-routing.test.ts`
Expected: FAIL — `lib/access/routing.ts` n'existe pas encore.

- [ ] **Step 3: Implémenter `lib/access/routing.ts`**

```typescript
// lib/access/routing.ts

export type ApprovalStageRole = "DEPARTMENT_HEAD" | "CISO" | "COO";

export interface RouteResult {
  stages: ApprovalStageRole[];
  exceptionReason: string | null;
}

export interface RequesterRole {
  role: "COO" | "CISO" | "DEPARTMENT_HEAD";
  actsAsPrimary: boolean;
}

/**
 * Route de demande pour GRANT/UPGRADE/RENEW (spec §5, tableau des routes
 * personnelles). Un suppléant agissant comme COO/CISO/chef de département
 * (actsAsPrimary: false) n'hérite JAMAIS des exemptions personnelles —
 * seul le titulaire réel en bénéficie.
 */
export function computeGrantRoute(requesterRoles: RequesterRole[], targetLevelIsAdmin: boolean): RouteResult {
  const isPrimary = (role: RequesterRole["role"]) =>
    requesterRoles.some((r) => r.role === role && r.actsAsPrimary);

  if (isPrimary("COO")) {
    return { stages: [], exceptionReason: "COO_SELF_REQUEST" };
  }
  if (isPrimary("CISO")) {
    return { stages: ["COO"], exceptionReason: null };
  }
  if (isPrimary("DEPARTMENT_HEAD")) {
    return { stages: targetLevelIsAdmin ? ["CISO", "COO"] : ["CISO"], exceptionReason: null };
  }
  return {
    stages: targetLevelIsAdmin ? ["DEPARTMENT_HEAD", "CISO", "COO"] : ["DEPARTMENT_HEAD", "CISO"],
    exceptionReason: null,
  };
}

export type ReductionInitiatorRole = "DEPARTMENT_HEAD" | "IT_ACCESS_OPERATOR" | "CISO";

/**
 * Route de demande pour REDUCE/REVOKE (spec §5, "Ordinary reductions/
 * removals"). Ne prend jamais targetLevelIsAdmin en compte : retirer un
 * accès administrateur n'ajoute jamais automatiquement COO — seule une
 * escalade CISO explicite le fait (gérée à la décision, pas ici).
 */
export function computeReductionRoute(
  initiatorRole: ReductionInitiatorRole,
  beneficiaryIsPrimaryCiso: boolean
): ApprovalStageRole[] {
  if (initiatorRole === "CISO" || beneficiaryIsPrimaryCiso) {
    return ["COO"];
  }
  return ["CISO"];
}

export type RequestKind = "GRANT" | "UPGRADE" | "RENEW" | "REDUCE" | "REVOKE";

export class InvalidRequestError extends Error {}

export interface CurrentAccessSnapshot {
  levelId: string | null;
  status: "ACTIVE" | "EXPIRED_REMOVAL_PENDING" | "REVOKED";
  priority: number | null;
  periodEnd: Date | null;
}

/**
 * Dérive le type de demande depuis l'affectation actuelle et le niveau
 * cible (spec §5, tableau "Existing state / desired action"). Une
 * affectation non ACTIVE (EXPIRED_REMOVAL_PENDING, REVOKED) est traitée
 * comme "aucune affectation actuelle".
 */
export function classifyRequest(
  current: CurrentAccessSnapshot | null,
  targetLevelId: string | null,
  targetPriority: number | null,
  targetPeriodEnd: Date | null
): RequestKind {
  const hasActiveCurrent = current !== null && current.status === "ACTIVE" && current.levelId !== null;

  if (!hasActiveCurrent) {
    if (targetLevelId === null) {
      throw new InvalidRequestError("Aucun accès actuel à réduire ou révoquer");
    }
    return "GRANT";
  }

  if (targetLevelId === null) {
    return "REVOKE";
  }

  if (current!.levelId === targetLevelId) {
    if (samePeriod(current!.periodEnd, targetPeriodEnd)) {
      throw new InvalidRequestError("Demande identique à l'accès actuel — doublon invalide");
    }
    return "RENEW";
  }

  if (targetPriority === null || current!.priority === null) {
    throw new InvalidRequestError("Priorité de niveau inconnue — impossible de déterminer upgrade/reduce");
  }
  return targetPriority > current!.priority ? "UPGRADE" : "REDUCE";
}

function samePeriod(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-routing.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/routing.ts tests/unit/access-routing.test.ts
git commit -m "feat(access): fonctions pures — moteur de routage et classification des demandes"
```

---

## Task 3 : Combler la lacune de la phase 1 — suppléant de chef de département

**Files:**
- Modify: `lib/access/roles-server.ts`
- Create: `app/api/access/roles/departments/route.ts`
- Create: `app/api/access/roles/departments/[departmentId]/backup/route.ts`
- Create: `components/access/DepartmentHeadBackupPanel.tsx`
- Modify: `app/(dashboard)/access/roles/page.tsx`
- Test: `tests/unit/access-db/roles-server.test.ts`

**Contexte** : la phase 1 a délibérément reporté toute UI de suppléant pour les chefs de département (Ruling D : « aucun consommateur fonctionnel avant la phase 3 »). Le routage de cette phase 3a en dépend directement dès qu'un chef de département devient indisponible sans recours possible — c'est le déclencheur que Ruling D anticipait. La logique de résolution (`getEffectiveRoleHolders`) gère déjà un suppléant de chef de département s'il existe une ligne `AccessRoleAssignment` adéquate ; seule la capacité de créer cette ligne manque.

**Interfaces:**
- Consumes: `RoleAssignmentError`, `INCLUDE`, `toDTO`, `RoleAssignmentDTO` (déjà définis dans `lib/access/roles-server.ts`, phase 1 — même fichier, pas de ré-import).
- Produces (consommé par les routes de cette tâche) :
  - `interface DepartmentHeadCoverageDTO { departmentId: string; departmentName: string; ownerId: string; ownerName: string; assignmentId: string | null; backupUserId: string | null; backupUserName: string | null; primaryUnavailable: boolean }`
  - `function listDepartmentHeadCoverage(orgId: string): Promise<DepartmentHeadCoverageDTO[]>`
  - `function setDepartmentHeadBackup(orgId: string, departmentId: string, backupUserId: string | null): Promise<void>`

- [ ] **Step 1: Écrire les tests**

Ajouter à `tests/unit/access-db/roles-server.test.ts` (fichier existant depuis la phase 1, ajouter un nouveau `describe` en fin de fichier) :

```typescript
describe("roles-server — suppléant de chef de département", () => {
  let orgId: string;
  let departmentId: string;
  let ownerId: string;
  let backupId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test DeptBackup Org", slug: `test-deptbackup-${Date.now()}` },
    });
    orgId = org.id;
    const owner = await prisma.user.create({
      data: { orgId, email: `owner-${Date.now()}@example.com`, name: "Owner", role: "PO" },
    });
    ownerId = owner.id;
    const backup = await prisma.user.create({
      data: { orgId, email: `backup-${Date.now()}@example.com`, name: "Backup", role: "PO" },
    });
    backupId = backup.id;
    const dept = await prisma.department.create({
      data: { orgId, code: "DX", name: "Département Test", color: "#000000", ownerId },
    });
    departmentId = dept.id;
  });

  afterAll(async () => {
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("aucun suppléant configuré : coverage renvoie backupUserId null", async () => {
    const coverage = await listDepartmentHeadCoverage(orgId);
    const row = coverage.find((c) => c.departmentId === departmentId);
    expect(row).toBeDefined();
    expect(row?.ownerId).toBe(ownerId);
    expect(row?.backupUserId).toBeNull();
    expect(row?.assignmentId).toBeNull();
  });

  it("assigne un suppléant : coverage le reflète", async () => {
    await setDepartmentHeadBackup(orgId, departmentId, backupId);
    const coverage = await listDepartmentHeadCoverage(orgId);
    const row = coverage.find((c) => c.departmentId === departmentId);
    expect(row?.backupUserId).toBe(backupId);
    expect(row?.assignmentId).not.toBeNull();
  });

  it("le suppléant ne peut pas être le chef lui-même", async () => {
    await expect(setDepartmentHeadBackup(orgId, departmentId, ownerId)).rejects.toThrow();
  });

  it("le suppléant doit appartenir à la même organisation", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "Other Org DeptBackup", slug: `other-deptbackup-${Date.now()}` },
    });
    const outsider = await prisma.user.create({
      data: { orgId: otherOrg.id, email: `outsider-${Date.now()}@example.com`, name: "Outsider", role: "PO" },
    });
    await expect(setDepartmentHeadBackup(orgId, departmentId, outsider.id)).rejects.toThrow();
    await prisma.user.delete({ where: { id: outsider.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  it("retirer le suppléant (null) supprime la ligne", async () => {
    await setDepartmentHeadBackup(orgId, departmentId, backupId);
    await setDepartmentHeadBackup(orgId, departmentId, null);
    const coverage = await listDepartmentHeadCoverage(orgId);
    const row = coverage.find((c) => c.departmentId === departmentId);
    expect(row?.backupUserId).toBeNull();
    expect(row?.assignmentId).toBeNull();
  });
});
```

Ajouter `listDepartmentHeadCoverage, setDepartmentHeadBackup` à l'import existant de `@/lib/access/roles-server` en tête du fichier de test.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/roles-server.test.ts`
Expected: FAIL — les deux fonctions n'existent pas.

- [ ] **Step 3: Implémenter dans `lib/access/roles-server.ts`**

Ajouter à la fin du fichier (après `isUniqueConstraintError`) :

```typescript
export interface DepartmentHeadCoverageDTO {
  departmentId: string;
  departmentName: string;
  ownerId: string;
  ownerName: string;
  assignmentId: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
}

export async function listDepartmentHeadCoverage(orgId: string): Promise<DepartmentHeadCoverageDTO[]> {
  const departments = await prisma.department.findMany({
    where: { orgId, isActive: true },
    select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } },
    orderBy: { sortOrder: "asc" },
  });

  const assignments = await prisma.accessRoleAssignment.findMany({
    where: { orgId, role: "DEPARTMENT_HEAD" },
    include: { backupUser: { select: { name: true } } },
  });
  const assignmentByDept = new Map(assignments.map((a) => [a.departmentId as string, a]));

  return departments.map((d) => {
    const assignment = assignmentByDept.get(d.id);
    return {
      departmentId: d.id,
      departmentName: d.name,
      ownerId: d.ownerId,
      ownerName: d.owner.name,
      assignmentId: assignment?.id ?? null,
      backupUserId: assignment?.backupUserId ?? null,
      backupUserName: assignment?.backupUser?.name ?? null,
      primaryUnavailable: assignment?.primaryUnavailable ?? false,
    };
  });
}

/**
 * Comble la lacune de la phase 1 (Ruling D) : sans ceci, un chef de
 * département indisponible sans suppléant bloque définitivement toute
 * demande routée par son département, sans recours pour le Platform
 * Administrator. `backupUserId: null` retire le suppléant (supprime la
 * ligne s'il n'y a plus rien d'autre à y conserver en phase 3a).
 */
export async function setDepartmentHeadBackup(
  orgId: string,
  departmentId: string,
  backupUserId: string | null
): Promise<void> {
  const department = await prisma.department.findFirst({ where: { id: departmentId, orgId } });
  if (!department) throw new RoleAssignmentError("Département introuvable dans cette organisation");

  if (backupUserId !== null && backupUserId === department.ownerId) {
    throw new RoleAssignmentError("Le suppléant ne peut pas être la même personne que le chef de département");
  }

  const existing = await prisma.accessRoleAssignment.findFirst({
    where: { orgId, role: "DEPARTMENT_HEAD", departmentId },
  });

  if (backupUserId === null) {
    if (existing) await prisma.accessRoleAssignment.delete({ where: { id: existing.id } });
    return;
  }

  const memberCount = await prisma.user.count({ where: { id: backupUserId, orgId } });
  if (memberCount !== 1) {
    throw new RoleAssignmentError("Le suppléant n'appartient pas à cette organisation");
  }

  if (existing) {
    await prisma.accessRoleAssignment.update({
      where: { id: existing.id },
      data: { backupUserId, revision: { increment: 1 } },
    });
  } else {
    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "DEPARTMENT_HEAD", departmentId, backupUserId },
    });
  }
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/roles-server.test.ts`
Expected: tous PASS (les tests existants de la phase 1 + les 5 nouveaux).

- [ ] **Step 5: Route API — liste de couverture**

Créer `app/api/access/roles/departments/route.ts` :

```typescript
import { requireCEO } from "@/lib/auth-guard";
import { listDepartmentHeadCoverage } from "@/lib/access/roles-server";

export async function GET() {
  const session = await requireCEO();
  const data = await listDepartmentHeadCoverage(session.user.orgId);
  return Response.json({ data });
}
```

- [ ] **Step 6: Route API — assigner/retirer un suppléant**

Créer `app/api/access/roles/departments/[departmentId]/backup/route.ts` :

```typescript
import { requireCEO } from "@/lib/auth-guard";
import { setDepartmentHeadBackup, RoleAssignmentError } from "@/lib/access/roles-server";
import { z } from "zod";

const bodySchema = z.object({ backupUserId: z.string().min(1).nullable() });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ departmentId: string }> }
) {
  const session = await requireCEO();
  const { departmentId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    await setDepartmentHeadBackup(session.user.orgId, departmentId, parsed.data.backupUserId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RoleAssignmentError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 7: Composant `DepartmentHeadBackupPanel`**

Créer `components/access/DepartmentHeadBackupPanel.tsx` :

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CoverageDTO {
  departmentId: string;
  departmentName: string;
  ownerId: string;
  ownerName: string;
  assignmentId: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
}

export function DepartmentHeadBackupPanel({
  coverage,
  users,
}: {
  coverage: CoverageDTO[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [saving, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setBackup(departmentId: string, backupUserId: string | null) {
    setError(null);
    setSavingId(departmentId);
    try {
      const res = await fetch(`/api/access/roles/departments/${departmentId}/backup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupUserId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la mise à jour");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleUnavailable(assignmentId: string, current: boolean) {
    setError(null);
    const res = await fetch(`/api/access/roles/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primaryUnavailable: !current }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Erreur lors de la mise à jour");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4 mb-4">
      <h2 className="font-serif text-[16px] text-dark mb-1">Suppléants de chef de département</h2>
      <p className="text-[12px] text-izi-gray mb-3">
        Le chef de département reste toujours <code>Department.ownerId</code> — ce panneau ne
        configure que son suppléant et sa disponibilité pour le routage des approbations.
      </p>
      {error && <p className="text-[11px] text-red mb-2">{error}</p>}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="py-1 font-medium">Département</th>
            <th className="py-1 font-medium">Chef</th>
            <th className="py-1 font-medium">Suppléant</th>
            <th className="py-1 font-medium">Disponibilité</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {coverage.map((c) => (
            <tr key={c.departmentId} className="border-t border-border-soft">
              <td className="py-1">{c.departmentName}</td>
              <td className="py-1">{c.ownerName}</td>
              <td className="py-1">
                {c.backupUserName ? (
                  <span>
                    {c.backupUserName}{" "}
                    <button
                      type="button"
                      onClick={() => setBackup(c.departmentId, null)}
                      disabled={saving === c.departmentId}
                      className="text-red text-[10px] underline ml-1"
                    >
                      retirer
                    </button>
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <select
                      value={selected[c.departmentId] ?? ""}
                      onChange={(e) => setSelected((s) => ({ ...s, [c.departmentId]: e.target.value }))}
                      className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark bg-white"
                    >
                      <option value="">Choisir...</option>
                      {users
                        .filter((u) => u.id !== c.ownerId)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBackup(c.departmentId, selected[c.departmentId])}
                      disabled={!selected[c.departmentId] || saving === c.departmentId}
                      className="rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
                    >
                      Définir
                    </button>
                  </div>
                )}
              </td>
              <td className="py-1">
                {c.assignmentId ? (
                  <button
                    type="button"
                    onClick={() => toggleUnavailable(c.assignmentId as string, c.primaryUnavailable)}
                    className={`rounded-[6px] px-2 py-1 text-[11px] font-medium ${
                      c.primaryUnavailable ? "bg-red-lt text-red" : "bg-green-lt text-green"
                    }`}
                  >
                    {c.primaryUnavailable ? "Indisponible" : "Disponible"}
                  </button>
                ) : (
                  <span className="text-izi-gray">—</span>
                )}
              </td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Cette erreur de type `u.id !== c.ownerId` ci-dessus référence un champ `ownerId` absent de `CoverageDTO` tel que défini plus haut dans ce composant — corriger en ajoutant `ownerId: string` au type `CoverageDTO` de ce fichier (il existe déjà sur `DepartmentHeadCoverageDTO` côté serveur, seul le type local du composant l'omettait) avant de considérer cette étape terminée.

- [ ] **Step 8: Intégrer à la page `/access/roles`**

Modifier `app/(dashboard)/access/roles/page.tsx` (contenu actuel confirmé) : ajouter `listDepartmentHeadCoverage` à l'import existant `import { listRoleAssignments } from "@/lib/access/roles-server";` (devient `import { listRoleAssignments, listDepartmentHeadCoverage } from "@/lib/access/roles-server";`) et ajouter `import { DepartmentHeadBackupPanel } from "@/components/access/DepartmentHeadBackupPanel";`. Étendre le `Promise.all` existant (`assignments, issues, users, departments`) pour y ajouter `listDepartmentHeadCoverage(orgId)` comme cinquième élément (`coverage`). Rendre `<DepartmentHeadBackupPanel coverage={coverage} users={users} />` entre `<ConfigIssuesPanel ... />` et `<RoleAssignmentsTable ... />`. Le composant utilise `AdminPageHeader`, pas `PageHeader` — ne pas introduire `PageHeader` dans ce fichier.

- [ ] **Step 9: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur.

- [ ] **Step 10: Commit**

```bash
git add lib/access/roles-server.ts app/api/access/roles/departments/ components/access/DepartmentHeadBackupPanel.tsx "app/(dashboard)/access/roles/page.tsx" tests/unit/access-db/roles-server.test.ts
git commit -m "feat(access): suppléant de chef de département (comble Ruling D de la phase 1)"
```

---

## Task 4 : Accès Prisma — soumission de demande

**Files:**
- Create: `lib/access/requests-server.ts`
- Create: `tests/unit/access-db/requests-server.test.ts`

**Interfaces:**
- Consumes: `computeGrantRoute`, `computeReductionRoute`, `classifyRequest`, `InvalidRequestError`, `RequestKind` (Tâche 2) ; `getEffectiveRoleHolders` (phase 1, `lib/access/roles-server.ts`) ; `recordAuditInTx` (phase 1, `lib/access/audit-server.ts`).
- Produces (consommé par les Tâches 5-9) :
  - `class RequestError extends Error {}`
  - `interface RequestVersionDTO { id: string; requestId: string; versionNumber: number; kind: RequestKind; initiatorId: string; beneficiaryId: string; assetId: string; targetLevelId: string | null; justification: string; periodStart: Date; periodEnd: Date | null; state: string; exceptionReason: string | null; stages: { id: string; sequence: number; role: string; actorId: string | null; decision: string | null; reason: string | null; clarificationResponse: string | null; decidedAt: Date | null }[] }`
  - `function submitRequest(orgId: string, actorId: string, input: { beneficiaryId: string; assetId: string; targetLevelId: string | null; justification: string; periodStart?: Date; periodEnd?: Date | null }): Promise<RequestVersionDTO>`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/access-db/requests-server.test.ts` :

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { submitRequest, RequestError } from "@/lib/access/requests-server";

describe("requests-server — soumission", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let cooId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;
  let levelAdminId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Requests Org", slug: `test-requests-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso, coo] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `coo-${Date.now()}@example.com`, name: "Coo", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;
    cooId = coo.id;

    await Promise.all([
      prisma.accessProfile.create({ data: { orgId, userId: employeeId, lifecycle: "ACTIVE" } }),
      prisma.accessProfile.create({ data: { orgId, userId: deptHeadId, lifecycle: "ACTIVE" } }),
      prisma.accessProfile.create({ data: { orgId, userId: cisoId, lifecycle: "ACTIVE" } }),
      prisma.accessProfile.create({ data: { orgId, userId: cooId, lifecycle: "ACTIVE" } }),
    ]);

    const dept = await prisma.department.create({
      data: { orgId, code: "DR", name: "Dept Requests", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "COO", userId: cooId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Requests" } });
    assetId = asset.id;
    const levelReader = await prisma.accessLevel.create({
      data: { assetId, name: "Reader", priority: 1, isAdmin: false },
    });
    levelReaderId = levelReader.id;
    const levelAdmin = await prisma.accessLevel.create({
      data: { assetId, name: "Admin", priority: 10, isAdmin: true },
    });
    levelAdminId = levelAdmin.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("un employé ordinaire demandant un niveau non-admin : route chef de département → CISO", async () => {
    const version = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelReaderId,
      justification: "besoin métier",
    });
    expect(version.kind).toBe("GRANT");
    expect(version.state).toBe("PENDING_APPROVAL");
    expect(version.stages.map((s) => s.role)).toEqual(["DEPARTMENT_HEAD", "CISO"]);
    expect(version.stages.every((s) => s.decision === null)).toBe(true);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: version.id } });
    await prisma.accessRequestVersion.delete({ where: { id: version.id } });
    await prisma.accessRequest.delete({ where: { id: version.requestId } });
  });

  it("un employé ordinaire demandant un niveau admin : route chef de département → CISO → COO", async () => {
    const version = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelAdminId,
      justification: "besoin admin",
    });
    expect(version.stages.map((s) => s.role)).toEqual(["DEPARTMENT_HEAD", "CISO", "COO"]);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: version.id } });
    await prisma.accessRequestVersion.delete({ where: { id: version.id } });
    await prisma.accessRequest.delete({ where: { id: version.requestId } });
  });

  it("le titulaire COO demandant son propre accès : aucune étape, exceptionReason renseigné", async () => {
    const version = await submitRequest(orgId, cooId, {
      beneficiaryId: cooId,
      assetId,
      targetLevelId: levelAdminId,
      justification: "besoin COO",
    });
    expect(version.stages).toHaveLength(0);
    expect(version.exceptionReason).toBe("COO_SELF_REQUEST");
    expect(version.state).toBe("READY_FOR_FULFILMENT");

    await prisma.accessRequestVersion.delete({ where: { id: version.id } });
    await prisma.accessRequest.delete({ where: { id: version.requestId } });
  });

  it("une deuxième demande non terminale sur le même couple employé/actif est rejetée", async () => {
    const first = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelReaderId,
      justification: "première demande",
    });

    await expect(
      submitRequest(orgId, employeeId, {
        beneficiaryId: employeeId,
        assetId,
        targetLevelId: levelAdminId,
        justification: "deuxième demande",
      })
    ).rejects.toThrow(RequestError);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: first.id } });
    await prisma.accessRequestVersion.delete({ where: { id: first.id } });
    await prisma.accessRequest.delete({ where: { id: first.requestId } });
  });

  it("une demande dupliquée (même niveau, même période que l'existant) est rejetée avant toute écriture", async () => {
    await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });

    await expect(
      submitRequest(orgId, employeeId, {
        beneficiaryId: employeeId,
        assetId,
        targetLevelId: levelReaderId,
        justification: "doublon",
        periodEnd: null,
      })
    ).rejects.toThrow();

    const requestCount = await prisma.accessRequest.count({ where: { orgId, beneficiaryId: employeeId, assetId } });
    expect(requestCount).toBe(0);

    await prisma.accessAssignment.deleteMany({ where: { orgId, userId: employeeId, assetId } });
  });

  it("un employé DEPARTED ne peut pas soumettre de demande de GRANT", async () => {
    const departed = await prisma.user.create({
      data: { orgId, email: `departed-${Date.now()}@example.com`, name: "Departed", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: departed.id, lifecycle: "DEPARTED" } });

    await expect(
      submitRequest(orgId, departed.id, {
        beneficiaryId: departed.id,
        assetId,
        targetLevelId: levelReaderId,
        justification: "test",
      })
    ).rejects.toThrow(RequestError);

    await prisma.accessProfile.deleteMany({ where: { userId: departed.id } });
    await prisma.user.delete({ where: { id: departed.id } });
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: FAIL — `lib/access/requests-server.ts` n'existe pas.

- [ ] **Step 3: Implémenter `lib/access/requests-server.ts`**

```typescript
// lib/access/requests-server.ts
import type { Prisma, AccessRequestState, AccessRequestKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { getEffectiveRoleHolders } from "./roles-server";
import { computeGrantRoute, computeReductionRoute, classifyRequest, InvalidRequestError } from "./routing";
import type { ApprovalStageRole } from "./routing";

export class RequestError extends Error {}

export interface ApprovalStageDTO {
  id: string;
  sequence: number;
  role: ApprovalStageRole;
  actorId: string | null;
  decision: string | null;
  reason: string | null;
  clarificationResponse: string | null;
  decidedAt: Date | null;
}

export interface RequestVersionDTO {
  id: string;
  requestId: string;
  versionNumber: number;
  kind: AccessRequestKind;
  initiatorId: string;
  beneficiaryId: string;
  assetId: string;
  targetLevelId: string | null;
  justification: string;
  periodStart: Date;
  periodEnd: Date | null;
  state: AccessRequestState;
  exceptionReason: string | null;
  stages: ApprovalStageDTO[];
}

type VersionWithStages = Prisma.AccessRequestVersionGetPayload<{
  include: { stages: true; request: true };
}>;

function toVersionDTO(v: VersionWithStages): RequestVersionDTO {
  return {
    id: v.id,
    requestId: v.requestId,
    versionNumber: v.versionNumber,
    kind: v.kind,
    initiatorId: v.initiatorId,
    beneficiaryId: v.request.beneficiaryId,
    assetId: v.request.assetId,
    targetLevelId: v.targetLevelId,
    justification: v.justification,
    periodStart: v.periodStart,
    periodEnd: v.periodEnd,
    state: v.state,
    exceptionReason: v.exceptionReason,
    stages: v.stages
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        id: s.id,
        sequence: s.sequence,
        role: s.role,
        actorId: s.actorId,
        decision: s.decision,
        reason: s.reason,
        clarificationResponse: s.clarificationResponse,
        decidedAt: s.decidedAt,
      })),
  };
}

export interface SubmitRequestInput {
  beneficiaryId: string;
  assetId: string;
  targetLevelId: string | null;
  justification: string;
  periodStart?: Date;
  periodEnd?: Date | null;
}

export async function submitRequest(
  orgId: string,
  actorId: string,
  input: SubmitRequestInput
): Promise<RequestVersionDTO> {
  const [beneficiary, beneficiaryProfile, asset, targetLevel, currentAssignment, actorRoles] = await Promise.all([
    prisma.user.findFirst({ where: { id: input.beneficiaryId, orgId }, select: { id: true } }),
    prisma.accessProfile.findFirst({ where: { userId: input.beneficiaryId, orgId }, select: { lifecycle: true } }),
    prisma.accessAsset.findFirst({ where: { id: input.assetId, orgId, archivedAt: null }, select: { id: true, catalogueVersion: true } }),
    input.targetLevelId
      ? prisma.accessLevel.findFirst({
          where: { id: input.targetLevelId, assetId: input.assetId, archivedAt: null },
          select: { id: true, priority: true, isAdmin: true },
        })
      : Promise.resolve(null),
    prisma.accessAssignment.findFirst({ where: { orgId, userId: input.beneficiaryId, assetId: input.assetId } }),
    getEffectiveRoleHolders(orgId, actorId),
  ]);

  if (!beneficiary) throw new RequestError("Bénéficiaire introuvable dans cette organisation");
  if (!asset) throw new RequestError("Actif introuvable dans cette organisation");
  if (input.targetLevelId && !targetLevel) throw new RequestError("Niveau introuvable ou n'appartenant pas à cet actif");

  const currentLevelPriority = currentAssignment?.levelId
    ? (await prisma.accessLevel.findUnique({ where: { id: currentAssignment.levelId }, select: { priority: true } }))?.priority ?? null
    : null;

  const kind = classifyRequestSafe(
    currentAssignment
      ? {
          levelId: currentAssignment.levelId,
          status: currentAssignment.status,
          priority: currentLevelPriority,
          periodEnd: currentAssignment.periodEnd,
        }
      : null,
    input.targetLevelId,
    targetLevel?.priority ?? null,
    input.periodEnd ?? null
  );

  const isReduction = kind === "REDUCE" || kind === "REVOKE";
  const isSelfRequest = actorId === input.beneficiaryId;

  if (isReduction && isSelfRequest) {
    throw new RequestError("Une réduction ou révocation ne peut pas être auto-initiée par le bénéficiaire");
  }
  if (!isReduction && !isSelfRequest) {
    throw new RequestError("Seul le bénéficiaire peut initier un octroi, une montée ou un renouvellement");
  }
  if (!isReduction && (!beneficiaryProfile || beneficiaryProfile.lifecycle !== "ACTIVE")) {
    throw new RequestError("Le bénéficiaire n'est pas actif — octroi/montée/renouvellement impossible");
  }

  let stages: ApprovalStageRole[];
  let exceptionReason: string | null;

  if (isReduction) {
    const initiatorRole = pickReductionInitiatorRole(actorRoles.map((r) => r.role));
    if (!initiatorRole) {
      throw new RequestError("Seuls un chef de département, l'opérateur accès IT ou le CISO peuvent initier une réduction/révocation");
    }
    const beneficiaryRoles = await getEffectiveRoleHolders(orgId, input.beneficiaryId);
    const beneficiaryIsPrimaryCiso = beneficiaryRoles.some((r) => r.role === "CISO" && r.actsAsPrimary);
    stages = computeReductionRoute(initiatorRole, beneficiaryIsPrimaryCiso);
    exceptionReason = null;
  } else {
    const requesterRoles = actorRoles
      .filter((r): r is typeof r & { role: "COO" | "CISO" | "DEPARTMENT_HEAD" } =>
        r.role === "COO" || r.role === "CISO" || r.role === "DEPARTMENT_HEAD"
      )
      .map((r) => ({ role: r.role, actsAsPrimary: r.actsAsPrimary }));
    const route = computeGrantRoute(requesterRoles, targetLevel?.isAdmin ?? false);
    stages = route.stages;
    exceptionReason = route.exceptionReason;
  }

  const periodStart = input.periodStart ?? new Date();
  const initialState: AccessRequestState =
    stages.length === 0 ? (periodStart > new Date() ? "AUTHORIZED_WAITING_START" : "READY_FOR_FULFILMENT") : "PENDING_APPROVAL";

  try {
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.accessRequest.create({
        data: { orgId, beneficiaryId: input.beneficiaryId, assetId: input.assetId },
      });

      const version = await tx.accessRequestVersion.create({
        data: {
          requestId: request.id,
          versionNumber: 1,
          kind,
          initiatorId: actorId,
          targetLevelId: input.targetLevelId,
          justification: input.justification,
          periodStart,
          periodEnd: input.periodEnd ?? null,
          departmentSnapshot: "", // renseigné par un futur incrément si nécessaire aux vues département
          assignmentVersion: currentAssignment?.version ?? 0,
          catalogueVersion: asset.catalogueVersion,
          state: initialState,
          exceptionReason,
          stages: {
            create: stages.map((role, i) => ({ sequence: i + 1, role })),
          },
        },
        include: { stages: true, request: true },
      });

      await recordAuditInTx(tx, {
        orgId,
        actorId,
        actorRole: null,
        primaryCoveredId: input.beneficiaryId,
        scopeType: "ACCESS_REQUEST",
        scopeId: request.id,
        eventType: "REQUEST_SUBMITTED",
        objectType: "AccessRequestVersion",
        objectId: version.id,
        objectVersion: version.versionNumber,
        beneficiaryId: input.beneficiaryId,
        before: null,
        after: { kind, state: initialState, stages },
        reason: null,
        outcome: "SUCCESS",
        correlationId: null,
      });

      return version;
    });

    return toVersionDTO(created);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new RequestError("Une demande non terminale existe déjà pour cet employé et cet actif");
    }
    throw err;
  }
}

function classifyRequestSafe(
  current: Parameters<typeof classifyRequest>[0],
  targetLevelId: string | null,
  targetPriority: number | null,
  targetPeriodEnd: Date | null
) {
  try {
    return classifyRequest(current, targetLevelId, targetPriority, targetPeriodEnd);
  } catch (err) {
    if (err instanceof InvalidRequestError) throw new RequestError(err.message);
    throw err;
  }
}

function pickReductionInitiatorRole(
  roles: string[]
): "DEPARTMENT_HEAD" | "IT_ACCESS_OPERATOR" | "CISO" | null {
  if (roles.includes("CISO")) return "CISO";
  if (roles.includes("DEPARTMENT_HEAD")) return "DEPARTMENT_HEAD";
  if (roles.includes("IT_ACCESS_OPERATOR")) return "IT_ACCESS_OPERATOR";
  return null;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
```

**Note pour l'implémenteur** : `AccessAssignment` (phase 1) porte `levelId`/`status`/`periodEnd` mais pas `priority` — sa priorité vit sur `AccessLevel`. Le code ci-dessus résout déjà `currentLevelPriority` avant l'appel à `classifyRequestSafe` ; vérifier simplement que le nom de champ `status` et les valeurs `"ACTIVE"`/`"REVOKED"`/`"EXPIRED_REMOVAL_PENDING"` de `AccessAssignment` (phase 1) correspondent exactement à `CurrentAccessSnapshot["status"]` (Tâche 2) — si le schéma réel de la phase 1 utilise des libellés différents, adapter cette conversion en conséquence plutôt que renommer l'enum de la Tâche 2.

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/requests-server.ts tests/unit/access-db/requests-server.test.ts
git commit -m "feat(access): soumission de demande — classification, routage, création"
```

---

## Task 5 : Accès Prisma — décision d'étape (approve/reject/clarify/return)

**Files:**
- Modify: `lib/access/requests-server.ts`
- Modify: `tests/unit/access-db/requests-server.test.ts`

**Interfaces:**
- Consumes: `RequestVersionDTO`, `toVersionDTO`, `RequestError` (Tâche 4, même fichier) ; `getEffectiveRoleHolders`.
- Produces (consommé par les Tâches 9-10) :
  - `type DecisionType = "APPROVE" | "REJECT" | "CLARIFY" | "RETURN"`
  - `function decideStage(orgId: string, actorId: string, stageId: string, decision: DecisionType, reason: string | null, escalateToCoo?: boolean): Promise<RequestVersionDTO>`

C'est la tâche la plus sensible du plan : indépendance stricte des acteurs, revalidation systématique, escalade dynamique.

- [ ] **Step 1: Ajouter les tests**

Ajouter à `tests/unit/access-db/requests-server.test.ts`, dans un nouveau `describe` :

```typescript
describe("requests-server — décision d'étape", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let cooId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Decide Org", slug: `test-decide-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso, coo] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-d-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-d-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-d-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `coo-d-${Date.now()}@example.com`, name: "Coo", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;
    cooId = coo.id;

    await Promise.all(
      [employeeId, deptHeadId, cisoId, cooId].map((userId) =>
        prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } })
      )
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DD", name: "Dept Decide", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });

    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "COO", userId: cooId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Decide" } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  async function freshRequest() {
    return submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: levelReaderId,
      justification: "test décision",
    });
  }

  async function cleanup(version: { id: string; requestId: string }) {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: version.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: version.id } });
    await prisma.accessRequest.deleteMany({ where: { id: version.requestId } });
  }

  it("le chef de département approuve : passe à l'étape CISO, reste PENDING_APPROVAL", async () => {
    const v = await freshRequest();
    const deptStage = v.stages[0];
    const updated = await decideStage(orgId, deptHeadId, deptStage.id, "APPROVE", null);
    expect(updated.state).toBe("PENDING_APPROVAL");
    expect(updated.stages[0].decision).toBe("APPROVE");
    expect(updated.stages[0].actorId).toBe(deptHeadId);
    await cleanup(updated);
  });

  it("le CISO approuve la dernière étape : la demande devient READY_FOR_FULFILMENT", async () => {
    const v = await freshRequest();
    let updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    updated = await decideStage(orgId, cisoId, updated.stages[1].id, "APPROVE", null);
    expect(updated.state).toBe("READY_FOR_FULFILMENT");
    await cleanup(updated);
  });

  it("le bénéficiaire ne peut jamais décider une étape de sa propre demande", async () => {
    const v = await freshRequest();
    await expect(decideStage(orgId, employeeId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await cleanup(v);
  });

  it("un acteur ne peut pas décider deux étapes différentes de la même version", async () => {
    // deptHeadId est aussi promu CISO temporairement pour ce test précis
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: deptHeadId } });
    const v = await freshRequest();
    const afterFirst = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    await expect(decideStage(orgId, deptHeadId, afterFirst.stages[1].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId, role: "CISO", userId: deptHeadId } });
    await cleanup(afterFirst);
  });

  it("REJECT à n'importe quelle étape termine la demande, AccessRequest supprimé", async () => {
    const v = await freshRequest();
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "REJECT", "motif de rejet");
    expect(updated.state).toBe("REJECTED");
    const requestStillExists = await prisma.accessRequest.findUnique({ where: { id: v.requestId } });
    expect(requestStillExists).toBeNull();
    // La version reste en base pour l'historique même si AccessRequest est supprimé —
    // mais la contrainte de cascade sur AccessRequestVersion.requestId la supprime aussi.
    // Rien à nettoyer de plus ici.
  });

  it("CLARIFY laisse l'étape courante, la version passe à CLARIFICATION_REQUIRED", async () => {
    const v = await freshRequest();
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez le besoin");
    expect(updated.state).toBe("CLARIFICATION_REQUIRED");
    expect(updated.stages[0].reason).toBe("précisez le besoin");
    expect(updated.stages[0].decision).toBeNull();
    await cleanup(updated);
  });

  it("RETURN passe à REVISION_REQUIRED, motif obligatoire", async () => {
    const v = await freshRequest();
    await expect(decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", null)).rejects.toThrow(RequestError);
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir la période");
    expect(updated.state).toBe("REVISION_REQUIRED");
    await cleanup(updated);
  });

  it("REJECT sans motif est refusé", async () => {
    const v = await freshRequest();
    await expect(decideStage(orgId, deptHeadId, v.stages[0].id, "REJECT", null)).rejects.toThrow(RequestError);
    await cleanup(v);
  });

  it("escalade CISO→COO ajoute une étape COO après l'approbation CISO", async () => {
    const v = await freshRequest();
    let updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    updated = await decideStage(orgId, cisoId, updated.stages[1].id, "APPROVE", "escalade motivée", true);
    expect(updated.state).toBe("PENDING_APPROVAL");
    expect(updated.stages).toHaveLength(3);
    expect(updated.stages[2].role).toBe("COO");
    expect(updated.stages[2].decision).toBeNull();
    updated = await decideStage(orgId, cooId, updated.stages[2].id, "APPROVE", null);
    expect(updated.state).toBe("READY_FOR_FULFILMENT");
    await cleanup(updated);
  });

  it("revalidation : un niveau archivé entre soumission et décision bloque la décision", async () => {
    const v = await freshRequest();
    await prisma.accessLevel.update({ where: { id: levelReaderId }, data: { archivedAt: new Date() } });
    await expect(decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null)).rejects.toThrow(RequestError);
    await prisma.accessLevel.update({ where: { id: levelReaderId }, data: { archivedAt: null } });
    await cleanup(v);
  });

  it("escalade CISO→COO sur une RÉDUCTION ajoute COO ensuite, sans recalculer toute la route (spec §10)", async () => {
    // Une réduction routée par computeReductionRoute part avec CISO seul (jamais COO
    // automatique, même vers un niveau admin — Review Focus #4). L'escalade doit
    // ajouter une étape COO à la suite, pas remplacer/recalculer la route existante.
    await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });
    const reduction = await submitRequest(orgId, deptHeadId, {
      beneficiaryId: employeeId,
      assetId,
      targetLevelId: null,
      justification: "réduction à escalader",
    });
    expect(reduction.kind).toBe("REVOKE");
    expect(reduction.stages.map((s) => s.role)).toEqual(["CISO"]);

    const escalated = await decideStage(orgId, cisoId, reduction.stages[0].id, "APPROVE", "escalade motivée", true);
    expect(escalated.stages.map((s) => s.role)).toEqual(["CISO", "COO"]);
    expect(escalated.state).toBe("PENDING_APPROVAL");

    const final = await decideStage(orgId, cooId, escalated.stages[1].id, "APPROVE", null);
    expect(final.state).toBe("READY_FOR_FULFILMENT");

    await prisma.accessAssignment.deleteMany({ where: { orgId, userId: employeeId, assetId } });
    await cleanup(final);
  });
});
```

Ajouter `submitRequest, decideStage, RequestError` à l'import existant en tête du fichier de test.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: FAIL — `decideStage` n'existe pas.

- [ ] **Step 3: Implémenter `decideStage` dans `lib/access/requests-server.ts`**

Ajouter à la fin du fichier :

```typescript
export type DecisionType = "APPROVE" | "REJECT" | "CLARIFY" | "RETURN";

export async function decideStage(
  orgId: string,
  actorId: string,
  stageId: string,
  decision: DecisionType,
  reason: string | null,
  escalateToCoo = false
): Promise<RequestVersionDTO> {
  if ((decision === "REJECT" || decision === "CLARIFY" || decision === "RETURN") && !reason) {
    throw new RequestError("Un motif est obligatoire pour rejeter, demander une clarification ou retourner une demande");
  }

  const stage = await prisma.accessApprovalStage.findFirst({
    where: { id: stageId, requestVersion: { request: { orgId } } },
    include: { requestVersion: { include: { request: true, stages: true } } },
  });
  if (!stage) throw new RequestError("Étape introuvable dans cette organisation");
  const version = stage.requestVersion;
  const request = version.request;

  if (version.state !== "PENDING_APPROVAL") {
    throw new RequestError("Cette version n'est plus en attente d'approbation — décision refusée");
  }
  if (stage.decision !== null) {
    throw new RequestError("Cette étape a déjà été décidée");
  }

  // Indépendance : ni l'initiateur, ni le bénéficiaire, ni un acteur ayant déjà décidé une autre étape.
  if (actorId === version.initiatorId) {
    throw new RequestError("L'initiateur ne peut pas décider sa propre demande");
  }
  if (actorId === request.beneficiaryId) {
    throw new RequestError("Le bénéficiaire ne peut pas décider sa propre demande");
  }
  if (version.stages.some((s) => s.actorId === actorId && s.id !== stageId)) {
    throw new RequestError("Un même acteur ne peut pas décider deux étapes de la même version");
  }

  // Revalidation : éligibilité de l'acteur pour ce rôle d'étape, à l'instant présent.
  const effectiveRoles = await getEffectiveRoleHolders(orgId, actorId);
  const eligible = effectiveRoles.some((r) => r.role === stage.role);
  if (!eligible) {
    throw new RequestError("Vous n'êtes plus éligible pour décider cette étape");
  }
  const actedAsPrimary = effectiveRoles.some((r) => r.role === stage.role && r.actsAsPrimary);

  // Revalidation : catalogue/affectation inchangés depuis la soumission.
  const [asset, currentAssignment] = await Promise.all([
    prisma.accessAsset.findFirst({ where: { id: request.assetId, orgId }, select: { catalogueVersion: true, archivedAt: true } }),
    prisma.accessAssignment.findFirst({ where: { orgId, userId: request.beneficiaryId, assetId: request.assetId }, select: { version: true } }),
  ]);
  if (!asset || asset.archivedAt !== null || asset.catalogueVersion !== version.catalogueVersion) {
    throw new RequestError("Le catalogue a changé depuis la soumission — décision refusée, la demande doit être revue");
  }
  if ((currentAssignment?.version ?? 0) !== version.assignmentVersion) {
    throw new RequestError("L'affectation actuelle a changé depuis la soumission — décision refusée, la demande doit être revue");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.accessApprovalStage.update({
      where: { id: stageId },
      data: {
        actorId,
        actedAsPrimary,
        decision,
        reason,
        decidedAt: decision === "CLARIFY" ? null : new Date(),
      },
    });

    let newState: AccessRequestState = version.state;

    if (decision === "REJECT") {
      newState = "REJECTED";
      await tx.accessRequestVersion.update({ where: { id: version.id }, data: { state: newState } });
      await tx.accessRequest.delete({ where: { id: request.id } });
    } else if (decision === "CLARIFY") {
      newState = "CLARIFICATION_REQUIRED";
      await tx.accessRequestVersion.update({ where: { id: version.id }, data: { state: newState } });
    } else if (decision === "RETURN") {
      newState = "REVISION_REQUIRED";
      await tx.accessRequestVersion.update({ where: { id: version.id }, data: { state: newState } });
    } else {
      // APPROVE
      if (escalateToCoo && stage.role === "CISO" && !version.stages.some((s) => s.role === "COO")) {
        await tx.accessApprovalStage.create({
          data: { requestVersionId: version.id, sequence: stage.sequence + 1, role: "COO" },
        });
        newState = "PENDING_APPROVAL";
      } else {
        const remaining = await tx.accessApprovalStage.count({
          where: { requestVersionId: version.id, decision: null, id: { not: stageId } },
        });
        newState = remaining === 0
          ? version.periodStart > new Date()
            ? "AUTHORIZED_WAITING_START"
            : "READY_FOR_FULFILMENT"
          : "PENDING_APPROVAL";
      }
      await tx.accessRequestVersion.update({ where: { id: version.id }, data: { state: newState } });
    }

    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: stage.role,
      primaryCoveredId: request.beneficiaryId,
      scopeType: "ACCESS_REQUEST",
      scopeId: request.id,
      eventType: `REQUEST_${decision}`,
      objectType: "AccessApprovalStage",
      objectId: stageId,
      objectVersion: null,
      beneficiaryId: request.beneficiaryId,
      before: { decision: null },
      after: { decision, reason, newState },
      reason,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return tx.accessRequestVersion.findUnique({
      where: { id: version.id },
      include: { stages: true, request: true },
    });
  });

  return toVersionDTO(updated as VersionWithStages);
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/requests-server.ts tests/unit/access-db/requests-server.test.ts
git commit -m "feat(access): décision d'étape — approve/reject/clarify/return, revalidation, escalade"
```

---

## Task 6 : Accès Prisma — réponse à clarification, révision, annulation

**Files:**
- Modify: `lib/access/requests-server.ts`
- Modify: `tests/unit/access-db/requests-server.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède dans le même fichier (Tâches 4-5).
- Produces (consommé par la Tâche 10) :
  - `function respondToClarification(orgId: string, actorId: string, stageId: string, response: string): Promise<RequestVersionDTO>`
  - `function reviseRequest(orgId: string, actorId: string, versionId: string, changes: { targetLevelId?: string | null; justification?: string; periodStart?: Date; periodEnd?: Date | null }): Promise<RequestVersionDTO>`
  - `function cancelRequest(orgId: string, actorId: string, requestId: string): Promise<void>`

- [ ] **Step 1: Ajouter les tests**

Ajouter à `tests/unit/access-db/requests-server.test.ts`, dans un nouveau `describe` (réutiliser la structure `beforeAll`/`afterAll` du describe précédent, en créant un org/acteurs propres à ce describe pour l'isolation) :

```typescript
describe("requests-server — clarification, révision, annulation", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let cisoId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;
  let levelAdminId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Clarify Org", slug: `test-clarify-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead, ciso] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-c-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-c-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `ciso-c-${Date.now()}@example.com`, name: "Ciso", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    cisoId = ciso.id;

    await Promise.all(
      [employeeId, deptHeadId, cisoId].map((userId) =>
        prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } })
      )
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DC", name: "Dept Clarify", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: cisoId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Clarify" } });
    assetId = asset.id;
    const levelReader = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = levelReader.id;
    const levelAdmin = await prisma.accessLevel.create({ data: { assetId, name: "Admin", priority: 10, isAdmin: true } });
    levelAdminId = levelAdmin.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  async function cleanup(requestId: string) {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { requestId } } });
    await prisma.accessRequestVersion.deleteMany({ where: { requestId } });
    await prisma.accessRequest.deleteMany({ where: { id: requestId } });
  }

  it("répondre à une clarification remet la même étape à décider", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test",
    });
    const clarified = await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez");
    const responded = await respondToClarification(orgId, employeeId, v.stages[0].id, "voici la précision");
    expect(responded.state).toBe("PENDING_APPROVAL");
    expect(responded.stages[0].decision).toBeNull();
    expect(responded.stages[0].clarificationResponse).toBe("voici la précision");
    await cleanup(v.requestId);
  });

  it("seul l'initiateur peut répondre à une clarification", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test",
    });
    await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez");
    await expect(respondToClarification(orgId, deptHeadId, v.stages[0].id, "réponse")).rejects.toThrow(RequestError);
    await cleanup(v.requestId);
  });

  it("une révision crée une nouvelle version, recalcule la route, invalide l'ancienne", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "initial",
    });
    const returned = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir le niveau");
    const revised = await reviseRequest(orgId, employeeId, returned.id, { targetLevelId: levelAdminId });
    expect(revised.versionNumber).toBe(2);
    expect(revised.state).toBe("PENDING_APPROVAL");
    // Le niveau cible étant admin, la route recalculée inclut COO :
    expect(revised.stages.some((s) => s.role === "COO")).toBe(true);
    const oldVersionStillExists = await prisma.accessRequestVersion.findUnique({ where: { id: returned.id } });
    expect(oldVersionStillExists?.state).toBe("REVISION_REQUIRED");
    await cleanup(v.requestId);
  });

  it("seul l'initiateur peut réviser", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "initial",
    });
    const returned = await decideStage(orgId, deptHeadId, v.stages[0].id, "RETURN", "revoir");
    await expect(reviseRequest(orgId, deptHeadId, returned.id, { justification: "x" })).rejects.toThrow(RequestError);
    await cleanup(v.requestId);
  });

  it("l'initiateur peut annuler tant que la demande n'est pas terminale", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "à annuler",
    });
    await cancelRequest(orgId, employeeId, v.requestId);
    const stillExists = await prisma.accessRequest.findUnique({ where: { id: v.requestId } });
    expect(stillExists).toBeNull();
  });

  it("seul l'initiateur peut annuler", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test",
    });
    await expect(cancelRequest(orgId, deptHeadId, v.requestId)).rejects.toThrow(RequestError);
    await cleanup(v.requestId);
  });
});
```

Ajouter `respondToClarification, reviseRequest, cancelRequest` à l'import existant.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: FAIL — les 3 fonctions n'existent pas.

- [ ] **Step 3: Implémenter dans `lib/access/requests-server.ts`**

Ajouter à la fin du fichier. Noter que `respondToClarification` prend le **même `stageId`** que celui décidé avec `CLARIFY` (pas un id de version) — c'est cette étape qui porte `clarificationResponse` et qui est remise à zéro pour re-décision :

```typescript
export async function respondToClarification(
  orgId: string,
  actorId: string,
  stageId: string,
  response: string
): Promise<RequestVersionDTO> {
  const stage = await prisma.accessApprovalStage.findFirst({
    where: { id: stageId, requestVersion: { request: { orgId } } },
    include: { requestVersion: { include: { request: true, stages: true } } },
  });
  if (!stage) throw new RequestError("Étape introuvable dans cette organisation");
  const version = stage.requestVersion;

  if (version.state !== "CLARIFICATION_REQUIRED") {
    throw new RequestError("Cette demande n'est pas en attente de clarification");
  }
  if (actorId !== version.initiatorId) {
    throw new RequestError("Seul l'initiateur peut répondre à une clarification");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.accessApprovalStage.update({
      where: { id: stageId },
      data: { clarificationResponse: response, decision: null, decidedAt: null },
    });
    await tx.accessRequestVersion.update({
      where: { id: version.id },
      data: { state: "PENDING_APPROVAL" },
    });
    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: null,
      primaryCoveredId: version.request.beneficiaryId,
      scopeType: "ACCESS_REQUEST",
      scopeId: version.requestId,
      eventType: "REQUEST_CLARIFICATION_ANSWERED",
      objectType: "AccessApprovalStage",
      objectId: stageId,
      objectVersion: null,
      beneficiaryId: version.request.beneficiaryId,
      before: null,
      after: { clarificationResponse: response },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });
    return tx.accessRequestVersion.findUnique({ where: { id: version.id }, include: { stages: true, request: true } });
  });

  return toVersionDTO(updated as VersionWithStages);
}

export interface ReviseRequestChanges {
  targetLevelId?: string | null;
  justification?: string;
  periodStart?: Date;
  periodEnd?: Date | null;
}

export async function reviseRequest(
  orgId: string,
  actorId: string,
  versionId: string,
  changes: ReviseRequestChanges
): Promise<RequestVersionDTO> {
  const oldVersion = await prisma.accessRequestVersion.findFirst({
    where: { id: versionId, request: { orgId } },
    include: { request: true },
  });
  if (!oldVersion) throw new RequestError("Version introuvable dans cette organisation");
  if (oldVersion.state !== "REVISION_REQUIRED") {
    throw new RequestError("Cette version n'est pas en attente de révision");
  }
  if (actorId !== oldVersion.initiatorId) {
    throw new RequestError("Seul l'initiateur peut réviser sa propre demande");
  }

  const targetLevelId = changes.targetLevelId !== undefined ? changes.targetLevelId : oldVersion.targetLevelId;
  const [asset, targetLevel, currentAssignment, actorRoles] = await Promise.all([
    prisma.accessAsset.findFirst({ where: { id: oldVersion.request.assetId, orgId }, select: { catalogueVersion: true } }),
    targetLevelId
      ? prisma.accessLevel.findFirst({ where: { id: targetLevelId, assetId: oldVersion.request.assetId }, select: { priority: true, isAdmin: true } })
      : Promise.resolve(null),
    prisma.accessAssignment.findFirst({ where: { orgId, userId: oldVersion.request.beneficiaryId, assetId: oldVersion.request.assetId } }),
    getEffectiveRoleHolders(orgId, actorId),
  ]);
  if (!asset) throw new RequestError("Actif introuvable");
  if (targetLevelId && !targetLevel) throw new RequestError("Niveau introuvable ou n'appartenant pas à cet actif");

  const requesterRoles = actorRoles
    .filter((r): r is typeof r & { role: "COO" | "CISO" | "DEPARTMENT_HEAD" } =>
      r.role === "COO" || r.role === "CISO" || r.role === "DEPARTMENT_HEAD"
    )
    .map((r) => ({ role: r.role, actsAsPrimary: r.actsAsPrimary }));
  const isReduction = oldVersion.kind === "REDUCE" || oldVersion.kind === "REVOKE";
  const route = isReduction
    ? { stages: computeReductionRoute(pickReductionInitiatorRole(actorRoles.map((r) => r.role)) ?? "DEPARTMENT_HEAD", false), exceptionReason: null }
    : computeGrantRoute(requesterRoles, targetLevel?.isAdmin ?? false);

  const nextVersionNumber = oldVersion.versionNumber + 1;
  const periodStart = changes.periodStart ?? oldVersion.periodStart;
  const initialState: AccessRequestState =
    route.stages.length === 0 ? (periodStart > new Date() ? "AUTHORIZED_WAITING_START" : "READY_FOR_FULFILMENT") : "PENDING_APPROVAL";

  const created = await prisma.$transaction(async (tx) => {
    const newVersion = await tx.accessRequestVersion.create({
      data: {
        requestId: oldVersion.requestId,
        versionNumber: nextVersionNumber,
        kind: oldVersion.kind,
        initiatorId: actorId,
        targetLevelId,
        justification: changes.justification ?? oldVersion.justification,
        periodStart,
        periodEnd: changes.periodEnd !== undefined ? changes.periodEnd : oldVersion.periodEnd,
        departmentSnapshot: oldVersion.departmentSnapshot,
        assignmentVersion: currentAssignment?.version ?? 0,
        catalogueVersion: asset.catalogueVersion,
        state: initialState,
        exceptionReason: route.exceptionReason,
        stages: { create: route.stages.map((role, i) => ({ sequence: i + 1, role })) },
      },
      include: { stages: true, request: true },
    });

    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: null,
      primaryCoveredId: oldVersion.request.beneficiaryId,
      scopeType: "ACCESS_REQUEST",
      scopeId: oldVersion.requestId,
      eventType: "REQUEST_REVISED",
      objectType: "AccessRequestVersion",
      objectId: newVersion.id,
      objectVersion: newVersion.versionNumber,
      beneficiaryId: oldVersion.request.beneficiaryId,
      before: { versionNumber: oldVersion.versionNumber },
      after: { versionNumber: newVersion.versionNumber, kind: newVersion.kind, state: initialState },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return newVersion;
  });

  return toVersionDTO(created as VersionWithStages);
}

export async function cancelRequest(orgId: string, actorId: string, requestId: string): Promise<void> {
  const request = await prisma.accessRequest.findFirst({
    where: { id: requestId, orgId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!request) throw new RequestError("Demande introuvable dans cette organisation");
  const currentVersion = request.versions[0];
  if (!currentVersion || currentVersion.initiatorId !== actorId) {
    throw new RequestError("Seul l'initiateur peut annuler cette demande");
  }

  await prisma.$transaction(async (tx) => {
    await tx.accessRequestVersion.update({ where: { id: currentVersion.id }, data: { state: "CANCELLED" } });
    await tx.accessRequest.delete({ where: { id: requestId } });
    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: null,
      primaryCoveredId: request.beneficiaryId,
      scopeType: "ACCESS_REQUEST",
      scopeId: requestId,
      eventType: "REQUEST_CANCELLED",
      objectType: "AccessRequestVersion",
      objectId: currentVersion.id,
      objectVersion: currentVersion.versionNumber,
      beneficiaryId: request.beneficiaryId,
      before: null,
      after: { state: "CANCELLED" },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });
  });
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/requests-server.ts tests/unit/access-db/requests-server.test.ts
git commit -m "feat(access): réponse à clarification, révision à nouvelle version, annulation"
```

---

## Task 7 : Accès Prisma — décisions en lot

**Files:**
- Modify: `lib/access/requests-server.ts`
- Modify: `tests/unit/access-db/requests-server.test.ts`

**Interfaces:**
- Consumes: `decideStage` (Tâche 5, même fichier).
- Produces (consommé par la Tâche 11) :
  - `interface BatchDecisionItemResult { stageId: string; ok: boolean; error: string | null }`
  - `function decideBatch(orgId: string, actorId: string, items: { stageId: string; decision: DecisionType; reason: string | null; escalateToCoo?: boolean }[]): Promise<BatchDecisionItemResult[]>`

- [ ] **Step 1: Ajouter le test**

Ajouter à `tests/unit/access-db/requests-server.test.ts`, dans un nouveau `describe` (réutiliser un pattern d'organisation/acteurs similaire aux describes précédents) :

```typescript
describe("requests-server — décisions en lot", () => {
  let orgId: string;
  let employeeAId: string;
  let employeeBId: string;
  let deptHeadId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Batch Org", slug: `test-batch-decide-${Date.now()}` },
    });
    orgId = org.id;

    const [employeeA, employeeB, deptHead] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `empa-${Date.now()}@example.com`, name: "EmployeeA", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `empb-${Date.now()}@example.com`, name: "EmployeeB", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-b-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
    ]);
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    deptHeadId = deptHead.id;

    await Promise.all(
      [employeeAId, employeeBId, deptHeadId].map((userId) =>
        prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } })
      )
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DB", name: "Dept Batch", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.createMany({
      data: [{ departmentId, userId: employeeAId }, { departmentId, userId: employeeBId }],
    });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Batch" } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("chaque item du lot a un résultat indépendant — un échec n'empêche pas les autres", async () => {
    const vA = await submitRequest(orgId, employeeAId, {
      beneficiaryId: employeeAId, assetId, targetLevelId: levelReaderId, justification: "A",
    });
    const vB = await submitRequest(orgId, employeeBId, {
      beneficiaryId: employeeBId, assetId, targetLevelId: levelReaderId, justification: "B",
    });

    const results = await decideBatch(orgId, deptHeadId, [
      { stageId: vA.stages[0].id, decision: "APPROVE", reason: null },
      { stageId: "id-inexistant", decision: "APPROVE", reason: null },
      { stageId: vB.stages[0].id, decision: "APPROVE", reason: null },
    ]);

    expect(results[0]).toEqual({ stageId: vA.stages[0].id, ok: true, error: null });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ stageId: vB.stages[0].id, ok: true, error: null });

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: { in: [vA.id, vB.id] } } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: { in: [vA.id, vB.id] } } });
    await prisma.accessRequest.deleteMany({ where: { id: { in: [vA.requestId, vB.requestId] } } });
  });
});
```

Ajouter `decideBatch` à l'import existant.

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: FAIL — `decideBatch` n'existe pas.

- [ ] **Step 3: Implémenter dans `lib/access/requests-server.ts`**

Ajouter à la fin du fichier :

```typescript
export interface BatchDecisionItem {
  stageId: string;
  decision: DecisionType;
  reason: string | null;
  escalateToCoo?: boolean;
}

export interface BatchDecisionItemResult {
  stageId: string;
  ok: boolean;
  error: string | null;
}

/**
 * Chaque item est indépendant (spec §9 : "Each item has independent
 * version, decision, task, and result... proceed without waiting for
 * pending/rejected siblings") — jamais de transaction commune entre items,
 * un échec ne doit affecter aucun autre item du lot.
 */
export async function decideBatch(
  orgId: string,
  actorId: string,
  items: BatchDecisionItem[]
): Promise<BatchDecisionItemResult[]> {
  const results: BatchDecisionItemResult[] = [];
  for (const item of items) {
    try {
      await decideStage(orgId, actorId, item.stageId, item.decision, item.reason, item.escalateToCoo);
      results.push({ stageId: item.stageId, ok: true, error: null });
    } catch (err) {
      results.push({
        stageId: item.stageId,
        ok: false,
        error: err instanceof RequestError ? err.message : "Erreur inattendue",
      });
    }
  }
  return results;
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/requests-server.ts tests/unit/access-db/requests-server.test.ts
git commit -m "feat(access): décisions en lot — items indépendants, résultats individuels"
```

---

## Task 8 : Accès Prisma — lecture (mes demandes / mes approbations / initiables par département)

**Files:**
- Create: `lib/access/requests-read-server.ts`
- Create: `tests/unit/access-db/requests-read-server.test.ts`

**Interfaces:**
- Consumes: types de `requests-server.ts` (Tâches 4-7) ; `getEffectiveRoleHolders` (phase 1).
- Produces (consommé par les Tâches 12-17) :
  - `interface RequestSummaryDTO { requestId: string; versionId: string; versionNumber: number; kind: string; beneficiaryId: string; beneficiaryName: string; assetId: string; assetName: string; targetLevelId: string | null; targetLevelName: string | null; state: string; createdAt: Date; pendingClarificationStageId: string | null }`
  - `function listMyRequests(orgId: string, userId: string): Promise<RequestSummaryDTO[]>`
  - `interface PendingStageDTO extends RequestSummaryDTO { stageId: string; stageRole: string; stageSequence: number; actedAsPrimary: boolean }`
  - `function listMyApprovals(orgId: string, userId: string): Promise<PendingStageDTO[]>`
  - `interface DepartmentEmployeeAssetDTO { userId: string; userName: string; assetId: string; assetName: string; levelId: string; levelName: string }`
  - `function listDepartmentReducibleAccess(orgId: string, departmentId: string): Promise<DepartmentEmployeeAssetDTO[]>`

- [ ] **Step 1: Écrire les tests**

Créer `tests/unit/access-db/requests-read-server.test.ts` :

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { submitRequest, decideStage } from "@/lib/access/requests-server";
import { setDepartmentHeadBackup } from "@/lib/access/roles-server";
import { listMyRequests, listMyApprovals, listDepartmentReducibleAccess } from "@/lib/access/requests-read-server";

describe("requests-read-server", () => {
  let orgId: string;
  let employeeId: string;
  let deptHeadId: string;
  let departmentId: string;
  let assetId: string;
  let levelReaderId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Read Org", slug: `test-read-${Date.now()}` },
    });
    orgId = org.id;

    const [employee, deptHead] = await Promise.all([
      prisma.user.create({ data: { orgId, email: `emp-r-${Date.now()}@example.com`, name: "Employee", role: "PO" } }),
      prisma.user.create({ data: { orgId, email: `dh-r-${Date.now()}@example.com`, name: "DeptHead", role: "PO" } }),
    ]);
    employeeId = employee.id;
    deptHeadId = deptHead.id;
    await Promise.all(
      [employeeId, deptHeadId].map((userId) => prisma.accessProfile.create({ data: { orgId, userId, lifecycle: "ACTIVE" } }))
    );

    const dept = await prisma.department.create({
      data: { orgId, code: "DRD", name: "Dept Read", color: "#000000", ownerId: deptHeadId },
    });
    departmentId = dept.id;
    await prisma.departmentMember.create({ data: { departmentId, userId: employeeId } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset Read" } });
    assetId = asset.id;
    const level = await prisma.accessLevel.create({ data: { assetId, name: "Reader", priority: 1, isAdmin: false } });
    levelReaderId = level.id;
  });

  afterAll(async () => {
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.departmentMember.deleteMany({ where: { department: { orgId } } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("listMyRequests renvoie les demandes de l'utilisateur avec les noms résolus", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test lecture",
    });
    const mine = await listMyRequests(orgId, employeeId);
    expect(mine).toHaveLength(1);
    expect(mine[0].assetName).toBe("Asset Read");
    expect(mine[0].targetLevelName).toBe("Reader");
    expect(mine[0].beneficiaryName).toBe("Employee");
    expect(mine[0].pendingClarificationStageId).toBeNull();

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyRequests renvoie l'id de l'étape en attente de clarification", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test clarif",
    });
    await decideStage(orgId, deptHeadId, v.stages[0].id, "CLARIFY", "précisez");
    const mine = await listMyRequests(orgId, employeeId);
    expect(mine[0].pendingClarificationStageId).toBe(v.stages[0].id);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });

  it("listMyApprovals ne renvoie que les étapes non décidées où l'utilisateur est effectivement éligible", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test approbation",
    });
    const pending = await listMyApprovals(orgId, deptHeadId);
    expect(pending).toHaveLength(1);
    expect(pending[0].stageRole).toBe("DEPARTMENT_HEAD");

    const decided = await decideStage(orgId, deptHeadId, v.stages[0].id, "APPROVE", null);
    const afterDecision = await listMyApprovals(orgId, deptHeadId);
    expect(afterDecision).toHaveLength(0);

    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: decided.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: decided.id } });
    await prisma.accessRequest.deleteMany({ where: { id: decided.requestId } });
  });

  it("listDepartmentReducibleAccess renvoie les accès actifs des employés du département", async () => {
    await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelReaderId, status: "ACTIVE" },
    });
    const reducible = await listDepartmentReducibleAccess(orgId, departmentId);
    expect(reducible).toHaveLength(1);
    expect(reducible[0].userName).toBe("Employee");
    expect(reducible[0].levelName).toBe("Reader");
  });

  it("chef de département indisponible sans suppléant : personne n'est éligible ; configurer un suppléant le débloque (Review Focus #5)", async () => {
    const backup = await prisma.user.create({
      data: { orgId, email: `backup-r-${Date.now()}@example.com`, name: "Backup", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: backup.id, lifecycle: "ACTIVE" } });

    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "test indisponibilité",
    });
    const deptStageId = v.stages[0].id;

    // Baseline : le chef de département voit l'étape en attente.
    expect(await listMyApprovals(orgId, deptHeadId)).toHaveLength(1);

    // Il devient indisponible, sans suppléant configuré : plus personne n'est éligible —
    // ni lui, ni personne d'autre. La demande reste PENDING_APPROVAL, visible mais bloquée,
    // jamais sautée ni auto-approuvée.
    await setDepartmentHeadBackup(orgId, departmentId, backup.id); // crée la ligne AccessRoleAssignment
    const assignment = await prisma.accessRoleAssignment.findFirstOrThrow({
      where: { orgId, role: "DEPARTMENT_HEAD", departmentId },
    });
    await prisma.accessRoleAssignment.update({ where: { id: assignment.id }, data: { primaryUnavailable: true } });

    expect(await listMyApprovals(orgId, deptHeadId)).toHaveLength(0);

    // Le suppléant devient l'acteur effectif : il voit l'étape et peut la décider.
    const backupApprovals = await listMyApprovals(orgId, backup.id);
    expect(backupApprovals).toHaveLength(1);
    expect(backupApprovals[0].stageId).toBe(deptStageId);

    // Nettoyage : rendre le titulaire disponible à nouveau et retirer le suppléant pour ne
    // pas affecter les autres tests de ce describe.
    await prisma.accessRoleAssignment.update({ where: { id: assignment.id }, data: { primaryUnavailable: false } });
    await setDepartmentHeadBackup(orgId, departmentId, null);
    await prisma.accessProfile.deleteMany({ where: { userId: backup.id } });
    await prisma.user.delete({ where: { id: backup.id } });
    await prisma.accessApprovalStage.deleteMany({ where: { requestVersionId: v.id } });
    await prisma.accessRequestVersion.deleteMany({ where: { id: v.id } });
    await prisma.accessRequest.deleteMany({ where: { id: v.requestId } });
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-read-server.test.ts`
Expected: FAIL — `lib/access/requests-read-server.ts` n'existe pas.

- [ ] **Step 3: Implémenter `lib/access/requests-read-server.ts`**

```typescript
// lib/access/requests-read-server.ts
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "./roles-server";

export interface RequestSummaryDTO {
  requestId: string;
  versionId: string;
  versionNumber: number;
  kind: string;
  beneficiaryId: string;
  beneficiaryName: string;
  assetId: string;
  assetName: string;
  targetLevelId: string | null;
  targetLevelName: string | null;
  state: string;
  createdAt: Date;
  pendingClarificationStageId: string | null;
}

interface VersionForSummary {
  id: string;
  requestId: string;
  versionNumber: number;
  kind: string;
  targetLevelId: string | null;
  state: string;
  createdAt: Date;
  request: { beneficiaryId: string; assetId: string };
  stages: { id: string; decision: string | null }[];
}

async function toSummaries(versions: VersionForSummary[]): Promise<RequestSummaryDTO[]> {
  const beneficiaryIds = [...new Set(versions.map((v) => v.request.beneficiaryId))];
  const assetIds = [...new Set(versions.map((v) => v.request.assetId))];
  const levelIds = [...new Set(versions.map((v) => v.targetLevelId).filter((id): id is string => id !== null))];

  const [users, assets, levels] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: beneficiaryIds } }, select: { id: true, name: true } }),
    prisma.accessAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } }),
    levelIds.length
      ? prisma.accessLevel.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const assetNameById = new Map(assets.map((a) => [a.id, a.name]));
  const levelNameById = new Map(levels.map((l) => [l.id, l.name]));

  return versions.map((v) => ({
    requestId: v.requestId,
    versionId: v.id,
    versionNumber: v.versionNumber,
    kind: v.kind,
    beneficiaryId: v.request.beneficiaryId,
    beneficiaryName: userNameById.get(v.request.beneficiaryId) ?? "?",
    assetId: v.request.assetId,
    assetName: assetNameById.get(v.request.assetId) ?? "?",
    targetLevelId: v.targetLevelId,
    targetLevelName: v.targetLevelId ? levelNameById.get(v.targetLevelId) ?? "?" : null,
    state: v.state,
    createdAt: v.createdAt,
    pendingClarificationStageId:
      v.state === "CLARIFICATION_REQUIRED" ? v.stages.find((s) => s.decision === null)?.id ?? null : null,
  }));
}

/** Les demandes dont l'utilisateur est l'initiateur de la version courante. */
export async function listMyRequests(orgId: string, userId: string): Promise<RequestSummaryDTO[]> {
  const requests = await prisma.accessRequest.findMany({
    where: { orgId },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { request: true, stages: true } },
    },
  });
  const mine = requests
    .map((r) => r.versions[0])
    .filter((v): v is NonNullable<typeof v> => v !== undefined && v.initiatorId === userId);
  return toSummaries(mine);
}

export interface PendingStageDTO extends RequestSummaryDTO {
  stageId: string;
  stageRole: string;
  stageSequence: number;
  actedAsPrimary: boolean;
}

/** Étapes non décidées où l'utilisateur est effectivement éligible (titulaire ou suppléant actif). */
export async function listMyApprovals(orgId: string, userId: string): Promise<PendingStageDTO[]> {
  const effectiveRoles = await getEffectiveRoleHolders(orgId, userId);
  const eligibleRoles = new Set(
    effectiveRoles
      .filter((r) => r.role === "CISO" || r.role === "COO" || r.role === "DEPARTMENT_HEAD")
      .map((r) => r.role)
  );
  if (eligibleRoles.size === 0) return [];

  const pendingStages = await prisma.accessApprovalStage.findMany({
    where: {
      decision: null,
      role: { in: [...eligibleRoles] as ("DEPARTMENT_HEAD" | "CISO" | "COO")[] },
      requestVersion: { state: "PENDING_APPROVAL", request: { orgId } },
    },
    include: { requestVersion: { include: { request: true, stages: true } } },
  });

  const versions = pendingStages.map((s) => s.requestVersion);
  const summaries = await toSummaries(versions);
  const summaryByVersionId = new Map(summaries.map((s) => [s.versionId, s]));

  return pendingStages
    .map((s) => {
      const summary = summaryByVersionId.get(s.requestVersionId);
      if (!summary) return null;
      return {
        ...summary,
        stageId: s.id,
        stageRole: s.role,
        stageSequence: s.sequence,
        actedAsPrimary: effectiveRoles.some((r) => r.role === s.role && r.actsAsPrimary),
      };
    })
    .filter((x): x is PendingStageDTO => x !== null);
}

export interface DepartmentEmployeeAssetDTO {
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  levelId: string;
  levelName: string;
}

/** Accès actifs des employés du département — base pour initier une réduction/révocation. */
export async function listDepartmentReducibleAccess(
  orgId: string,
  departmentId: string
): Promise<DepartmentEmployeeAssetDTO[]> {
  const members = await prisma.departmentMember.findMany({
    where: { departmentId },
    select: { userId: true },
  });
  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return [];

  const assignments = await prisma.accessAssignment.findMany({
    where: { orgId, userId: { in: userIds }, status: "ACTIVE", levelId: { not: null } },
    include: { user: { select: { name: true } }, asset: { select: { name: true } }, level: { select: { name: true } } },
  });

  return assignments
    .filter((a) => a.level !== null)
    .map((a) => ({
      userId: a.userId,
      userName: a.user.name,
      assetId: a.assetId,
      assetName: a.asset.name,
      levelId: a.levelId as string,
      levelName: a.level!.name,
    }));
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/unit/access-db/requests-read-server.test.ts`
Expected: tous PASS.

- [ ] **Step 5: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/access/requests-read-server.ts tests/unit/access-db/requests-read-server.test.ts
git commit -m "feat(access): lecture — mes demandes, mes approbations, accès réductibles du département"
```

---

## Task 9 : Route API — soumission de demande

**Files:**
- Create: `app/api/access/requests/route.ts`

**Interfaces:**
- Consumes: `submitRequest`, `RequestError` (Tâche 4) ; `auth` (NextAuth v5, `lib/auth.ts`, phase 1).

- [ ] **Step 1: Implémenter la route**

```typescript
import { auth } from "@/lib/auth";
import { submitRequest, RequestError } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({
  beneficiaryId: z.string().min(1),
  assetId: z.string().min(1),
  targetLevelId: z.string().min(1).nullable(),
  justification: z.string().min(1).max(2000),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const version = await submitRequest(session.user.orgId, session.user.id, {
      beneficiaryId: parsed.data.beneficiaryId,
      assetId: parsed.data.assetId,
      targetLevelId: parsed.data.targetLevelId,
      justification: parsed.data.justification,
      periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
      periodEnd: parsed.data.periodEnd !== undefined ? (parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null) : undefined,
    });
    return Response.json({ data: version }, { status: 201 });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

**Note pour l'implémenteur** : vérifier dans `lib/auth.ts` (phase 1) le nom exact des champs `session.user.orgId` / `session.user.id` tels qu'exposés par le module `next-auth` augmenté du projet — s'ils diffèrent (par exemple `session.user.organizationId`), adapter cette route et toutes celles des Tâches 10-12 en conséquence plutôt que renommer le type de session.

- [ ] **Step 2: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/api/access/requests` apparaît dans la sortie du build.

- [ ] **Step 3: Commit**

```bash
git add app/api/access/requests/route.ts
git commit -m "feat(access): route API — soumission de demande"
```

---

## Task 10 : Routes API — décision, clarification, révision, annulation

**Files:**
- Create: `app/api/access/requests/stages/[stageId]/decide/route.ts`
- Create: `app/api/access/requests/stages/[stageId]/clarification-response/route.ts`
- Create: `app/api/access/requests/versions/[versionId]/revise/route.ts`
- Create: `app/api/access/requests/[requestId]/cancel/route.ts`

**Interfaces:**
- Consumes: `decideStage`, `respondToClarification`, `reviseRequest`, `cancelRequest`, `RequestError` (Tâches 5-6).

- [ ] **Step 1: Route de décision**

Créer `app/api/access/requests/stages/[stageId]/decide/route.ts` :

```typescript
import { auth } from "@/lib/auth";
import { decideStage, RequestError } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "CLARIFY", "RETURN"]),
  reason: z.string().min(1).max(2000).nullable(),
  escalateToCoo: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { stageId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const version = await decideStage(
      session.user.orgId,
      session.user.id,
      stageId,
      parsed.data.decision,
      parsed.data.reason,
      parsed.data.escalateToCoo
    );
    return Response.json({ data: version });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Route de réponse à clarification**

Créer `app/api/access/requests/stages/[stageId]/clarification-response/route.ts` :

```typescript
import { auth } from "@/lib/auth";
import { respondToClarification, RequestError } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({ response: z.string().min(1).max(2000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { stageId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const version = await respondToClarification(session.user.orgId, session.user.id, stageId, parsed.data.response);
    return Response.json({ data: version });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Route de révision**

Créer `app/api/access/requests/versions/[versionId]/revise/route.ts` :

```typescript
import { auth } from "@/lib/auth";
import { reviseRequest, RequestError } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({
  targetLevelId: z.string().min(1).nullable().optional(),
  justification: z.string().min(1).max(2000).optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { versionId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const version = await reviseRequest(session.user.orgId, session.user.id, versionId, {
      targetLevelId: parsed.data.targetLevelId,
      justification: parsed.data.justification,
      periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
      periodEnd: parsed.data.periodEnd !== undefined ? (parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null) : undefined,
    });
    return Response.json({ data: version });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Route d'annulation**

Créer `app/api/access/requests/[requestId]/cancel/route.ts` :

```typescript
import { auth } from "@/lib/auth";
import { cancelRequest, RequestError } from "@/lib/access/requests-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { requestId } = await params;

  try {
    await cancelRequest(session.user.orgId, session.user.id, requestId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 5: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; les 4 routes apparaissent dans la sortie du build.

- [ ] **Step 6: Commit**

```bash
git add app/api/access/requests/
git commit -m "feat(access): routes API — décision, réponse clarification, révision, annulation"
```

---

## Task 11 : Route API — décisions en lot

**Files:**
- Create: `app/api/access/requests/decide-batch/route.ts`

**Interfaces:**
- Consumes: `decideBatch` (Tâche 7).

- [ ] **Step 1: Implémenter la route**

```typescript
import { auth } from "@/lib/auth";
import { decideBatch } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        stageId: z.string().min(1),
        decision: z.enum(["APPROVE", "REJECT", "CLARIFY", "RETURN"]),
        reason: z.string().min(1).max(2000).nullable(),
        escalateToCoo: z.boolean().optional(),
      })
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const results = await decideBatch(session.user.orgId, session.user.id, parsed.data.items);
  return Response.json({ data: results });
}
```

- [ ] **Step 2: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/api/access/requests/decide-batch` apparaît dans la sortie du build.

- [ ] **Step 3: Commit**

```bash
git add app/api/access/requests/decide-batch/route.ts
git commit -m "feat(access): route API — décisions en lot"
```

---

## Task 12 : Routes API — lecture (mes demandes / mes approbations / accès réductibles)

**Files:**
- Create: `app/api/access/requests/mine/route.ts`
- Create: `app/api/access/requests/approvals/route.ts`
- Create: `app/api/access/requests/department/[departmentId]/reducible/route.ts`

**Interfaces:**
- Consumes: `listMyRequests`, `listMyApprovals`, `listDepartmentReducibleAccess` (Tâche 8) ; `getEffectiveRoleHolders`.

- [ ] **Step 1: Route mes demandes**

Créer `app/api/access/requests/mine/route.ts` :

```typescript
import { auth } from "@/lib/auth";
import { listMyRequests } from "@/lib/access/requests-read-server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const data = await listMyRequests(session.user.orgId, session.user.id);
  return Response.json({ data });
}
```

- [ ] **Step 2: Route mes approbations**

Créer `app/api/access/requests/approvals/route.ts` :

```typescript
import { auth } from "@/lib/auth";
import { listMyApprovals } from "@/lib/access/requests-read-server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const data = await listMyApprovals(session.user.orgId, session.user.id);
  return Response.json({ data });
}
```

- [ ] **Step 3: Route accès réductibles d'un département**

Créer `app/api/access/requests/department/[departmentId]/reducible/route.ts` — réservée au chef effectif de CE département (ou CISO/IT_ACCESS_OPERATOR, qui peuvent aussi initier des réductions company-wide, mais cette route reste scopée à un département précis pour l'écran département) :

```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listDepartmentReducibleAccess } from "@/lib/access/requests-read-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ departmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { departmentId } = await params;

  const department = await prisma.department.findFirst({
    where: { id: departmentId, orgId: session.user.orgId },
    select: { id: true },
  });
  if (!department) {
    return Response.json({ error: "Département introuvable" }, { status: 404 });
  }

  const effectiveRoles = await getEffectiveRoleHolders(session.user.orgId, session.user.id);
  const isThisDeptHead = effectiveRoles.some((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === departmentId);
  const isCompanyWideInitiator = effectiveRoles.some((r) => r.role === "CISO" || r.role === "IT_ACCESS_OPERATOR");
  if (!isThisDeptHead && !isCompanyWideInitiator) {
    return Response.json({ error: "Non autorisé pour ce département" }, { status: 403 });
  }

  const data = await listDepartmentReducibleAccess(session.user.orgId, departmentId);
  return Response.json({ data });
}
```

- [ ] **Step 4: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; les 3 routes apparaissent dans la sortie du build.

- [ ] **Step 5: Commit**

```bash
git add app/api/access/requests/mine/ app/api/access/requests/approvals/ app/api/access/requests/department/
git commit -m "feat(access): routes API — lecture mes demandes, mes approbations, accès réductibles"
```

---

## Task 13 : Écran — page /requests/mine (formulaire de soumission)

**Files:**
- Create: `app/(dashboard)/requests/mine/page.tsx`
- Create: `components/access/SubmitRequestForm.tsx`

**Interfaces:**
- Consumes: `listMyRequests` (Tâche 8, appelé côté serveur dans la page) ; route `POST /api/access/requests` (Tâche 9) ; `auth` (`lib/auth.ts`, phase 1).
- Produces: composant `SubmitRequestForm`, consommé par cette page.

- [ ] **Step 1: Créer la page**

```tsx
// app/(dashboard)/requests/mine/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMyRequests } from "@/lib/access/requests-read-server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SubmitRequestForm } from "@/components/access/SubmitRequestForm";
import { MyRequestActions } from "@/components/access/MyRequestActions";

export default async function MyRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const [myRequests, assets] = await Promise.all([
    listMyRequests(orgId, session.user.id),
    prisma.accessAsset.findMany({
      where: { orgId, archivedAt: null, requestsEnabled: true },
      select: {
        id: true,
        name: true,
        levels: { where: { archivedAt: null, enabled: true }, select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const serializedRequests = myRequests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

  return (
    <div>
      <AdminPageHeader title="Mes demandes" subtitle="Soumettre et suivre vos demandes d'accès" />
      <SubmitRequestForm assets={assets} currentUserId={session.user.id} />
      <div className="mt-6">
        <h2 className="font-serif text-[16px] text-dark mb-3">Historique</h2>
        {serializedRequests.length === 0 ? (
          <p className="text-[12px] text-izi-gray">Aucune demande pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-izi-gray text-left">
                <th className="py-1 font-medium">Actif</th>
                <th className="py-1 font-medium">Niveau visé</th>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 font-medium">Statut</th>
                <th className="py-1 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {serializedRequests.map((r) => (
                <tr key={r.versionId} className="border-t border-border-soft">
                  <td className="py-1">{r.assetName}</td>
                  <td className="py-1">{r.targetLevelName ?? "—"}</td>
                  <td className="py-1">{r.kind}</td>
                  <td className="py-1">{r.state}</td>
                  <td className="py-1">
                    <MyRequestActions
                      row={{
                        requestId: r.requestId,
                        versionId: r.versionId,
                        state: r.state,
                        stageIdIfClarification: r.pendingClarificationStageId,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

**Note pour l'implémenteur** : `AdminPageHeader` (utilisé par `app/(dashboard)/access/roles/page.tsx`, phase 1) est le composant d'en-tête déjà établi dans ce module — vérifier ses props exactes (`title`/`subtitle`) avant utilisation ; l'écran `/requests/mine` est accessible à tout utilisateur authentifié (pas de garde de rôle comme `requireCEO`), contrairement aux pages `/access/*`.

- [ ] **Step 2: Créer `SubmitRequestForm`**

```tsx
// components/access/SubmitRequestForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AssetOption {
  id: string;
  name: string;
  levels: { id: string; name: string }[];
}

export function SubmitRequestForm({
  assets,
  currentUserId,
}: {
  assets: AssetOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [assetId, setAssetId] = useState("");
  const [targetLevelId, setTargetLevelId] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedAsset = assets.find((a) => a.id === assetId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!assetId || !targetLevelId || !justification.trim()) {
      setError("Tous les champs sont obligatoires");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/access/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: currentUserId,
          assetId,
          targetLevelId,
          justification,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setError(payload?.error ?? "Échec de la soumission");
        return;
      }
      setSuccess(`Demande soumise (${payload.data.kind}), en attente d'approbation.`);
      setAssetId("");
      setTargetLevelId("");
      setJustification("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[10px] border border-border-soft bg-white p-4 space-y-3">
      <h2 className="font-serif text-[16px] text-dark">Nouvelle demande</h2>
      <div>
        <label className="block text-[11px] text-izi-gray mb-1">Actif</label>
        <select
          value={assetId}
          onChange={(e) => {
            setAssetId(e.target.value);
            setTargetLevelId("");
          }}
          className="w-full rounded-[6px] border border-teal-md px-2 py-1.5 text-[13px] text-dark bg-white"
        >
          <option value="">Choisir un actif...</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {selectedAsset && (
        <div>
          <label className="block text-[11px] text-izi-gray mb-1">Niveau souhaité</label>
          <select
            value={targetLevelId}
            onChange={(e) => setTargetLevelId(e.target.value)}
            className="w-full rounded-[6px] border border-teal-md px-2 py-1.5 text-[13px] text-dark bg-white"
          >
            <option value="">Choisir un niveau...</option>
            {selectedAsset.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="block text-[11px] text-izi-gray mb-1">Justification</label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={3}
          className="w-full rounded-[6px] border border-teal-md px-2 py-1.5 text-[13px] text-dark bg-white"
        />
      </div>
      {error && <p className="text-[11px] text-red">{error}</p>}
      {success && <p className="text-[11px] text-izi-green">{success}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-[6px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
      >
        {submitting ? "Envoi..." : "Soumettre"}
      </button>
    </form>
  );
}
```

Ce formulaire ne couvre que l'auto-soumission (GRANT/UPGRADE/RENEW pour soi-même, `beneficiaryId` toujours égal à `currentUserId`). L'initiation de réduction/révocation pour un tiers est un composant distinct (Tâche 17).

- [ ] **Step 3: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: échoue à ce stade sur l'import de `MyRequestActions` (créé en Tâche 14) — c'est attendu ; créer un stub minimal temporaire n'est pas nécessaire si les Tâches 13 et 14 sont exécutées consécutivement par le même dispatch. Si elles sont dispatchées séparément, l'implémenteur de cette tâche doit créer `components/access/MyRequestActions.tsx` comme un composant minimal (`export function MyRequestActions({ row }: { row: { requestId: string; versionId: string; state: string; stageIdIfClarification: string | null } }) { return null; }`) pour que le build passe, sachant que la Tâche 14 le remplacera entièrement.

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/requests/mine` apparaît dans la sortie du build.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/requests/mine/page.tsx" components/access/SubmitRequestForm.tsx components/access/MyRequestActions.tsx
git commit -m "feat(access): écran mes demandes — page et formulaire de soumission"
```

---

## Task 14 : Écran — actions sur mes demandes (clarifier-répondre / annuler)

**Files:**
- Modify: `components/access/MyRequestActions.tsx` (remplace le stub de la Tâche 13)

**Interfaces:**
- Consumes: routes `POST /api/access/requests/stages/[stageId]/clarification-response`, `POST /api/access/requests/[requestId]/cancel` (Tâche 10) ; `RequestSummaryDTO.pendingClarificationStageId` (Tâche 8).

- [ ] **Step 1: Implémenter `MyRequestActions`**

```tsx
// components/access/MyRequestActions.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RequestRow {
  requestId: string;
  versionId: string;
  state: string;
  stageIdIfClarification: string | null;
}

const CANCELLABLE_STATES = [
  "PENDING_APPROVAL",
  "CLARIFICATION_REQUIRED",
  "REVISION_REQUIRED",
  "AUTHORIZED_WAITING_START",
  "READY_FOR_FULFILMENT",
];

export function MyRequestActions({ row }: { row: RequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarificationText, setClarificationText] = useState("");

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/requests/${row.requestId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de l'annulation");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function respondToClarification(stageId: string) {
    if (!clarificationText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/requests/stages/${stageId}/clarification-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: clarificationText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de la réponse");
      }
      setClarificationText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  const canCancel = CANCELLABLE_STATES.includes(row.state);

  return (
    <div className="flex flex-col gap-1">
      {error && <p className="text-[10px] text-red">{error}</p>}
      {row.state === "CLARIFICATION_REQUIRED" && row.stageIdIfClarification && (
        <div className="flex items-center gap-1">
          <input
            value={clarificationText}
            onChange={(e) => setClarificationText(e.target.value)}
            placeholder="Votre réponse..."
            className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => respondToClarification(row.stageIdIfClarification as string)}
            className="rounded-[6px] bg-teal px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            Répondre
          </button>
        </div>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          className="text-[10px] text-red underline text-left"
        >
          Annuler la demande
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add components/access/MyRequestActions.tsx
git commit -m "feat(access): écran mes demandes — répondre à une clarification, annuler"
```

---

## Task 15 : Écran — page /requests/approvals (liste + décision individuelle)

**Files:**
- Create: `app/(dashboard)/requests/approvals/page.tsx`
- Create: `components/access/PendingApprovalsList.tsx`

**Interfaces:**
- Consumes: `listMyApprovals` (Tâche 8) ; route `POST /api/access/requests/stages/[stageId]/decide` (Tâche 10) ; `getEffectiveRoleHolders`, `auth`.

- [ ] **Step 1: Créer la page**

```tsx
// app/(dashboard)/requests/approvals/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listMyApprovals } from "@/lib/access/requests-read-server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PendingApprovalsList } from "@/components/access/PendingApprovalsList";

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const canApprove = effectiveRoles.some((r) => r.role === "DEPARTMENT_HEAD" || r.role === "CISO" || r.role === "COO");
  if (!canApprove) redirect("/dashboard");

  const pending = await listMyApprovals(orgId, session.user.id);
  const serialized = pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));

  return (
    <div>
      <AdminPageHeader title="Mes approbations" subtitle="Étapes de demandes d'accès en attente de votre décision" />
      <PendingApprovalsList items={serialized} />
    </div>
  );
}
```

- [ ] **Step 2: Créer `PendingApprovalsList`**

```tsx
// components/access/PendingApprovalsList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PendingItem {
  stageId: string;
  stageRole: string;
  beneficiaryName: string;
  assetName: string;
  targetLevelName: string | null;
  kind: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_HEAD: "Chef de département",
  CISO: "CISO",
  COO: "COO",
};

export function PendingApprovalsList({ items }: { items: PendingItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [escalateById, setEscalateById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(stageId: string, decision: "APPROVE" | "REJECT" | "CLARIFY" | "RETURN") {
    setError(null);
    const reason = reasonById[stageId] ?? null;
    if (decision !== "APPROVE" && !reason) {
      setError("Un motif est obligatoire pour cette décision");
      return;
    }
    setBusyId(stageId);
    try {
      const res = await fetch(`/api/access/requests/stages/${stageId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason, escalateToCoo: escalateById[stageId] ?? false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de la décision");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-[12px] text-izi-gray">Aucune approbation en attente.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[12px] text-red">{error}</p>}
      {items.map((item) => (
        <div key={item.stageId} className="rounded-[10px] border border-border-soft bg-white p-4">
          <p className="text-[13px] text-dark mb-1">
            <strong>{item.beneficiaryName}</strong> — {item.kind} — {item.assetName}
            {item.targetLevelName ? ` (${item.targetLevelName})` : ""}
          </p>
          <p className="text-[11px] text-izi-gray mb-2">Étape : {ROLE_LABELS[item.stageRole] ?? item.stageRole}</p>
          <textarea
            value={reasonById[item.stageId] ?? ""}
            onChange={(e) => setReasonById((s) => ({ ...s, [item.stageId]: e.target.value }))}
            placeholder="Motif (obligatoire sauf pour approuver)"
            rows={2}
            className="w-full rounded-[6px] border border-teal-md px-2 py-1 text-[11px] mb-2"
          />
          {item.stageRole === "CISO" && (
            <label className="flex items-center gap-1 text-[11px] text-izi-gray mb-2">
              <input
                type="checkbox"
                checked={escalateById[item.stageId] ?? false}
                onChange={(e) => setEscalateById((s) => ({ ...s, [item.stageId]: e.target.checked }))}
              />
              Escalader vers COO après approbation
            </label>
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busyId === item.stageId}
              onClick={() => decide(item.stageId, "APPROVE")}
              className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
            >
              Approuver
            </button>
            <button
              type="button"
              disabled={busyId === item.stageId}
              onClick={() => decide(item.stageId, "REJECT")}
              className="rounded-[6px] bg-red px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Rejeter
            </button>
            <button
              type="button"
              disabled={busyId === item.stageId}
              onClick={() => decide(item.stageId, "CLARIFY")}
              className="rounded-[6px] bg-gold px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Demander clarification
            </button>
            <button
              type="button"
              disabled={busyId === item.stageId}
              onClick={() => decide(item.stageId, "RETURN")}
              className="rounded-[6px] border border-teal-md px-2.5 py-1 text-[11px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50"
            >
              Retourner
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur ; `/requests/approvals` apparaît dans la sortie du build.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/requests/approvals/page.tsx" components/access/PendingApprovalsList.tsx
git commit -m "feat(access): écran mes approbations — liste et décision individuelle"
```

---

## Task 16 : Écran — décision en lot

**Files:**
- Modify: `components/access/PendingApprovalsList.tsx`

**Interfaces:**
- Consumes: route `POST /api/access/requests/decide-batch` (Tâche 11).

- [ ] **Step 1: Ajouter la multi-sélection et la décision en lot**

Remplacer entièrement `components/access/PendingApprovalsList.tsx` par :

```tsx
// components/access/PendingApprovalsList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PendingItem {
  stageId: string;
  stageRole: string;
  beneficiaryName: string;
  assetName: string;
  targetLevelName: string | null;
  kind: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_HEAD: "Chef de département",
  CISO: "CISO",
  COO: "COO",
};

interface BatchResult {
  stageId: string;
  ok: boolean;
  error: string | null;
}

export function PendingApprovalsList({ items }: { items: PendingItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [escalateById, setEscalateById] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(stageId: string, decision: "APPROVE" | "REJECT" | "CLARIFY" | "RETURN") {
    setError(null);
    const reason = reasonById[stageId] ?? null;
    if (decision !== "APPROVE" && !reason) {
      setError("Un motif est obligatoire pour cette décision");
      return;
    }
    setBusyId(stageId);
    try {
      const res = await fetch(`/api/access/requests/stages/${stageId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason, escalateToCoo: escalateById[stageId] ?? false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Échec de la décision");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusyId(null);
    }
  }

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([id]) => id);

  async function decideBatchApprove() {
    setError(null);
    setBatchResults(null);
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      const res = await fetch("/api/access/requests/decide-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedIds.map((stageId) => ({ stageId, decision: "APPROVE", reason: null })),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error ?? "Échec du lot");
      }
      setBatchResults(payload.data);
      setSelected({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBatchBusy(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-[12px] text-izi-gray">Aucune approbation en attente.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[12px] text-red">{error}</p>}
      {selectedIds.length > 0 && (
        <div className="rounded-[8px] bg-teal-lt p-3 flex items-center justify-between">
          <span className="text-[12px] text-teal-dk">{selectedIds.length} sélectionnée(s)</span>
          <button
            type="button"
            disabled={batchBusy}
            onClick={decideBatchApprove}
            className="rounded-[6px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
          >
            {batchBusy ? "Approbation..." : "Approuver la sélection"}
          </button>
        </div>
      )}
      {batchResults && (
        <p className="text-[11px] text-izi-gray">
          {batchResults.filter((r) => r.ok).length} approuvée(s), {batchResults.filter((r) => !r.ok).length} en erreur.
        </p>
      )}
      {items.map((item) => (
        <div key={item.stageId} className="rounded-[10px] border border-border-soft bg-white p-4">
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected[item.stageId] ?? false}
              onChange={(e) => setSelected((s) => ({ ...s, [item.stageId]: e.target.checked }))}
              className="mt-1"
              aria-label={`Sélectionner la demande de ${item.beneficiaryName}`}
            />
            <div className="flex-1">
              <p className="text-[13px] text-dark mb-1">
                <strong>{item.beneficiaryName}</strong> — {item.kind} — {item.assetName}
                {item.targetLevelName ? ` (${item.targetLevelName})` : ""}
              </p>
              <p className="text-[11px] text-izi-gray mb-2">Étape : {ROLE_LABELS[item.stageRole] ?? item.stageRole}</p>
              <textarea
                value={reasonById[item.stageId] ?? ""}
                onChange={(e) => setReasonById((s) => ({ ...s, [item.stageId]: e.target.value }))}
                placeholder="Motif (obligatoire sauf pour approuver)"
                rows={2}
                className="w-full rounded-[6px] border border-teal-md px-2 py-1 text-[11px] mb-2"
              />
              {item.stageRole === "CISO" && (
                <label className="flex items-center gap-1 text-[11px] text-izi-gray mb-2">
                  <input
                    type="checkbox"
                    checked={escalateById[item.stageId] ?? false}
                    onChange={(e) => setEscalateById((s) => ({ ...s, [item.stageId]: e.target.checked }))}
                  />
                  Escalader vers COO après approbation
                </label>
              )}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "APPROVE")}
                  className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
                >
                  Approuver
                </button>
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "REJECT")}
                  className="rounded-[6px] bg-red px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Rejeter
                </button>
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "CLARIFY")}
                  className="rounded-[6px] bg-gold px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Demander clarification
                </button>
                <button
                  type="button"
                  disabled={busyId === item.stageId}
                  onClick={() => decide(item.stageId, "RETURN")}
                  className="rounded-[6px] border border-teal-md px-2.5 py-1 text-[11px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50"
                >
                  Retourner
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Seul l'ajout en lot ne propose que `APPROVE` (spec §9 : « Bulk grants group existing employee requests authorized for fulfilment » — la décision en lot dans cette phase se limite à l'approbation multiple, pas au rejet en lot, qui reste une action individuelle motivée).

- [ ] **Step 2: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add components/access/PendingApprovalsList.tsx
git commit -m "feat(access): écran mes approbations — multi-sélection et approbation en lot"
```

---

## Task 17 : Écran — initiation réduction/révocation par département, entrées de menu

**Files:**
- Create: `components/access/DepartmentReductionPanel.tsx`
- Modify: `app/(dashboard)/requests/mine/page.tsx`
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `components/layout/DashboardShell.tsx`
- Modify: `components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: route `GET /api/access/requests/department/[departmentId]/reducible` (Tâche 12), route `POST /api/access/requests` (Tâche 9, avec `targetLevelId: null` pour une révocation) ; `getEffectiveRoleHolders`.

- [ ] **Step 1: Créer `DepartmentReductionPanel`**

```tsx
// components/access/DepartmentReductionPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ReducibleAccess {
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  levelId: string;
  levelName: string;
}

export function DepartmentReductionPanel({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ReducibleAccess[] | null>(null);
  const [justificationByKey, setJustificationByKey] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/access/requests/department/${departmentId}/reducible`)
      .then((r) => r.json())
      .then((body) => setItems(body.data ?? []))
      .catch(() => setError("Échec du chargement"));
  }, [departmentId]);

  async function submitRevoke(item: ReducibleAccess) {
    const key = `${item.userId}:${item.assetId}`;
    const justification = justificationByKey[key];
    if (!justification?.trim()) {
      setError("Justification obligatoire");
      return;
    }
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/access/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: item.userId,
          assetId: item.assetId,
          targetLevelId: null,
          justification,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Échec de la soumission");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusyKey(null);
    }
  }

  if (items === null) return <p className="text-[12px] text-izi-gray">Chargement...</p>;
  if (items.length === 0) return <p className="text-[12px] text-izi-gray">Aucun accès à réduire dans ce département.</p>;

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4 mb-6">
      <h2 className="font-serif text-[16px] text-dark mb-3">Initier une révocation (département)</h2>
      {error && <p className="text-[11px] text-red mb-2">{error}</p>}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="py-1 font-medium">Employé</th>
            <th className="py-1 font-medium">Actif</th>
            <th className="py-1 font-medium">Niveau actuel</th>
            <th className="py-1 font-medium">Justification</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = `${item.userId}:${item.assetId}`;
            return (
              <tr key={key} className="border-t border-border-soft">
                <td className="py-1">{item.userName}</td>
                <td className="py-1">{item.assetName}</td>
                <td className="py-1">{item.levelName}</td>
                <td className="py-1">
                  <input
                    value={justificationByKey[key] ?? ""}
                    onChange={(e) => setJustificationByKey((s) => ({ ...s, [key]: e.target.value }))}
                    className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px] w-full"
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    disabled={busyKey === key}
                    onClick={() => submitRevoke(item)}
                    className="rounded-[6px] bg-red px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Révoquer
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

Ce panneau ne couvre que la révocation complète (`targetLevelId: null`). La réduction vers un niveau inférieur suit la même route avec un `targetLevelId` non nul — hors périmètre de ce composant minimal ; noter comme limitation connue dans le ledger, non bloquante (la révocation seule couvre déjà le cas d'usage principal du spec pour les départs de logiciel).

- [ ] **Step 2: Intégrer à la page `/requests/mine`**

Modifier `app/(dashboard)/requests/mine/page.tsx` : ajouter l'import `import { getEffectiveRoleHolders } from "@/lib/access/roles-server";` et `import { DepartmentReductionPanel } from "@/components/access/DepartmentReductionPanel";`. Calculer, avant le `return`, `const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);` puis `const headedDepartmentIds = effectiveRoles.filter((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId !== null).map((r) => r.departmentId as string);`. Rendre `{headedDepartmentIds.map((id) => (<DepartmentReductionPanel key={id} departmentId={id} />))}` juste avant `<SubmitRequestForm ... />`.

- [ ] **Step 3: Ajouter l'entrée de menu**

Lire d'abord `app/(dashboard)/layout.tsx`, `components/layout/DashboardShell.tsx` et `components/layout/Sidebar.tsx` pour confirmer le thread exact des props déjà établi en phase 1/2 pour `canManageAccessRoles`/`canManageAccessAssets`/`canViewAccessAudit` (calculées une fois dans `layout.tsx` via `getEffectiveRoleHolders`, transmises à `DashboardShell`, puis à `Sidebar`). Suivre exactement ce même schéma pour ajouter deux nouveaux booléens calculés depuis les rôles effectifs déjà chargés dans `layout.tsx` (ne pas dupliquer l'appel à `getEffectiveRoleHolders`) :
- `showRequestsMenu: boolean` — toujours `true` pour tout utilisateur authentifié (lien vers `/requests/mine`).
- `canApproveRequests: boolean` — `true` si `effectiveRoles.some((r) => r.role === "DEPARTMENT_HEAD" || r.role === "CISO" || r.role === "COO")` (lien conditionnel vers `/requests/approvals`).

Dans `Sidebar.tsx`, ajouter l'entrée `/requests/mine` (label « Mes demandes ») au tableau `NAV_ITEMS` existant sans condition de rôle, et l'entrée `/requests/approvals` (label « Mes approbations ») conditionnée par la nouvelle prop `canApproveRequests`, en suivant le même style de rendu conditionnel déjà utilisé pour les entrées `/access/*`.

- [ ] **Step 4: Vérification des types et du build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add components/access/DepartmentReductionPanel.tsx "app/(dashboard)/requests/mine/page.tsx" "app/(dashboard)/layout.tsx" components/layout/DashboardShell.tsx components/layout/Sidebar.tsx
git commit -m "feat(access): écran d'initiation de révocation par département, entrées de menu"
```

---

## Task 18 : Vérification finale de la phase 3a

**Files:** aucun fichier nouveau — tâche de vérification globale.

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les tests passent, y compris les nouveaux fichiers `tests/unit/access-routing.test.ts`, `tests/unit/access-db/requests-server.test.ts`, `tests/unit/access-db/requests-read-server.test.ts`, et l'extension de `tests/unit/access-db/roles-server.test.ts` (nécessite `docker compose up -d db` actif).

- [ ] **Step 2: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: aucune erreur nouvelle dans `lib/access/`, `app/api/access/`, `app/(dashboard)/access/`, `app/(dashboard)/requests/`, `components/access/`. Les avertissements préexistants ailleurs dans le projet sont acceptables.

- [ ] **Step 4: Build de production**

Run: `npm run build`
Expected: build réussi ; `/requests/mine`, `/requests/approvals`, et toutes les routes `/api/access/requests/**` et `/api/access/roles/departments/**` apparaissent dans la sortie du build.

- [ ] **Step 5: Revue manuelle des 5 points du Review Focus**

Reprendre la liste « Review Focus » en tête de ce document et confirmer pour chacun qu'un test réel existe et passe :
1. Suppléant n'hérite jamais d'une exemption personnelle — Tâche 2, tests dédiés dans `computeGrantRoute`.
2. Un acteur ne signe jamais deux étapes de la même version — Tâche 5, test dédié.
3. Revalidation catalogue/affectation avant décision — Tâche 5, test dédié (niveau archivé entretemps).
4. Réduction/révocation vers un niveau admin n'ajoute jamais COO automatiquement — Tâche 2, test dédié dans `computeReductionRoute` ; escalade CISO→COO sur une réduction testée spécifiquement en Tâche 5 (spec §10).
5. Chef de département indisponible sans suppléant = problème de routage visible (personne n'est éligible, aucun saut automatique), ET peut désormais être résolu une fois un suppléant configuré — test de bout en bout en Tâche 8 (`listMyApprovals` avant/après `setDepartmentHeadBackup` + `primaryUnavailable`), bâti sur la fonction de la Tâche 3 qui comble ce qui était auparavant un vrai blocage sans issue.

Si un point manque un test réel, l'ajouter avant de considérer la phase 3a terminée.

- [ ] **Step 6: Vérification manuelle en navigateur**

Build de production locale, avec au moins 4 comptes de test (employé, chef de département de l'employé, CISO, COO — utiliser le mécanisme d'auto-attribution de rôle déjà établi en phase 1/2 pour les tests manuels) :
- Soumettre une demande de GRANT niveau non-admin en tant qu'employé → vérifier la route affichée (chef de département → CISO).
- Approuver en tant que chef de département → la demande passe à l'étape CISO.
- Approuver en tant que CISO avec escalade cochée → une étape COO apparaît.
- Approuver en tant que COO → la demande passe à `READY_FOR_FULFILMENT`.
- Tester un rejet, une clarification (avec réponse), une révision (avec recalcul de route affiché), une annulation.
- Initier une révocation depuis la vue département, vérifier qu'elle route bien vers CISO.
- Vérifier que `/access/audit` (phase 1) affiche tous ces événements avec les bons acteurs/motifs.
- Configurer un suppléant de chef de département (`/access/roles`), le rendre actif en marquant le titulaire indisponible, vérifier qu'une nouvelle demande route bien vers le suppléant.

- [ ] **Step 7: Commit final si des ajustements ont été faits**

```bash
git add -A
git commit -m "chore(access): vérification finale de la phase 3a (tests, types, lint, build)"
```

Si aucun ajustement n'était nécessaire, ne rien committer à cette étape.
