# Gestion des accès — Phase 1 : fondations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser les fondations du module de gestion des accès applicatifs : rôles du module avec suppléants, catalogue d'applications/niveaux, registre des affectations courantes (vide, prêt pour la phase 2), et journal d'audit, avec trois écrans d'administration.

**Architecture:** Nouveau schéma Prisma additif (`orgId` sur chaque table), package `lib/access/` séparant les fonctions pures (règles de suppléance, portée, catalogue) des accès Prisma (`*-server.ts`), sur le modèle de `lib/evaluation.ts` / `lib/evaluation-server.ts`. Le `CEO` existant est l'« administrateur de plateforme » : aucun nouveau mécanisme de super-utilisateur. Toute mutation écrit un événement d'audit dans la même transaction.

**Tech Stack:** Next.js 16 (App Router, Server Components + Route Handlers), Prisma 6 / PostgreSQL 16, Zod, Vitest, TypeScript strict, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-28-access-management-phase1-design.md`

## Global Constraints

- Toute nouvelle table porte `orgId` (`Organization`, cascade) — isolation multi-tenant obligatoire dans tout le projet.
- Aucun rôle du module n'est attribué automatiquement lors de la migration ou du déploiement (spec §3, invariant implicite de la conception).
- L'acteur et la portée viennent toujours de la session et de la base, jamais d'un champ envoyé par le client (spec §12).
- Les identifiants d'utilisateur dans `AccessAssignmentEvent` et `AccessAuditEvent` sont de simples chaînes, sans clé étrangère (conception §5).
- `isAdmin` et `priority` ne sont jamais déduits du rang ou du nom d'un niveau — toujours des valeurs explicites, potentiellement nulles pour un brouillon (spec §4).
- Le journal d'audit est en ajout seul côté application : aucune route de modification ou de suppression n'est exposée (spec §13).
- Toute table mutable porte `revision` ou `version` ; une écriture concurrente sur une révision périmée est rejetée explicitement (conception §5).
- Français partout : libellés d'UI, messages d'erreur, noms de colonnes de l'export CSV, commentaires expliquant un pourquoi non évident.
- `npm test` (Vitest) et `npx tsc --noEmit` doivent rester au vert après chaque tâche.

## Review Focus

- **Deux titulaires CISO ou deux titulaires COO dans la même org** : la spec exige un seul titulaire principal de chacun pour un routage déterministe (§3) ; sans contrainte, une deuxième attribution silencieuse casserait le routage des phases 3-4. Testé dans la Tâche 3 (contrainte en base) et la Tâche 10 (rejet API explicite).
- **Suppléant identique au titulaire** : la spec l'interdit explicitement pour tout rôle (§3.2). Testé dans la Tâche 4 (fonction pure) et la Tâche 10 (validation applicative).
- **Deux lignes d'affectation courante pour le même employé et le même actif** : la spec exige *au plus une* ligne par (employé, actif), garantie par une contrainte transactionnelle, pas seulement applicative (§4, invariant 5). Testé dans la Tâche 3 (contrainte unique en base, tentative d'insertion en double).
- **Employé sans département, ou membre de plusieurs départements** : la spec impose *un* département principal effectif ; sans department unique, l'administrateur de plateforme doit pouvoir le choisir (§3). Testé dans la Tâche 8 (résolveur de département principal) et la Tâche 16 (écran, cas multi-département).
- **Titulaire désactivé ou en `OFFBOARDING`/`DEPARTED`** : compte comme indisponible même sans bascule explicite de disponibilité (§3.2 « Disabled/departing primaries count as unavailable »). Testé dans la Tâche 4 (fonction pure `resolveActingUser`).

---

## File Structure

```
prisma/
  schema.prisma                                    (modifié — nouveaux enums + modèles)
  migrations/<timestamp>_add_access_management/
    migration.sql                                  (créé — additif, SQL brut pour index partiels/CHECK)

lib/access/
  types.ts                                          (créé — types partagés du module)
  roles.ts                                          (créé — fonctions pures : résolution acteur/suppléant)
  roles-server.ts                                   (créé — Prisma : CRUD rôles/suppléants)
  scope.ts                                          (créé — fonctions pures : filtre de portée par rôle)
  catalogue.ts                                      (créé — fonctions pures : règles priorité/isAdmin/version/prêt)
  catalogue-server.ts                                (créé — Prisma : CRUD actifs/niveaux)
  profile-server.ts                                  (créé — Prisma : AccessProfile, département principal)
  audit.ts                                          (créé — fonctions pures : construction de l'événement + échappement CSV)
  audit-server.ts                                    (créé — Prisma : recordAudit(tx, …), requête paginée)
  audit-guard.ts                                     (créé — garde d'accès Audit Viewer effectif)
  asset-admin-guard.ts                                (créé — garde d'accès Asset Administrator effectif)

lib/validations/
  access.ts                                         (créé — schémas Zod : rôles, actifs, niveaux, audit)

app/api/access/
  roles/route.ts                                    (créé — GET liste, POST attribuer)
  roles/[assignmentId]/route.ts                     (créé — PATCH suppléant/disponibilité, DELETE)
  profiles/route.ts                                 (créé — GET profils + problèmes de configuration)
  profiles/[userId]/route.ts                        (créé — PATCH département principal, motif)
  assets/route.ts                                   (créé — GET liste, POST créer)
  assets/[assetId]/route.ts                         (créé — PATCH modifier/archiver)
  assets/[assetId]/levels/route.ts                  (créé — GET liste, POST créer)
  assets/[assetId]/levels/[levelId]/route.ts         (créé — PATCH modifier/archiver)
  audit/route.ts                                    (créé — GET paginé + filtres)
  audit/export/route.ts                              (créé — GET CSV)

app/(dashboard)/access/
  roles/page.tsx                                    (créé — écran Administration des rôles)
  assets/page.tsx                                    (créé — écran Administration des actifs)
  audit/page.tsx                                     (créé — écran Journal d'audit)

components/access/
  RoleAssignmentsTable.tsx                          (créé — tableau + bascule disponibilité)
  RoleAssignmentFormModal.tsx                       (créé — formulaire attribuer/modifier un rôle)
  ConfigIssuesPanel.tsx                              (créé — départements sans chef / employés sans département principal)
  AssetsTable.tsx                                    (créé — liste des actifs, indicateur « prêt aux demandes »)
  AssetFormModal.tsx                                 (créé — formulaire créer/modifier un actif)
  AssetLevelsPanel.tsx                                (créé — niveaux d'un actif, réordonnancement, drapeau admin)
  AccessAuditTable.tsx                                (créé — tableau paginé + filtres + bouton export)

tests/unit/
  access-roles.test.ts                              (créé)
  access-scope.test.ts                              (créé)
  access-catalogue.test.ts                          (créé)
  access-audit.test.ts                              (créé)

tests/unit/access-db/
  access-constraints.test.ts                        (créé — contraintes en base, vraie connexion Postgres locale)

app/(dashboard)/layout.tsx                          (modifié — calcul de la visibilité du menu Accès)
components/layout/DashboardShell.tsx                (modifié — propagation showAccessMenu)
components/layout/Sidebar.tsx                       (modifié — entrée de menu « Accès »)
prisma/seed.ts                                      (modifié — création des profils d'accès)
app/api/admin/users/route.ts                        (modifié — création du profil d'accès à la création d'un utilisateur)
```

## Interfaces at a Glance

Ce bloc résume les signatures que les tâches ultérieures consomment ; chaque tâche redonne le détail exact dans sa propre section.

- `lib/access/roles.ts` → `resolveActingUser(assignment, availability): ActingUser | null`, `isAvailable(user): boolean`
- `lib/access/scope.ts` → `resolveReadScopes(userId, effectiveRoles, ownedAssetIds): ReadScope[]`
- `lib/access/catalogue.ts` → `isReadyForRequests(asset, levels): boolean`, `catalogueChangeRequiresVersionBump(fields): boolean`, `nextCatalogueVersion(current): number`
- `lib/access/audit.ts` → `buildAuditEvent(input): AuditEventInput`, `escapeCsvField(value): string`, `toCsvRow(fields): string`
- `lib/access/audit-server.ts` → `recordAudit(input): Promise<void>`, `recordAuditInTx(tx, input): Promise<void>`, `queryAuditEvents(orgId, filters, pagination): Promise<{rows, total}>`
- `lib/access/roles-server.ts` → `listRoleAssignments(orgId)`, `getEffectiveRoleHolders(orgId, userId): Promise<EffectiveRole[]>`, `upsertRoleAssignment(input)`, `setPrimaryUnavailable(id, orgId, bool)`, `deleteRoleAssignment(id, orgId)`
- `lib/access/profile-server.ts` → `ensureAccessProfile(tx, orgId, userId): Promise<void>`, `resolvePrimaryDepartment(tx, userId): Promise<string | null>`, `listConfigIssues(orgId)`
- `lib/access/catalogue-server.ts` → `listAssets(orgId)`, `createAsset(input)`, `updateAsset(id, orgId, input)`, `archiveAsset(id, orgId)`, `createLevel(assetId, orgId, input)`, `updateLevel(id, orgId, input)`, `archiveLevel(id, orgId)`

---

## Task 1: Enums et modèles Prisma

**Files:**
- Modify: `prisma/schema.prisma` (ajout en fin de fichier, avant le dernier modèle existant)

**Interfaces:**
- Produces: enums `AccessModuleRole`, `AccessLifecycle`, `AccessAssignmentStatus`, `AccessVerification`, `AccessAssignmentSource` ; modèles `AccessProfile`, `AccessRoleAssignment`, `AccessAsset`, `AccessLevel`, `AccessAssignment`, `AccessAssignmentEvent`, `AccessAuditEvent`. Tous les champs et noms de relations ci-dessous sont ceux que les tâches suivantes utilisent verbatim.

- [ ] **Step 1: Ajouter les enums**

Ajouter dans `prisma/schema.prisma`, dans la section des enums (après `enum SupportRequestPriority`, avant les modèles) :

```prisma
enum AccessModuleRole {
  IT_ACCESS_OPERATOR
  HR
  CISO
  COO
  ASSET_ADMINISTRATOR
  AUDIT_VIEWER
  DEPARTMENT_HEAD
}

enum AccessLifecycle {
  ACTIVE
  OFFBOARDING
  DEPARTED
}

enum AccessAssignmentStatus {
  ACTIVE
  EXPIRED_REMOVAL_PENDING
  REVOKED
}

enum AccessVerification {
  IMPORTED_UNREVIEWED
  OWNER_CONFIRMED
}

enum AccessAssignmentSource {
  LEGACY_IMPORT
  REQUEST
}
```

- [ ] **Step 2: Ajouter les modèles**

Ajouter à la fin de `prisma/schema.prisma` :

```prisma
// ============================================================================
// GESTION DES ACCÈS — Phase 1 (registre, rôles, catalogue, audit)
// ============================================================================

model AccessProfile {
  id                  String          @id @default(cuid())
  orgId               String
  userId              String          @unique
  primaryDepartmentId String?
  lifecycle           AccessLifecycle @default(ACTIVE)
  revision            Int             @default(1)
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  org               Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  primaryDepartment Department?  @relation(fields: [primaryDepartmentId], references: [id], onDelete: SetNull)

  @@index([orgId, lifecycle])
  @@map("access_profiles")
}

model AccessRoleAssignment {
  id                 String           @id @default(cuid())
  orgId              String
  role               AccessModuleRole
  userId             String?
  departmentId       String?
  backupUserId       String?
  primaryUnavailable Boolean          @default(false)
  revision           Int              @default(1)
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  org        Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user       User?        @relation("AccessRoleHolder", fields: [userId], references: [id], onDelete: Cascade)
  department Department?  @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  backupUser User?        @relation("AccessRoleBackup", fields: [backupUserId], references: [id], onDelete: SetNull)

  @@unique([orgId, role, userId])
  @@unique([orgId, departmentId])
  @@index([orgId, role])
  @@map("access_role_assignments")
}

model AccessAsset {
  id               String    @id @default(cuid())
  orgId            String
  name             String
  description      String?   @db.Text
  ownerId          String?
  backupOwnerId    String?
  requestsEnabled  Boolean   @default(false)
  catalogueVersion Int       @default(1)
  revision         Int       @default(1)
  sourceLabel      String?
  archivedAt       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  org         Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner       User?         @relation("AccessAssetOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  backupOwner User?         @relation("AccessAssetBackupOwner", fields: [backupOwnerId], references: [id], onDelete: SetNull)
  levels      AccessLevel[]

  @@unique([orgId, name])
  @@map("access_assets")
}

model AccessLevel {
  id          String    @id @default(cuid())
  assetId     String
  name        String
  priority    Int?
  isAdmin     Boolean?
  enabled     Boolean   @default(true)
  revision    Int       @default(1)
  sourceLabel String?
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  asset AccessAsset @relation(fields: [assetId], references: [id], onDelete: Cascade)

  @@unique([assetId, name])
  @@index([assetId])
  @@map("access_levels")
}

model AccessAssignment {
  id           String                 @id @default(cuid())
  orgId        String
  userId       String
  assetId      String
  levelId      String?
  status       AccessAssignmentStatus @default(ACTIVE)
  verification AccessVerification?
  source       AccessAssignmentSource @default(LEGACY_IMPORT)
  periodStart  DateTime?
  periodEnd    DateTime?
  grantedAt    DateTime?
  revokedAt    DateTime?
  version      Int                    @default(1)
  createdAt    DateTime               @default(now())
  updatedAt    DateTime               @updatedAt

  org   Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user  User         @relation("AccessAssignmentUser", fields: [userId], references: [id], onDelete: Cascade)
  asset AccessAsset  @relation(fields: [assetId], references: [id], onDelete: Cascade)
  level AccessLevel? @relation(fields: [levelId], references: [id], onDelete: SetNull)

  @@unique([userId, assetId])
  @@index([orgId, assetId])
  @@index([orgId, userId])
  @@index([orgId, status])
  @@map("access_assignments")
}

model AccessAssignmentEvent {
  id            String            @id @default(cuid())
  orgId         String
  assignmentId  String
  userId        String
  assetId       String
  beforeLevelId String?
  afterLevelId  String?
  actorId       String?
  actorRole     AccessModuleRole?
  sourceType    String
  sourceId      String?
  outcome       String
  occurredAt    DateTime          @default(now())

  org        Organization     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  assignment AccessAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)

  @@index([orgId, assignmentId])
  @@map("access_assignment_events")
}

model AccessAuditEvent {
  id               String            @id @default(cuid())
  orgId            String
  occurredAt       DateTime          @default(now())
  actorId          String
  actorRole        AccessModuleRole?
  primaryCoveredId String?
  scopeType        String
  scopeId          String?
  eventType        String
  objectType       String
  objectId         String
  objectVersion    Int?
  beneficiaryId    String?
  before           Json?
  after            Json?
  reason           String?           @db.Text
  outcome          String
  correlationId    String?

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, occurredAt])
  @@index([orgId, objectType, objectId])
  @@index([orgId, beneficiaryId])
  @@index([orgId, actorId])
  @@index([orgId, correlationId])
  @@map("access_audit_events")
}
```

- [ ] **Step 3: Ajouter les relations inverses sur `Organization`, `User` et `Department`**

Dans `model Organization`, section Relations, ajouter :

```prisma
  accessProfiles         AccessProfile[]
  accessRoleAssignments  AccessRoleAssignment[]
  accessAssets           AccessAsset[]
  accessAssignments      AccessAssignment[]
  accessAssignmentEvents AccessAssignmentEvent[]
  accessAuditEvents      AccessAuditEvent[]
```

Dans `model User`, section Relations, ajouter :

```prisma
  accessProfile           AccessProfile?
  accessRoleAssignments   AccessRoleAssignment[] @relation("AccessRoleHolder")
  accessRoleBackupFor     AccessRoleAssignment[] @relation("AccessRoleBackup")
  ownedAccessAssets       AccessAsset[]          @relation("AccessAssetOwner")
  backupAccessAssets      AccessAsset[]          @relation("AccessAssetBackupOwner")
  accessAssignments       AccessAssignment[]     @relation("AccessAssignmentUser")
```

Dans `model Department`, section Relations, ajouter :

```prisma
  accessProfiles       AccessProfile[]
  accessRoleAssignment AccessRoleAssignment?
```

- [ ] **Step 4: Valider le schéma**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Générer le client Prisma**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` sans erreur.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(access): schéma Prisma des fondations de la gestion des accès"
```

---

## Task 2: Migration additive (SQL brut, sans DB)

**Files:**
- Create: `prisma/migrations/<TIMESTAMP>_add_access_management/migration.sql` (timestamp `YYYYMMDDHHMMSS`, ex. `20260928120000`)

**Interfaces:**
- Consumes: le schéma de la Tâche 1.
- Produces: les tables en base, plus les contraintes que Prisma ne sait pas exprimer (index uniques partiels, `CHECK`).

- [ ] **Step 1: Générer le diff SQL (sans base de données requise)**

Suivre la mémoire `reference-prisma-migration-no-db` : ne jamais rediriger `stderr` dans le fichier SQL.

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema-before-access.prisma
npx prisma migrate diff \
  --from-schema-datamodel /tmp/schema-before-access.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  2>/dev/null > /tmp/access-migration-draft.sql
head -3 /tmp/access-migration-draft.sql
```

Expected: les 3 premières lignes commencent par `-- CreateEnum` ou `-- CreateTable`, jamais par `warn`.

- [ ] **Step 2: Copier le SQL généré dans le dossier de migration**

```bash
mkdir -p "prisma/migrations/20260928120000_add_access_management"
cp /tmp/access-migration-draft.sql "prisma/migrations/20260928120000_add_access_management/migration.sql"
```

- [ ] **Step 3: Ajouter les contraintes que Prisma ne génère pas**

Ajouter à la fin de `prisma/migrations/20260928120000_add_access_management/migration.sql` :

```sql
-- Un seul titulaire CISO et un seul titulaire COO par organisation (routage déterministe, spec §3).
CREATE UNIQUE INDEX "access_role_assignments_org_ciso_unique"
  ON "access_role_assignments" ("orgId")
  WHERE "role" = 'CISO' AND "userId" IS NOT NULL;

CREATE UNIQUE INDEX "access_role_assignments_org_coo_unique"
  ON "access_role_assignments" ("orgId")
  WHERE "role" = 'COO' AND "userId" IS NOT NULL;

-- Une affectation de rôle porte soit un titulaire (userId), soit un département
-- (DEPARTMENT_HEAD), jamais aucun des deux ni les deux à la fois.
ALTER TABLE "access_role_assignments"
  ADD CONSTRAINT "access_role_assignments_holder_check"
  CHECK (
    ("role" = 'DEPARTMENT_HEAD' AND "departmentId" IS NOT NULL AND "userId" IS NULL)
    OR ("role" != 'DEPARTMENT_HEAD' AND "userId" IS NOT NULL AND "departmentId" IS NULL)
  );

-- Le suppléant n'est jamais la même personne que le titulaire.
ALTER TABLE "access_role_assignments"
  ADD CONSTRAINT "access_role_assignments_backup_distinct_check"
  CHECK ("backupUserId" IS NULL OR "backupUserId" != "userId");

-- Priorité positive uniquement si renseignée (les brouillons d'import ont priority NULL).
ALTER TABLE "access_levels"
  ADD CONSTRAINT "access_levels_priority_positive_check"
  CHECK ("priority" IS NULL OR "priority" > 0);

-- Priorité unique parmi les niveaux activés et non archivés d'un même actif
-- (la spec autorise des priorités non définies ou dupliquées sur des brouillons
-- désactivés, mais jamais sur deux niveaux sélectionnables du même actif).
CREATE UNIQUE INDEX "access_levels_asset_priority_unique"
  ON "access_levels" ("assetId", "priority")
  WHERE "enabled" = true AND "archivedAt" IS NULL AND "priority" IS NOT NULL;

-- Le propriétaire de secours d'un actif n'est jamais le propriétaire principal.
ALTER TABLE "access_assets"
  ADD CONSTRAINT "access_assets_backup_owner_distinct_check"
  CHECK ("backupOwnerId" IS NULL OR "backupOwnerId" != "ownerId");
```

- [ ] **Step 4: Vérifier que le fichier ne contient aucun avertissement Prisma**

```bash
head -3 "prisma/migrations/20260928120000_add_access_management/migration.sql"
grep -c "^warn" "prisma/migrations/20260928120000_add_access_management/migration.sql"
```

Expected: les 3 premières lignes sont du SQL valide (`-- CreateEnum` etc.), et le `grep -c` renvoie `0`.

- [ ] **Step 5: Valider avec `tsc` (le client généré doit correspondre au schéma)**

Run: `npx tsc --noEmit`
Expected: aucune erreur liée aux nouveaux types Prisma.

- [ ] **Step 6: Tester la migration sur une copie de la structure de production**

Conformément à la mémoire `reference-migration-prod-clone-test` : toute migration avec remplissage se teste sur une copie des données de prod avant fusion. Cette migration n'a pas encore de remplissage (ajouté Tâche 9) — un premier passage à vide est fait ici pour vérifier que le SQL s'applique proprement sur un clone de la structure de prod.

```bash
ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes root@76.13.45.50 \
  "docker exec izipilot-db-1 pg_dump -U izipilot -d izipilot --schema-only" \
  > /tmp/izipilot-prod-schema.sql
docker run -d --rm --name izipilot-migration-test \
  -e POSTGRES_USER=izipilot -e POSTGRES_PASSWORD=izipilot -e POSTGRES_DB=izipilot \
  -p 5545:5432 postgres:16-alpine
sleep 3
PGPASSWORD=izipilot psql -h localhost -p 5545 -U izipilot -d izipilot -f /tmp/izipilot-prod-schema.sql
PGPASSWORD=izipilot psql -h localhost -p 5545 -U izipilot -d izipilot \
  -f "prisma/migrations/20260928120000_add_access_management/migration.sql"
docker stop izipilot-migration-test
```

Expected: la dernière commande `psql` de migration se termine sans erreur (`ALTER TABLE`, `CREATE TABLE`, `CREATE UNIQUE INDEX` affichés, pas de `ERROR`).

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations/20260928120000_add_access_management
git commit -m "feat(access): migration additive — tables et contraintes du registre d'accès"
```

---

## Task 3: Tests de contraintes en base (vraie connexion Postgres)

**Files:**
- Create: `tests/unit/access-db/access-constraints.test.ts`

**Interfaces:**
- Consumes: `prisma` depuis `@/lib/prisma`, les modèles de la Tâche 1.
- Produces: rien de consommé par d'autres tâches — ce fichier vérifie que la base rejette bien ce que les fonctions pures interdisent aussi (défense en profondeur).

Ce fichier a besoin d'une vraie base Postgres locale (mémoire `reference-local-run` : `docker compose up -d db`). Il est placé dans un sous-dossier séparé (`tests/unit/access-db/`) pour pouvoir l'exclure facilement d'un futur run CI sans base si besoin — mais `vitest.config.ts` ne l'exclut pas par défaut, il tourne avec `npm test` dès qu'une base est disponible.

- [ ] **Step 1: Démarrer la base et appliquer les migrations**

```bash
docker compose up -d db
npx prisma migrate deploy
```

Expected: `20260928120000_add_access_management` apparaît dans la sortie comme appliquée.

- [ ] **Step 2: Écrire le test qui échoue (organisation/utilisateur de test + doublon d'affectation)**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

describe("contraintes en base — gestion des accès", () => {
  let orgId: string;
  let userId: string;
  let assetId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Access Org", slug: `test-access-${Date.now()}` },
    });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-access-${Date.now()}@example.com`,
        name: "Test User",
        role: "PO",
      },
    });
    userId = user.id;
    const asset = await prisma.accessAsset.create({
      data: { orgId, name: "Asset Test" },
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("rejette une deuxième affectation courante pour le même employé et le même actif", async () => {
    await prisma.accessAssignment.create({
      data: { orgId, userId, assetId, status: "ACTIVE", source: "LEGACY_IMPORT" },
    });

    await expect(
      prisma.accessAssignment.create({
        data: { orgId, userId, assetId, status: "ACTIVE", source: "LEGACY_IMPORT" },
      })
    ).rejects.toThrow();
  });

  it("rejette un deuxième titulaire CISO dans la même organisation", async () => {
    const secondUser = await prisma.user.create({
      data: {
        orgId,
        email: `test-ciso-2-${Date.now()}@example.com`,
        name: "Second CISO",
        role: "PO",
      },
    });

    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "CISO", userId },
    });

    await expect(
      prisma.accessRoleAssignment.create({
        data: { orgId, role: "CISO", userId: secondUser.id },
      })
    ).rejects.toThrow();
  });

  it("rejette un suppléant identique au titulaire", async () => {
    await expect(
      prisma.accessRoleAssignment.create({
        data: { orgId, role: "HR", userId, backupUserId: userId },
      })
    ).rejects.toThrow();
  });

  it("rejette une priorité de niveau dupliquée parmi les niveaux activés d'un même actif", async () => {
    await prisma.accessLevel.create({
      data: { assetId, name: "Lecture", priority: 1, isAdmin: false },
    });

    await expect(
      prisma.accessLevel.create({
        data: { assetId, name: "Lecture avancée", priority: 1, isAdmin: false },
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Lancer les tests**

Run: `npx vitest run tests/unit/access-db/access-constraints.test.ts`
Expected: 4 tests PASS (la base rejette bien chaque doublon grâce aux contraintes de la Tâche 2). Si un test échoue, la contrainte SQL correspondante en Tâche 2 est incomplète — corriger là-bas, pas ici.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/access-db/access-constraints.test.ts
git commit -m "test(access): contraintes en base du registre d'accès"
```

---

## Task 4: Fonctions pures — résolution de rôle et de suppléant

**Files:**
- Create: `lib/access/types.ts`
- Create: `lib/access/roles.ts`
- Test: `tests/unit/access-roles.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // lib/access/types.ts
  export type AccessModuleRole =
    | "IT_ACCESS_OPERATOR" | "HR" | "CISO" | "COO"
    | "ASSET_ADMINISTRATOR" | "AUDIT_VIEWER" | "DEPARTMENT_HEAD";

  export interface RoleAssignmentLike {
    role: AccessModuleRole;
    userId: string | null;
    departmentId: string | null;
    backupUserId: string | null;
    primaryUnavailable: boolean;
  }

  export interface UserAvailability {
    userId: string;
    isActive: boolean;
    lifecycle: "ACTIVE" | "OFFBOARDING" | "DEPARTED" | null; // null = pas de profil (traité comme ACTIVE)
  }

  export interface ActingUser {
    userId: string;
    actsAsPrimary: boolean; // false = agit en tant que suppléant
  }
  ```
  ```typescript
  // lib/access/roles.ts
  export function isAvailable(user: UserAvailability): boolean;
  export function resolveActingUser(
    assignment: RoleAssignmentLike,
    availability: Map<string, UserAvailability>
  ): ActingUser | null;
  ```
- Consumes: rien (fonctions pures, aucune dépendance à Prisma).

- [ ] **Step 1: Créer les types partagés**

Créer `lib/access/types.ts` avec le contenu du bloc `types.ts` ci-dessus.

- [ ] **Step 2: Écrire les tests qui échouent**

```typescript
import { describe, it, expect } from "vitest";
import { isAvailable, resolveActingUser } from "@/lib/access/roles";
import type { RoleAssignmentLike, UserAvailability } from "@/lib/access/types";

function availability(overrides: Partial<UserAvailability> = {}): UserAvailability {
  return { userId: "u1", isActive: true, lifecycle: "ACTIVE", ...overrides };
}

describe("isAvailable", () => {
  it("est disponible si actif et ACTIVE", () => {
    expect(isAvailable(availability())).toBe(true);
  });

  it("est indisponible si désactivé, même sans lifecycle DEPARTED", () => {
    expect(isAvailable(availability({ isActive: false }))).toBe(false);
  });

  it("est indisponible si OFFBOARDING ou DEPARTED", () => {
    expect(isAvailable(availability({ lifecycle: "OFFBOARDING" }))).toBe(false);
    expect(isAvailable(availability({ lifecycle: "DEPARTED" }))).toBe(false);
  });

  it("est disponible si lifecycle est absent (pas encore de profil)", () => {
    expect(isAvailable(availability({ lifecycle: null }))).toBe(true);
  });
});

describe("resolveActingUser", () => {
  const availabilityMap = new Map<string, UserAvailability>([
    ["primary", availability({ userId: "primary" })],
    ["backup", availability({ userId: "backup" })],
  ]);

  it("le titulaire disponible agit en tant que titulaire", () => {
    const assignment: RoleAssignmentLike = {
      role: "HR", userId: "primary", departmentId: null,
      backupUserId: "backup", primaryUnavailable: false,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toEqual({
      userId: "primary", actsAsPrimary: true,
    });
  });

  it("le suppléant agit quand le titulaire est marqué indisponible", () => {
    const assignment: RoleAssignmentLike = {
      role: "HR", userId: "primary", departmentId: null,
      backupUserId: "backup", primaryUnavailable: true,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toEqual({
      userId: "backup", actsAsPrimary: false,
    });
  });

  it("le suppléant agit quand le titulaire est désactivé, sans bascule explicite", () => {
    const map = new Map(availabilityMap);
    map.set("primary", availability({ userId: "primary", isActive: false }));
    const assignment: RoleAssignmentLike = {
      role: "HR", userId: "primary", departmentId: null,
      backupUserId: "backup", primaryUnavailable: false,
    };
    expect(resolveActingUser(assignment, map)).toEqual({
      userId: "backup", actsAsPrimary: false,
    });
  });

  it("ne renvoie personne si le titulaire est indisponible et qu'il n'y a pas de suppléant", () => {
    const assignment: RoleAssignmentLike = {
      role: "HR", userId: "primary", departmentId: null,
      backupUserId: null, primaryUnavailable: true,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toBeNull();
  });

  it("ne renvoie personne si le suppléant lui-même est désactivé", () => {
    const map = new Map(availabilityMap);
    map.set("backup", availability({ userId: "backup", isActive: false }));
    const assignment: RoleAssignmentLike = {
      role: "HR", userId: "primary", departmentId: null,
      backupUserId: "backup", primaryUnavailable: true,
    };
    expect(resolveActingUser(assignment, map)).toBeNull();
  });

  it("le titulaire agit même si un suppléant est configuré, tant qu'il est disponible", () => {
    const assignment: RoleAssignmentLike = {
      role: "ASSET_ADMINISTRATOR", userId: "primary", departmentId: null,
      backupUserId: "backup", primaryUnavailable: false,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toEqual({
      userId: "primary", actsAsPrimary: true,
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/access-roles.test.ts`
Expected: FAIL — `Cannot find module '@/lib/access/roles'`.

- [ ] **Step 4: Implémenter**

```typescript
// lib/access/roles.ts
import type { RoleAssignmentLike, UserAvailability, ActingUser } from "./types";

export function isAvailable(user: UserAvailability): boolean {
  if (!user.isActive) return false;
  if (user.lifecycle === "OFFBOARDING" || user.lifecycle === "DEPARTED") return false;
  return true;
}

/**
 * Qui agit effectivement pour cette affectation de rôle : le titulaire s'il
 * est disponible et non marqué indisponible, sinon le suppléant actif.
 * Renvoie null si personne d'éligible — la spec interdit tout saut ou
 * approbateur inventé (§3.2).
 */
export function resolveActingUser(
  assignment: RoleAssignmentLike,
  availability: Map<string, UserAvailability>
): ActingUser | null {
  const primaryAvailability = assignment.userId
    ? availability.get(assignment.userId)
    : undefined;
  const primaryEligible =
    !!assignment.userId &&
    !!primaryAvailability &&
    isAvailable(primaryAvailability) &&
    !assignment.primaryUnavailable;

  if (primaryEligible) {
    return { userId: assignment.userId as string, actsAsPrimary: true };
  }

  if (assignment.backupUserId) {
    const backupAvailability = availability.get(assignment.backupUserId);
    if (backupAvailability && isAvailable(backupAvailability)) {
      return { userId: assignment.backupUserId, actsAsPrimary: false };
    }
  }

  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/access-roles.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/access/types.ts lib/access/roles.ts tests/unit/access-roles.test.ts
git commit -m "feat(access): résolution pure du titulaire/suppléant effectif d'un rôle"
```

---

## Task 5: Fonctions pures — portée de lecture

**Files:**
- Create: `lib/access/scope.ts`
- Test: `tests/unit/access-scope.test.ts`

**Interfaces:**
- Consumes: `AccessModuleRole` depuis `lib/access/types.ts` (Tâche 4).
- Produces:
  ```typescript
  // lib/access/scope.ts
  export type ReadScope =
    | { kind: "ALL" }
    | { kind: "SELF"; userId: string }
    | { kind: "DEPARTMENT"; departmentId: string }
    | { kind: "OWNED_ASSETS"; assetIds: string[] }
    | { kind: "AUDIT" }
    | { kind: "NONE" };

  export interface EffectiveRole {
    role: AccessModuleRole;
    actsAsPrimary: boolean;
    departmentId: string | null; // pour DEPARTMENT_HEAD
  }

  export function resolveReadScopes(
    userId: string,
    effectiveRoles: EffectiveRole[],
    ownedAssetIds: string[]
  ): ReadScope[];
  ```

Une personne peut cumuler plusieurs portées (ex. Employé + Asset Administrator) : la fonction renvoie un tableau, jamais une seule portée exclusive. `SELF` est toujours présent, tout le monde voit au moins ses propres accès.

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
import { describe, it, expect } from "vitest";
import { resolveReadScopes } from "@/lib/access/scope";
import type { EffectiveRole } from "@/lib/access/scope";

describe("resolveReadScopes", () => {
  it("un employé sans rôle du module ne voit que ses propres accès", () => {
    expect(resolveReadScopes("u1", [], [])).toEqual([{ kind: "SELF", userId: "u1" }]);
  });

  it("un chef de département voit son département en plus de lui-même", () => {
    const roles: EffectiveRole[] = [
      { role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "d1" },
    ];
    expect(resolveReadScopes("u1", roles, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
    ]);
  });

  it("CISO et COO voient tout", () => {
    const rolesCiso: EffectiveRole[] = [
      { role: "CISO", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", rolesCiso, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "ALL" },
    ]);

    const rolesCoo: EffectiveRole[] = [
      { role: "COO", actsAsPrimary: false, departmentId: null },
    ];
    expect(resolveReadScopes("u1", rolesCoo, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "ALL" },
    ]);
  });

  it("un propriétaire d'actif voit les affectations de ses actifs possédés", () => {
    const roles: EffectiveRole[] = [
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1", "asset-2"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1", "asset-2"] },
    ]);
  });

  it("un Audit Viewer effectif obtient la portée AUDIT en plus de SELF", () => {
    const roles: EffectiveRole[] = [
      { role: "AUDIT_VIEWER", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "AUDIT" },
    ]);
  });

  it("cumule plusieurs portées sans doublon", () => {
    const roles: EffectiveRole[] = [
      { role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "d1" },
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1"] },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/access-scope.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```typescript
// lib/access/scope.ts
import type { AccessModuleRole } from "./types";

export type ReadScope =
  | { kind: "ALL" }
  | { kind: "SELF"; userId: string }
  | { kind: "DEPARTMENT"; departmentId: string }
  | { kind: "OWNED_ASSETS"; assetIds: string[] }
  | { kind: "AUDIT" }
  | { kind: "NONE" };

export interface EffectiveRole {
  role: AccessModuleRole;
  actsAsPrimary: boolean;
  departmentId: string | null;
}

/**
 * Portées de lecture cumulées pour un utilisateur. SELF est toujours présent :
 * la spec garantit à chacun la visibilité de ses propres accès et demandes
 * (§3, invariant 8). L'ordre — SELF, puis DEPARTMENT, puis OWNED_ASSETS, puis
 * ALL/AUDIT — est stable pour des tests déterministes ; les appelants ne
 * doivent pas s'appuyer sur l'ordre pour le comportement métier.
 */
export function resolveReadScopes(
  userId: string,
  effectiveRoles: EffectiveRole[],
  ownedAssetIds: string[]
): ReadScope[] {
  const scopes: ReadScope[] = [{ kind: "SELF", userId }];

  for (const r of effectiveRoles) {
    if (r.role === "DEPARTMENT_HEAD" && r.departmentId) {
      scopes.push({ kind: "DEPARTMENT", departmentId: r.departmentId });
    }
    if (r.role === "ASSET_ADMINISTRATOR" && ownedAssetIds.length > 0) {
      scopes.push({ kind: "OWNED_ASSETS", assetIds: ownedAssetIds });
    }
    if (r.role === "CISO" || r.role === "COO") {
      scopes.push({ kind: "ALL" });
    }
    if (r.role === "AUDIT_VIEWER") {
      scopes.push({ kind: "AUDIT" });
    }
  }

  return scopes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/access-scope.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access/scope.ts tests/unit/access-scope.test.ts
git commit -m "feat(access): résolution pure des portées de lecture par rôle"
```

---

## Task 6: Fonctions pures — règles du catalogue

**Files:**
- Create: `lib/access/catalogue.ts`
- Test: `tests/unit/access-catalogue.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // lib/access/catalogue.ts
  export interface LevelForReadiness {
    enabled: boolean;
    archivedAt: Date | null;
    priority: number | null;
    isAdmin: boolean | null;
  }

  export interface AssetForReadiness {
    ownerId: string | null;
    archivedAt: Date | null;
  }

  export function isReadyForRequests(
    asset: AssetForReadiness,
    levels: LevelForReadiness[]
  ): boolean;

  export function catalogueChangeRequiresVersionBump(
    changedFields: Array<"priority" | "isAdmin">
  ): boolean;

  export function nextCatalogueVersion(current: number): number;
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
import { describe, it, expect } from "vitest";
import {
  isReadyForRequests,
  catalogueChangeRequiresVersionBump,
  nextCatalogueVersion,
} from "@/lib/access/catalogue";

describe("isReadyForRequests", () => {
  const readyLevel = { enabled: true, archivedAt: null, priority: 1, isAdmin: false };

  it("prêt : propriétaire renseigné et au moins un niveau sélectionnable complet", () => {
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [readyLevel])).toBe(true);
  });

  it("pas prêt sans propriétaire", () => {
    expect(isReadyForRequests({ ownerId: null, archivedAt: null }, [readyLevel])).toBe(false);
  });

  it("pas prêt si l'actif est archivé", () => {
    expect(
      isReadyForRequests({ ownerId: "u1", archivedAt: new Date() }, [readyLevel])
    ).toBe(false);
  });

  it("pas prêt sans aucun niveau sélectionnable", () => {
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [])).toBe(false);
  });

  it("pas prêt si un niveau sélectionnable a une priorité ou un isAdmin manquant (brouillon d'import)", () => {
    const draft = { enabled: true, archivedAt: null, priority: null, isAdmin: null };
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [draft])).toBe(false);
  });

  it("ignore les niveaux désactivés ou archivés dans le calcul", () => {
    const disabled = { enabled: false, archivedAt: null, priority: null, isAdmin: null };
    expect(isReadyForRequests({ ownerId: "u1", archivedAt: null }, [readyLevel, disabled])).toBe(
      true
    );
  });
});

describe("catalogueChangeRequiresVersionBump", () => {
  it("une priorité changée impose une montée de version", () => {
    expect(catalogueChangeRequiresVersionBump(["priority"])).toBe(true);
  });

  it("un isAdmin changé impose une montée de version", () => {
    expect(catalogueChangeRequiresVersionBump(["isAdmin"])).toBe(true);
  });

  it("aucun changement pertinent ne l'impose pas", () => {
    expect(catalogueChangeRequiresVersionBump([])).toBe(false);
  });
});

describe("nextCatalogueVersion", () => {
  it("incrémente simplement", () => {
    expect(nextCatalogueVersion(1)).toBe(2);
    expect(nextCatalogueVersion(7)).toBe(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/access-catalogue.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```typescript
// lib/access/catalogue.ts

export interface LevelForReadiness {
  enabled: boolean;
  archivedAt: Date | null;
  priority: number | null;
  isAdmin: boolean | null;
}

export interface AssetForReadiness {
  ownerId: string | null;
  archivedAt: Date | null;
}

/**
 * Un actif est ouvert aux demandes des employés seulement quand le
 * propriétaire et au moins un niveau sélectionnable complet existent
 * (spec §4 : "Enable employee requests only after ownership and selectable
 * level metadata are complete").
 */
export function isReadyForRequests(
  asset: AssetForReadiness,
  levels: LevelForReadiness[]
): boolean {
  if (!asset.ownerId || asset.archivedAt) return false;

  const selectable = levels.filter((l) => l.enabled && !l.archivedAt);
  if (selectable.length === 0) return false;

  return selectable.every((l) => l.priority !== null && l.isAdmin !== null);
}

/** Un changement de priorité ou de drapeau admin invalide les approbations en cours (spec §4). */
export function catalogueChangeRequiresVersionBump(
  changedFields: Array<"priority" | "isAdmin">
): boolean {
  return changedFields.length > 0;
}

export function nextCatalogueVersion(current: number): number {
  return current + 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/access-catalogue.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access/catalogue.ts tests/unit/access-catalogue.test.ts
git commit -m "feat(access): règles pures du catalogue (priorité, isAdmin, préparation aux demandes)"
```

---

## Task 7: Fonctions pures — construction d'un événement d'audit et échappement CSV

**Files:**
- Create: `lib/access/audit.ts`
- Test: `tests/unit/access-audit.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // lib/access/audit.ts
  export interface AuditEventInput {
    orgId: string;
    actorId: string;
    actorRole: string | null;
    primaryCoveredId: string | null;
    scopeType: string;
    scopeId: string | null;
    eventType: string;
    objectType: string;
    objectId: string;
    objectVersion: number | null;
    beneficiaryId: string | null;
    before: unknown;
    after: unknown;
    reason: string | null;
    outcome: string;
    correlationId: string | null;
  }

  export function buildAuditEvent(input: AuditEventInput): AuditEventInput;
  export function escapeCsvField(value: string): string;
  export function toCsvRow(fields: string[]): string;
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
import { describe, it, expect } from "vitest";
import { buildAuditEvent, escapeCsvField, toCsvRow } from "@/lib/access/audit";

describe("buildAuditEvent", () => {
  it("recopie fidèlement les champs fournis", () => {
    const input = {
      orgId: "org1",
      actorId: "u1",
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: "asset1",
      eventType: "ASSET_CREATED",
      objectType: "AccessAsset",
      objectId: "asset1",
      objectVersion: 1,
      beneficiaryId: null,
      before: null,
      after: { name: "CRM" },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    };
    expect(buildAuditEvent(input)).toEqual(input);
  });
});

describe("escapeCsvField", () => {
  it("neutralise une valeur commençant par =, +, -, @ (injection de formule)", () => {
    expect(escapeCsvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvField("+1234")).toBe("'+1234");
    expect(escapeCsvField("-1234")).toBe("'-1234");
    expect(escapeCsvField("@cmd")).toBe("'@cmd");
  });

  it("laisse intacte une valeur normale", () => {
    expect(escapeCsvField("Département IT")).toBe("Département IT");
  });

  it("échappe les guillemets et encadre si la valeur contient une virgule ou un guillemet", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it("gère une valeur vide", () => {
    expect(escapeCsvField("")).toBe("");
  });
});

describe("toCsvRow", () => {
  it("joint les champs échappés avec des virgules", () => {
    expect(toCsvRow(["a", "b,c", "=FORMULE"])).toBe('a,"b,c",\'=FORMULE');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/access-audit.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```typescript
// lib/access/audit.ts

export interface AuditEventInput {
  orgId: string;
  actorId: string;
  actorRole: string | null;
  primaryCoveredId: string | null;
  scopeType: string;
  scopeId: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  objectVersion: number | null;
  beneficiaryId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  outcome: string;
  correlationId: string | null;
}

/**
 * Construit l'événement d'audit à écrire. Fonction identité pour l'instant :
 * son rôle est de fixer la forme unique par laquelle toute mutation du
 * module passe, pour qu'aucun appelant n'improvise ses propres champs.
 */
export function buildAuditEvent(input: AuditEventInput): AuditEventInput {
  return { ...input };
}

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/**
 * Échappement CSV contre l'injection de formule (spec §13 : "Escape
 * formula-like text in CSV exports"). Un champ commençant par =, +, - ou @
 * est préfixé d'une apostrophe pour qu'Excel/Sheets le traite comme du texte.
 */
export function escapeCsvField(value: string): string {
  let field = value;
  if (FORMULA_PREFIXES.some((p) => field.startsWith(p))) {
    field = `'${field}`;
  }
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    field = `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/access-audit.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access/audit.ts tests/unit/access-audit.test.ts
git commit -m "feat(access): construction d'audit et échappement CSV contre l'injection de formule"
```

---

## Task 8: Accès Prisma — profils d'accès et département principal

**Files:**
- Create: `lib/access/profile-server.ts`

**Interfaces:**
- Consumes: `prisma` depuis `@/lib/prisma`.
- Produces:
  ```typescript
  // lib/access/profile-server.ts
  export async function ensureAccessProfile(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string
  ): Promise<void>;

  export async function resolvePrimaryDepartment(
    tx: Prisma.TransactionClient,
    userId: string
  ): Promise<string | null>; // null si 0 ou plusieurs départements

  export async function listConfigIssues(orgId: string): Promise<{
    usersWithoutPrimaryDepartment: { id: string; name: string; departmentCount: number }[];
  }>;
  ```

Ce fichier n'a pas de test unitaire dédié : c'est de la plomberie Prisma directe, testée à travers les routes API des Tâches 11-13.

**Note de correction (ruling pré-vol) :** une première version de ce plan incluait aussi `departmentsWithoutHead` (départements sans chef assigné dans le module). Ce champ a été retiré : `Department.ownerId` est un champ obligatoire du schéma existant — un département a toujours un chef, cette condition ne peut jamais être vraie. Seul `usersWithoutPrimaryDepartment` reste, seule condition de configuration réellement possible en phase 1.

- [ ] **Step 1: Implémenter**

```typescript
// lib/access/profile-server.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Crée le profil d'accès d'un utilisateur s'il n'existe pas déjà, avec le
 * département principal déduit automatiquement quand l'utilisateur
 * appartient à exactement un département (conception §5) — sinon laissé vide
 * pour que l'administrateur de plateforme le choisisse (spec §3).
 */
export async function ensureAccessProfile(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string
): Promise<void> {
  const existing = await tx.accessProfile.findUnique({ where: { userId } });
  if (existing) return;

  const primaryDepartmentId = await resolvePrimaryDepartment(tx, userId);

  await tx.accessProfile.create({
    data: { orgId, userId, primaryDepartmentId, lifecycle: "ACTIVE" },
  });
}

export async function resolvePrimaryDepartment(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<string | null> {
  const memberships = await tx.departmentMember.findMany({
    where: { userId },
    select: { departmentId: true },
  });
  return memberships.length === 1 ? memberships[0].departmentId : null;
}

export async function listConfigIssues(orgId: string) {
  const profiles = await prisma.accessProfile.findMany({
    where: { orgId, primaryDepartmentId: null },
    select: {
      userId: true,
      user: { select: { name: true } },
    },
  });

  const userIds = profiles.map((p) => p.userId);
  const membershipCounts = userIds.length
    ? await prisma.departmentMember.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _count: { userId: true },
      })
    : [];
  const countByUser = new Map(membershipCounts.map((m) => [m.userId, m._count.userId]));

  const usersWithoutPrimaryDepartment = profiles.map((p) => ({
    id: p.userId,
    name: p.user.name,
    departmentCount: countByUser.get(p.userId) ?? 0,
  }));

  return { usersWithoutPrimaryDepartment };
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur dans `lib/access/profile-server.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/access/profile-server.ts
git commit -m "feat(access): profils d'accès et détection des problèmes de configuration"
```

---

## Task 9: Créer le profil d'accès à la création d'un utilisateur

**Files:**
- Modify: `app/api/admin/users/route.ts:53-56` (fonction `POST`)
- Modify: `prisma/seed.ts` (après la création des utilisateurs, et après la création des membres de département)

**Interfaces:**
- Consumes: `ensureAccessProfile` (Tâche 8).

C'est le seul chemin de création d'utilisateur existant dans le code actuel (vérifié par grep sur `prisma.user.create`). L'onboarding RH de la phase 4 en ajoutera un second, qui appellera aussi `ensureAccessProfile`.

- [ ] **Step 1: Modifier la route d'administration**

Dans `app/api/admin/users/route.ts`, remplacer :

```typescript
  const user = await prisma.user.create({
    data: { orgId, email, name, role, passwordHash, mustChangePassword: true },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return Response.json({ data: user }, { status: 201 });
```

par :

```typescript
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { orgId, email, name, role, passwordHash, mustChangePassword: true },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    await ensureAccessProfile(tx, orgId, created.id);
    return created;
  });

  return Response.json({ data: user }, { status: 201 });
```

Ajouter en haut du fichier :

```typescript
import { ensureAccessProfile } from "@/lib/access/profile-server";
```

- [ ] **Step 2: Ajouter la création des profils dans le seed**

Dans `prisma/seed.ts`, juste après le bloc `const users = await Promise.all([...]);` (avant la création des départements), ajouter :

```typescript
  // ── Profils d'accès ──────────────────────────────────────────────
  // Un profil ACTIVE par utilisateur ; le département principal est résolu
  // une fois les membres de département créés plus bas (voir bloc dédié).
  for (const u of users) {
    await prisma.accessProfile.create({
      data: { orgId: org.id, userId: u.id, lifecycle: "ACTIVE" },
    });
  }
```

Puis, juste après le bloc de création des `departmentMember` (après la boucle `for (const ma of memberAssignments)`), ajouter :

```typescript
  // Renseigne le département principal des profils d'accès pour les
  // utilisateurs membres d'exactement un département.
  const membershipCounts = await prisma.departmentMember.groupBy({
    by: ["userId"],
    _count: { userId: true },
  });
  for (const m of membershipCounts) {
    if (m._count.userId !== 1) continue;
    const membership = await prisma.departmentMember.findFirst({
      where: { userId: m.userId },
      select: { departmentId: true },
    });
    if (!membership) continue;
    await prisma.accessProfile.update({
      where: { userId: m.userId },
      data: { primaryDepartmentId: membership.departmentId },
    });
  }
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Rejouer le seed en local pour vérifier qu'il ne plante pas**

```bash
docker compose up -d db
npx prisma migrate deploy
npm run db:seed
```

Expected : le message final de succès du seed s'affiche, sans erreur Prisma sur `accessProfile`.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/users/route.ts prisma/seed.ts
git commit -m "feat(access): créer le profil d'accès à chaque création d'utilisateur"
```

---

## Task 10: Accès Prisma et validations — rôles du module

**Files:**
- Create: `lib/access/roles-server.ts`
- Create: `lib/validations/access.ts`

**Interfaces:**
- Consumes: `resolveActingUser`, `isAvailable` (Tâche 4), `AccessModuleRole` (Tâche 4), `EffectiveRole` (Tâche 5).
- Produces:
  ```typescript
  // lib/access/roles-server.ts
  export interface RoleAssignmentDTO {
    id: string; role: AccessModuleRole; userId: string | null; userName: string | null;
    departmentId: string | null; departmentName: string | null;
    backupUserId: string | null; backupUserName: string | null;
    primaryUnavailable: boolean; revision: number;
  }
  export async function listRoleAssignments(orgId: string): Promise<RoleAssignmentDTO[]>;
  export async function getEffectiveRoleHolders(orgId: string, userId: string): Promise<EffectiveRole[]>;
  export async function upsertRoleAssignment(input: UpsertRoleAssignmentInput): Promise<RoleAssignmentDTO>;
  export async function setPrimaryUnavailable(
    assignmentId: string, orgId: string, unavailable: boolean
  ): Promise<RoleAssignmentDTO>;
  export async function deleteRoleAssignment(assignmentId: string, orgId: string): Promise<void>;
  export class RoleAssignmentError extends Error {}
  ```
  ```typescript
  // lib/validations/access.ts
  export const upsertRoleAssignmentSchema = z.object({ role, userId, backupUserId });
  export const setPrimaryUnavailableSchema = z.object({ primaryUnavailable: z.boolean() });
  export const setPrimaryDepartmentSchema = z.object({ primaryDepartmentId: z.string().min(1) });
  ```

- [ ] **Step 1: Écrire le schéma de validation**

Créer `lib/validations/access.ts` :

```typescript
import { z } from "zod";

// ── Rôles du module ──────────────────────────────────────────────────────
const ASSIGNABLE_ROLES = [
  "IT_ACCESS_OPERATOR", "HR", "CISO", "COO", "ASSET_ADMINISTRATOR", "AUDIT_VIEWER",
] as const;

export const upsertRoleAssignmentSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
  userId: z.string().min(1),
  backupUserId: z.string().nullable().optional(),
});

export const setPrimaryUnavailableSchema = z.object({
  primaryUnavailable: z.boolean(),
});

export const setPrimaryDepartmentSchema = z.object({
  primaryDepartmentId: z.string().min(1),
});

// ── Catalogue ─────────────────────────────────────────────────────────────
export const createAssetSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(1000).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  backupOwnerId: z.string().nullable().optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  ownerId: z.string().nullable().optional(),
  backupOwnerId: z.string().nullable().optional(),
  requestsEnabled: z.boolean().optional(),
});

export const createLevelSchema = z.object({
  name: z.string().min(1).max(100),
  priority: z.number().int().positive().nullable().optional(),
  isAdmin: z.boolean().nullable().optional(),
});

export const updateLevelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  priority: z.number().int().positive().nullable().optional(),
  isAdmin: z.boolean().nullable().optional(),
  enabled: z.boolean().optional(),
});
```

- [ ] **Step 2: Implémenter `lib/access/roles-server.ts`**

```typescript
// lib/access/roles-server.ts
import { prisma } from "@/lib/prisma";
import { isAvailable } from "./roles";
import type { EffectiveRole } from "./scope";
import type { AccessModuleRole } from "./types";

export interface RoleAssignmentDTO {
  id: string;
  role: AccessModuleRole;
  userId: string | null;
  userName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
  revision: number;
}

function toDTO(row: {
  id: string;
  role: AccessModuleRole;
  userId: string | null;
  departmentId: string | null;
  backupUserId: string | null;
  primaryUnavailable: boolean;
  revision: number;
  user: { name: string } | null;
  department: { name: string } | null;
  backupUser: { name: string } | null;
}): RoleAssignmentDTO {
  return {
    id: row.id,
    role: row.role,
    userId: row.userId,
    userName: row.user?.name ?? null,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    backupUserId: row.backupUserId,
    backupUserName: row.backupUser?.name ?? null,
    primaryUnavailable: row.primaryUnavailable,
    revision: row.revision,
  };
}

const INCLUDE = {
  user: { select: { name: true } },
  department: { select: { name: true } },
  backupUser: { select: { name: true } },
} as const;

export async function listRoleAssignments(orgId: string): Promise<RoleAssignmentDTO[]> {
  const rows = await prisma.accessRoleAssignment.findMany({
    where: { orgId },
    include: INCLUDE,
    orderBy: [{ role: "asc" }],
  });
  return rows.map(toDTO);
}

/**
 * Rôles effectifs d'un utilisateur : titulaire direct, ou suppléant actif
 * d'une affectation dont le titulaire est indisponible. Combine les rôles à
 * titulaire (userId) et les DEPARTMENT_HEAD (portés par Department.ownerId,
 * pas par AccessRoleAssignment.userId).
 *
 * ⚠️ Correction post-revue (Tâche 10, fix round 1) : le chef titulaire d'un
 * département suppléé doit être ajouté à `userIds` AVANT de construire les
 * cartes de disponibilité (`isActiveById`/`lifecycleById`). Une première
 * version récupérait `Department.ownerId` dans une requête séparée, APRÈS
 * avoir déjà figé ces cartes — `availability(owner)` retombait alors
 * systématiquement sur son défaut « indisponible » (owner absent des cartes),
 * ce qui pouvait accorder le rôle à un suppléant alors que le titulaire réel
 * était pleinement actif. La requête sur les départements suppléés doit donc
 * être faite en amont, comme ci-dessous.
 */
export async function getEffectiveRoleHolders(
  orgId: string,
  userId: string
): Promise<EffectiveRole[]> {
  const [roleAssignments, ownedDepartments] = await Promise.all([
    prisma.accessRoleAssignment.findMany({ where: { orgId } }),
    prisma.department.findMany({ where: { orgId, ownerId: userId }, select: { id: true } }),
  ]);

  // Départements pour lesquels cet utilisateur est suppléant d'un chef — il
  // faut connaître leur titulaire (Department.ownerId) AVANT de construire
  // les cartes de disponibilité ci-dessous (voir la note de correction).
  const departmentHeadAssignments = roleAssignments.filter(
    (a) => a.role === "DEPARTMENT_HEAD" && a.backupUserId === userId && a.departmentId
  );
  const backedDepartments = departmentHeadAssignments.length
    ? await prisma.department.findMany({
        where: { id: { in: departmentHeadAssignments.map((a) => a.departmentId as string) } },
        select: { id: true, ownerId: true },
      })
    : [];
  const ownerByDept = new Map(backedDepartments.map((d) => [d.id, d.ownerId]));

  const userIds = new Set<string>();
  for (const a of roleAssignments) {
    if (a.userId) userIds.add(a.userId);
    if (a.backupUserId) userIds.add(a.backupUserId);
  }
  for (const owner of ownerByDept.values()) userIds.add(owner);
  userIds.add(userId);

  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, isActive: true },
    }),
    prisma.accessProfile.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, lifecycle: true },
    }),
  ]);
  const isActiveById = new Map(users.map((u) => [u.id, u.isActive]));
  const lifecycleById = new Map(profiles.map((p) => [p.userId, p.lifecycle]));
  const availability = (id: string) =>
    isAvailable({
      userId: id,
      isActive: isActiveById.get(id) ?? false,
      lifecycle: lifecycleById.get(id) ?? null,
    });

  const effective: EffectiveRole[] = [];

  for (const a of roleAssignments) {
    if (a.role === "DEPARTMENT_HEAD") continue; // traité séparément ci-dessous
    if (a.userId === userId && availability(userId) && !a.primaryUnavailable) {
      effective.push({ role: a.role, actsAsPrimary: true, departmentId: null });
    } else if (
      a.backupUserId === userId &&
      availability(userId) &&
      (a.primaryUnavailable || !a.userId || !availability(a.userId))
    ) {
      effective.push({ role: a.role, actsAsPrimary: false, departmentId: null });
    }
  }

  // Chef de département direct (Department.ownerId).
  for (const dept of ownedDepartments) {
    if (availability(userId)) {
      effective.push({ role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: dept.id });
    }
  }

  // Suppléant d'un chef de département : agit seulement si le titulaire
  // (Department.ownerId) est explicitement marqué indisponible.
  for (const a of departmentHeadAssignments) {
    const owner = ownerByDept.get(a.departmentId as string);
    const ownerUnavailable = !owner || !availability(owner);
    if (availability(userId) && a.primaryUnavailable && ownerUnavailable) {
      effective.push({
        role: "DEPARTMENT_HEAD",
        actsAsPrimary: false,
        departmentId: a.departmentId as string,
      });
    }
  }

  return effective;
}

export interface UpsertRoleAssignmentInput {
  orgId: string;
  role: Exclude<AccessModuleRole, "DEPARTMENT_HEAD">;
  userId: string;
  backupUserId: string | null;
}

/**
 * Attribue ou remplace le titulaire d'un rôle non lié à un département.
 * S'appuie sur les contraintes en base (Tâche 2) pour l'unicité CISO/COO et
 * le suppléant distinct du titulaire ; ici on ne fait que traduire l'erreur
 * Postgres en message explicite.
 *
 * ⚠️ Correction post-revue (Tâche 12, fix round) : `input.userId` et
 * `input.backupUserId` viennent d'une route qui ne vérifie que l'org de
 * l'appelant, jamais celle des personnes ciblées — sans ce contrôle, un CEO
 * pourrait attribuer un rôle de ce module à un utilisateur d'une autre
 * organisation (IDOR cross-tenant), avec un `AccessRoleAssignment.orgId` qui
 * ne correspond à aucune appartenance réelle du titulaire/suppléant.
 */
export async function upsertRoleAssignment(
  input: UpsertRoleAssignmentInput
): Promise<RoleAssignmentDTO> {
  if (input.backupUserId === input.userId) {
    throw new RoleAssignmentError("Le suppléant ne peut pas être la même personne que le titulaire");
  }

  const idsToVerify = [input.userId, ...(input.backupUserId ? [input.backupUserId] : [])];
  const memberCount = await prisma.user.count({
    where: { id: { in: idsToVerify }, orgId: input.orgId },
  });
  if (memberCount !== idsToVerify.length) {
    throw new RoleAssignmentError(
      "Le titulaire ou le suppléant n'appartient pas à cette organisation"
    );
  }

  const existing = await prisma.accessRoleAssignment.findFirst({
    where: { orgId: input.orgId, role: input.role, userId: input.userId },
  });

  try {
    const row = existing
      ? await prisma.accessRoleAssignment.update({
          where: { id: existing.id },
          data: { backupUserId: input.backupUserId, revision: { increment: 1 } },
          include: INCLUDE,
        })
      : await prisma.accessRoleAssignment.create({
          data: {
            orgId: input.orgId,
            role: input.role,
            userId: input.userId,
            backupUserId: input.backupUserId,
          },
          include: INCLUDE,
        });
    return toDTO(row);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new RoleAssignmentError(
        `Il existe déjà un titulaire ${input.role} pour cette organisation`
      );
    }
    throw err;
  }
}

export async function setPrimaryUnavailable(
  assignmentId: string,
  orgId: string,
  unavailable: boolean
): Promise<RoleAssignmentDTO> {
  const row = await prisma.accessRoleAssignment.update({
    where: { id: assignmentId, orgId },
    data: { primaryUnavailable: unavailable, revision: { increment: 1 } },
    include: INCLUDE,
  });
  return toDTO(row);
}

export async function deleteRoleAssignment(assignmentId: string, orgId: string): Promise<void> {
  await prisma.accessRoleAssignment.delete({ where: { id: assignmentId, orgId } });
}

export class RoleAssignmentError extends Error {}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add lib/access/roles-server.ts lib/validations/access.ts
git commit -m "feat(access): accès Prisma et validations des rôles du module"
```

---

## Task 11: Accès Prisma — audit (écriture et lecture paginée)

**Files:**
- Create: `lib/access/audit-server.ts`

**Interfaces:**
- Consumes: `AuditEventInput`, `buildAuditEvent` (Tâche 7).
- Produces:
  ```typescript
  // lib/access/audit-server.ts
  export async function recordAudit(input: AuditEventInput): Promise<void>;
  export async function recordAuditInTx(
    tx: Prisma.TransactionClient,
    input: AuditEventInput
  ): Promise<void>;

  export interface AuditQueryFilters {
    actorId?: string;
    objectType?: string;
    beneficiaryId?: string;
    from?: Date;
    to?: Date;
  }
  export interface AccessAuditEventDTO {
    id: string; occurredAt: Date; actorId: string; actorName: string | null;
    eventType: string; objectType: string; objectId: string;
    beneficiaryId: string | null; beneficiaryName: string | null;
    reason: string | null; outcome: string;
  }
  export async function queryAuditEvents(
    orgId: string,
    filters: AuditQueryFilters,
    pagination: { page: number; pageSize: number }
  ): Promise<{ rows: AccessAuditEventDTO[]; total: number }>;
  ```

Deux fonctions d'écriture : `recordAudit` (connexion Prisma par défaut, pour les routes qui n'ont pas encore de transaction ouverte) et `recordAuditInTx` (même logique, à l'intérieur d'une transaction existante — utilisée par les phases suivantes qui enchaînent mutation + audit atomiquement, conception §4).

- [ ] **Step 1: Implémenter**

```typescript
// lib/access/audit-server.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildAuditEvent, type AuditEventInput } from "./audit";

export type { AuditEventInput };

export async function recordAudit(input: AuditEventInput): Promise<void> {
  await recordAuditInTx(prisma, input);
}

export async function recordAuditInTx(
  tx: Prisma.TransactionClient,
  input: AuditEventInput
): Promise<void> {
  const event = buildAuditEvent(input);
  await tx.accessAuditEvent.create({
    data: {
      orgId: event.orgId,
      actorId: event.actorId,
      actorRole: event.actorRole as never,
      primaryCoveredId: event.primaryCoveredId,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      objectVersion: event.objectVersion,
      beneficiaryId: event.beneficiaryId,
      before: event.before as Prisma.InputJsonValue,
      after: event.after as Prisma.InputJsonValue,
      reason: event.reason,
      outcome: event.outcome,
      correlationId: event.correlationId,
    },
  });
}

export interface AuditQueryFilters {
  actorId?: string;
  objectType?: string;
  beneficiaryId?: string;
  from?: Date;
  to?: Date;
}

export interface AccessAuditEventDTO {
  id: string;
  occurredAt: Date;
  actorId: string;
  actorName: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  reason: string | null;
  outcome: string;
}

export async function queryAuditEvents(
  orgId: string,
  filters: AuditQueryFilters,
  pagination: { page: number; pageSize: number }
): Promise<{ rows: AccessAuditEventDTO[]; total: number }> {
  const where: Prisma.AccessAuditEventWhereInput = {
    orgId,
    ...(filters.actorId && { actorId: filters.actorId }),
    ...(filters.objectType && { objectType: filters.objectType }),
    ...(filters.beneficiaryId && { beneficiaryId: filters.beneficiaryId }),
    ...((filters.from || filters.to) && {
      occurredAt: {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.accessAuditEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.accessAuditEvent.count({ where }),
  ]);

  const userIds = [
    ...new Set(rows.flatMap((r) => [r.actorId, r.beneficiaryId].filter((x): x is string => !!x))),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      actorId: r.actorId,
      actorName: nameById.get(r.actorId) ?? null,
      eventType: r.eventType,
      objectType: r.objectType,
      objectId: r.objectId,
      beneficiaryId: r.beneficiaryId,
      beneficiaryName: r.beneficiaryId ? nameById.get(r.beneficiaryId) ?? null : null,
      reason: r.reason,
      outcome: r.outcome,
    })),
  };
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add lib/access/audit-server.ts
git commit -m "feat(access): écriture et lecture paginée du journal d'audit"
```

---

## Task 12: Routes API — rôles et profils

**Files:**
- Create: `app/api/access/roles/route.ts`
- Create: `app/api/access/roles/[assignmentId]/route.ts`
- Create: `app/api/access/profiles/route.ts`
- Create: `app/api/access/profiles/[userId]/route.ts`

**Interfaces:**
- Consumes: `requireCEO` (`lib/auth-guard.ts`, existant), `listRoleAssignments`/`upsertRoleAssignment`/`setPrimaryUnavailable`/`deleteRoleAssignment`/`RoleAssignmentError` (Tâche 10), `upsertRoleAssignmentSchema`/`setPrimaryUnavailableSchema`/`setPrimaryDepartmentSchema` (Tâche 10), `listConfigIssues` (Tâche 8), `recordAudit` (Tâche 11).

- [ ] **Step 1: Route `roles/route.ts` (GET liste, POST créer)**

```typescript
// app/api/access/roles/route.ts
import { requireCEO } from "@/lib/auth-guard";
import { listRoleAssignments, upsertRoleAssignment, RoleAssignmentError } from "@/lib/access/roles-server";
import { upsertRoleAssignmentSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function GET() {
  const session = await requireCEO();
  const data = await listRoleAssignments(session.user.orgId);
  return Response.json({ data });
}

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = upsertRoleAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const assignment = await upsertRoleAssignment({ orgId, ...parsed.data });
    await recordAudit({
      orgId,
      actorId: session.user.id,
      actorRole: null,
      primaryCoveredId: null,
      scopeType: "ROLE_ASSIGNMENT",
      scopeId: assignment.id,
      eventType: "ROLE_ASSIGNED",
      objectType: "AccessRoleAssignment",
      objectId: assignment.id,
      objectVersion: assignment.revision,
      beneficiaryId: assignment.userId,
      before: null,
      after: assignment,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });
    return Response.json({ data: assignment }, { status: 201 });
  } catch (err) {
    if (err instanceof RoleAssignmentError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Route `roles/[assignmentId]/route.ts` (PATCH disponibilité, DELETE)**

```typescript
// app/api/access/roles/[assignmentId]/route.ts
import { requireCEO } from "@/lib/auth-guard";
import { setPrimaryUnavailable, deleteRoleAssignment } from "@/lib/access/roles-server";
import { setPrimaryUnavailableSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const session = await requireCEO();
  const { assignmentId } = await params;

  const body = await request.json();
  const parsed = setPrimaryUnavailableSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updated = await setPrimaryUnavailable(
    assignmentId,
    session.user.orgId,
    parsed.data.primaryUnavailable
  );

  await recordAudit({
    orgId: session.user.orgId,
    actorId: session.user.id,
    actorRole: null,
    primaryCoveredId: updated.userId,
    scopeType: "ROLE_ASSIGNMENT",
    scopeId: updated.id,
    eventType: parsed.data.primaryUnavailable
      ? "PRIMARY_MARKED_UNAVAILABLE"
      : "PRIMARY_MARKED_AVAILABLE",
    objectType: "AccessRoleAssignment",
    objectId: updated.id,
    objectVersion: updated.revision,
    beneficiaryId: updated.userId,
    before: null,
    after: updated,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const session = await requireCEO();
  const { assignmentId } = await params;

  await deleteRoleAssignment(assignmentId, session.user.orgId);

  await recordAudit({
    orgId: session.user.orgId,
    actorId: session.user.id,
    actorRole: null,
    primaryCoveredId: null,
    scopeType: "ROLE_ASSIGNMENT",
    scopeId: assignmentId,
    eventType: "ROLE_REMOVED",
    objectType: "AccessRoleAssignment",
    objectId: assignmentId,
    objectVersion: null,
    beneficiaryId: null,
    before: null,
    after: null,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 3: Route `profiles/route.ts` (GET problèmes de configuration)**

```typescript
// app/api/access/profiles/route.ts
import { requireCEO } from "@/lib/auth-guard";
import { listConfigIssues } from "@/lib/access/profile-server";

export async function GET() {
  const session = await requireCEO();
  const issues = await listConfigIssues(session.user.orgId);
  return Response.json({ data: issues });
}
```

- [ ] **Step 4: Route `profiles/[userId]/route.ts` (PATCH département principal)**

```typescript
// app/api/access/profiles/[userId]/route.ts
import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { setPrimaryDepartmentSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await requireCEO();
  const { userId } = await params;
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = setPrimaryDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const department = await prisma.department.findFirst({
    where: { id: parsed.data.primaryDepartmentId, orgId },
  });
  if (!department) {
    return Response.json({ error: "Département introuvable" }, { status: 400 });
  }

  // ⚠️ Correction post-revue (Tâche 12, fix round) : `userId` vient de l'URL et
  // n'appartient pas forcément à l'org de l'appelant. Chercher le profil par
  // (userId, orgId) — jamais par userId seul — sinon un CEO d'une org peut
  // modifier le profil d'accès d'un utilisateur d'une autre org (IDOR
  // cross-tenant), même si le département choisi, lui, reste bien vérifié.
  const before = await prisma.accessProfile.findFirst({ where: { userId, orgId } });
  if (!before) {
    return Response.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const updated = await prisma.accessProfile.update({
    where: { id: before.id },
    data: { primaryDepartmentId: parsed.data.primaryDepartmentId, revision: { increment: 1 } },
  });

  await recordAudit({
    orgId,
    actorId: session.user.id,
    actorRole: null,
    primaryCoveredId: null,
    scopeType: "ACCESS_PROFILE",
    scopeId: updated.id,
    eventType: "PRIMARY_DEPARTMENT_SET",
    objectType: "AccessProfile",
    objectId: updated.id,
    objectVersion: updated.revision,
    beneficiaryId: userId,
    before: before ? { primaryDepartmentId: before.primaryDepartmentId } : null,
    after: { primaryDepartmentId: updated.primaryDepartmentId },
    reason: "Correction manuelle par l'administrateur de plateforme",
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: updated });
}
```

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add app/api/access/roles app/api/access/profiles
git commit -m "feat(access): routes API des rôles et des profils d'accès"
```

---

## Task 13: Routes API — journal d'audit et export CSV

**Files:**
- Create: `app/api/access/audit/route.ts`
- Create: `app/api/access/audit/export/route.ts`
- Create: `lib/access/audit-guard.ts`

**Interfaces:**
- Consumes: `queryAuditEvents` (Tâche 11), `getEffectiveRoleHolders` (Tâche 10), `toCsvRow` (Tâche 7), `recordAudit` (Tâche 11).
- Produces:
  ```typescript
  // lib/access/audit-guard.ts
  export class AuditAccessDeniedError extends Error {}
  export async function requireAuditViewer(): Promise<{ userId: string; orgId: string }>;
  ```
  Lance `AuditAccessDeniedError` si l'utilisateur courant n'a pas de rôle `AUDIT_VIEWER` effectif — titulaire ou suppléant actif, jamais automatique pour CEO/CISO/COO (spec §13 : "No automatic access through CISO, COO, owner, or administrator roles").

- [ ] **Step 1: Écrire le garde d'accès dédié**

```typescript
// lib/access/audit-guard.ts
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "./roles-server";

export class AuditAccessDeniedError extends Error {}

export async function requireAuditViewer(): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user) throw new AuditAccessDeniedError("Non authentifié");

  const effectiveRoles = await getEffectiveRoleHolders(session.user.orgId, session.user.id);
  const hasAudit = effectiveRoles.some((r) => r.role === "AUDIT_VIEWER");
  if (!hasAudit) throw new AuditAccessDeniedError("Accès au journal d'audit non autorisé");

  return { userId: session.user.id, orgId: session.user.orgId };
}
```

- [ ] **Step 2: Route de lecture paginée**

```typescript
// app/api/access/audit/route.ts
import { requireAuditViewer, AuditAccessDeniedError } from "@/lib/access/audit-guard";
import { queryAuditEvents } from "@/lib/access/audit-server";

export async function GET(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAuditViewer();
  } catch (err) {
    if (err instanceof AuditAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));

  const filters = {
    actorId: url.searchParams.get("actorId") ?? undefined,
    objectType: url.searchParams.get("objectType") ?? undefined,
    beneficiaryId: url.searchParams.get("beneficiaryId") ?? undefined,
    from: url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined,
    to: url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined,
  };

  const result = await queryAuditEvents(ctx.orgId, filters, { page, pageSize });
  return Response.json({ data: result.rows, total: result.total, page, pageSize });
}
```

- [ ] **Step 3: Route d'export CSV (journalisée elle-même)**

```typescript
// app/api/access/audit/export/route.ts
import { requireAuditViewer, AuditAccessDeniedError } from "@/lib/access/audit-guard";
import { queryAuditEvents, recordAudit } from "@/lib/access/audit-server";
import { toCsvRow } from "@/lib/access/audit";

const CSV_HEADER = ["Date", "Acteur", "Type d'événement", "Objet", "Bénéficiaire", "Résultat", "Motif"];

export async function GET(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAuditViewer();
  } catch (err) {
    if (err instanceof AuditAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const filters = {
    actorId: url.searchParams.get("actorId") ?? undefined,
    objectType: url.searchParams.get("objectType") ?? undefined,
    beneficiaryId: url.searchParams.get("beneficiaryId") ?? undefined,
    from: url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined,
    to: url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined,
  };

  // Pas de limite de pageSize à l'export : on récupère tout ce qui correspond
  // au filtre, en une seule passe (le volume de la phase 1 reste modeste —
  // aucune donnée de registre n'existe encore avant la phase 2).
  const result = await queryAuditEvents(ctx.orgId, filters, { page: 1, pageSize: 100000 });

  const lines = [
    toCsvRow(CSV_HEADER),
    ...result.rows.map((r) =>
      toCsvRow([
        r.occurredAt.toISOString(),
        r.actorName ?? r.actorId,
        r.eventType,
        `${r.objectType}:${r.objectId}`,
        r.beneficiaryName ?? r.beneficiaryId ?? "",
        r.outcome,
        r.reason ?? "",
      ])
    ),
  ];

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "AUDIT_VIEWER",
    primaryCoveredId: null,
    scopeType: "AUDIT",
    scopeId: null,
    eventType: "AUDIT_EXPORTED",
    objectType: "AccessAuditEvent",
    objectId: "export",
    objectVersion: null,
    beneficiaryId: null,
    before: null,
    after: { rowCount: result.rows.length, filters },
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-acces-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
```

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add app/api/access/audit lib/access/audit-guard.ts
git commit -m "feat(access): routes API du journal d'audit et export CSV journalisé"
```

---

## Task 14: Accès Prisma — catalogue (actifs et niveaux)

**Files:**
- Create: `lib/access/catalogue-server.ts`

**Interfaces:**
- Consumes: `isReadyForRequests`, `catalogueChangeRequiresVersionBump` (Tâche 6), `createAssetSchema`/`updateAssetSchema`/`createLevelSchema`/`updateLevelSchema` (Tâche 10, section validations).
- Produces:
  ```typescript
  // lib/access/catalogue-server.ts
  export interface LevelDTO {
    id: string; assetId: string; name: string; priority: number | null;
    isAdmin: boolean | null; enabled: boolean; archivedAt: Date | null;
  }
  export interface AssetDTO {
    id: string; name: string; description: string | null;
    ownerId: string | null; ownerName: string | null;
    backupOwnerId: string | null; backupOwnerName: string | null;
    requestsEnabled: boolean; readyForRequests: boolean;
    catalogueVersion: number; archivedAt: Date | null; levels: LevelDTO[];
  }
  export async function listAssets(orgId: string): Promise<AssetDTO[]>;
  export async function createAsset(input: CreateAssetInput): Promise<AssetDTO>;
  export async function updateAsset(assetId: string, orgId: string, input: UpdateAssetInput): Promise<AssetDTO>;
  export async function archiveAsset(assetId: string, orgId: string): Promise<AssetDTO>;
  export async function createLevel(assetId: string, orgId: string, input: CreateLevelInput): Promise<LevelDTO>;
  export async function updateLevel(levelId: string, orgId: string, input: UpdateLevelInput): Promise<LevelDTO>;
  export async function archiveLevel(levelId: string, orgId: string): Promise<LevelDTO>;
  export class CatalogueError extends Error {}
  ```

- [ ] **Step 1: Implémenter**

```typescript
// lib/access/catalogue-server.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReadyForRequests, catalogueChangeRequiresVersionBump } from "./catalogue";

export interface LevelDTO {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: Date | null;
}

export interface AssetDTO {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  backupOwnerId: string | null;
  backupOwnerName: string | null;
  requestsEnabled: boolean;
  readyForRequests: boolean;
  catalogueVersion: number;
  archivedAt: Date | null;
  levels: LevelDTO[];
}

function levelToDTO(l: {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: Date | null;
}): LevelDTO {
  return { ...l };
}

function assetToDTO(a: {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  backupOwnerId: string | null;
  requestsEnabled: boolean;
  catalogueVersion: number;
  archivedAt: Date | null;
  owner: { name: string } | null;
  backupOwner: { name: string } | null;
  levels: LevelDTO[];
}): AssetDTO {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    ownerId: a.ownerId,
    ownerName: a.owner?.name ?? null,
    backupOwnerId: a.backupOwnerId,
    backupOwnerName: a.backupOwner?.name ?? null,
    requestsEnabled: a.requestsEnabled,
    readyForRequests: isReadyForRequests({ ownerId: a.ownerId, archivedAt: a.archivedAt }, a.levels),
    catalogueVersion: a.catalogueVersion,
    archivedAt: a.archivedAt,
    levels: a.levels,
  };
}

// ⚠️ Correction post-revue (Tâche 14) : `as const` sur l'objet entier rend le
// tableau `orderBy` en tuple readonly, que le type Prisma généré rejette
// (il attend un tableau mutable). `satisfies Prisma.AccessAssetInclude`
// donne le même typage littéral sans ce conflit.
const ASSET_INCLUDE = {
  owner: { select: { name: true } },
  backupOwner: { select: { name: true } },
  levels: { orderBy: [{ priority: "asc" as const }, { name: "asc" as const }] },
} satisfies Prisma.AccessAssetInclude;

export async function listAssets(orgId: string): Promise<AssetDTO[]> {
  const rows = await prisma.accessAsset.findMany({
    where: { orgId },
    include: ASSET_INCLUDE,
    orderBy: { name: "asc" },
  });
  return rows.map((r) => assetToDTO({ ...r, levels: r.levels.map(levelToDTO) }));
}

export interface CreateAssetInput {
  orgId: string;
  name: string;
  description?: string | null;
  ownerId?: string | null;
  backupOwnerId?: string | null;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetDTO> {
  const row = await prisma.accessAsset.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? null,
      ownerId: input.ownerId ?? null,
      backupOwnerId: input.backupOwnerId ?? null,
    },
    include: ASSET_INCLUDE,
  });
  return assetToDTO({ ...row, levels: [] });
}

export interface UpdateAssetInput {
  name?: string;
  description?: string | null;
  ownerId?: string | null;
  backupOwnerId?: string | null;
  requestsEnabled?: boolean;
}

export async function updateAsset(
  assetId: string,
  orgId: string,
  input: UpdateAssetInput
): Promise<AssetDTO> {
  const row = await prisma.accessAsset.update({
    where: { id: assetId, orgId },
    data: { ...input, revision: { increment: 1 } },
    include: ASSET_INCLUDE,
  });
  return assetToDTO({ ...row, levels: row.levels.map(levelToDTO) });
}

export async function archiveAsset(assetId: string, orgId: string): Promise<AssetDTO> {
  const row = await prisma.accessAsset.update({
    where: { id: assetId, orgId },
    data: { archivedAt: new Date(), revision: { increment: 1 } },
    include: ASSET_INCLUDE,
  });
  return assetToDTO({ ...row, levels: row.levels.map(levelToDTO) });
}

export interface CreateLevelInput {
  name: string;
  priority?: number | null;
  isAdmin?: boolean | null;
}

export async function createLevel(
  assetId: string,
  orgId: string,
  input: CreateLevelInput
): Promise<LevelDTO> {
  const asset = await prisma.accessAsset.findFirst({ where: { id: assetId, orgId } });
  if (!asset) throw new CatalogueError("Actif introuvable");

  const row = await prisma.accessLevel.create({
    data: {
      assetId,
      name: input.name,
      priority: input.priority ?? null,
      isAdmin: input.isAdmin ?? null,
    },
  });
  return levelToDTO(row);
}

export interface UpdateLevelInput {
  name?: string;
  priority?: number | null;
  isAdmin?: boolean | null;
  enabled?: boolean;
}

/**
 * Un changement de priorité ou de isAdmin monte la version du catalogue de
 * l'actif parent (spec §4) — fait dans la même transaction que la mise à
 * jour du niveau pour ne jamais désynchroniser les deux.
 */
export async function updateLevel(
  levelId: string,
  orgId: string,
  input: UpdateLevelInput
): Promise<LevelDTO> {
  const existing = await prisma.accessLevel.findFirst({
    where: { id: levelId, asset: { orgId } },
  });
  if (!existing) throw new CatalogueError("Niveau introuvable");

  const changedFields: Array<"priority" | "isAdmin"> = [];
  if (input.priority !== undefined && input.priority !== existing.priority) changedFields.push("priority");
  if (input.isAdmin !== undefined && input.isAdmin !== existing.isAdmin) changedFields.push("isAdmin");
  const bump = catalogueChangeRequiresVersionBump(changedFields);

  const [level] = await prisma.$transaction([
    prisma.accessLevel.update({
      where: { id: levelId },
      data: { ...input, revision: { increment: 1 } },
    }),
    ...(bump
      ? [
          prisma.accessAsset.update({
            where: { id: existing.assetId },
            data: { catalogueVersion: { increment: 1 } },
          }),
        ]
      : []),
  ]);
  return levelToDTO(level);
}

export async function archiveLevel(levelId: string, orgId: string): Promise<LevelDTO> {
  const existing = await prisma.accessLevel.findFirst({
    where: { id: levelId, asset: { orgId } },
  });
  if (!existing) throw new CatalogueError("Niveau introuvable");

  const row = await prisma.accessLevel.update({
    where: { id: levelId },
    data: { archivedAt: new Date(), enabled: false, revision: { increment: 1 } },
  });
  return levelToDTO(row);
}

export class CatalogueError extends Error {}
```

`nextCatalogueVersion` (Tâche 6) n'est pas appelé directement ici : `updateLevel` utilise `{ increment: 1 }` de Prisma, qui a le même effet sans lecture préalable. Il reste utile pour l'import de la phase 2.

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add lib/access/catalogue-server.ts
git commit -m "feat(access): accès Prisma du catalogue (actifs et niveaux)"
```

---

## Task 15: Routes API — catalogue

**Files:**
- Create: `app/api/access/assets/route.ts`
- Create: `app/api/access/assets/[assetId]/route.ts`
- Create: `app/api/access/assets/[assetId]/levels/route.ts`
- Create: `app/api/access/assets/[assetId]/levels/[levelId]/route.ts`
- Create: `lib/access/asset-admin-guard.ts`

**Interfaces:**
- Consumes: `listAssets`/`createAsset`/`updateAsset`/`archiveAsset`/`createLevel`/`updateLevel`/`archiveLevel`/`CatalogueError` (Tâche 14), `createAssetSchema`/`updateAssetSchema`/`createLevelSchema`/`updateLevelSchema` (Tâche 10, validations), `recordAudit` (Tâche 11), `getEffectiveRoleHolders` (Tâche 10).
- Produces:
  ```typescript
  // lib/access/asset-admin-guard.ts
  export class AssetAdminAccessDeniedError extends Error {}
  export async function requireAssetAdministrator(): Promise<{ userId: string; orgId: string }>;
  ```

- [ ] **Step 1: Garde d'accès Asset Administrator**

```typescript
// lib/access/asset-admin-guard.ts
import { auth } from "@/lib/auth";
import { getEffectiveRoleHolders } from "./roles-server";

export class AssetAdminAccessDeniedError extends Error {}

export async function requireAssetAdministrator(): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session?.user) throw new AssetAdminAccessDeniedError("Non authentifié");

  const effectiveRoles = await getEffectiveRoleHolders(session.user.orgId, session.user.id);
  const hasRole = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!hasRole) throw new AssetAdminAccessDeniedError("Administration des actifs non autorisée");

  return { userId: session.user.id, orgId: session.user.orgId };
}
```

- [ ] **Step 2: Route `assets/route.ts`**

```typescript
// app/api/access/assets/route.ts
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { listAssets, createAsset } from "@/lib/access/catalogue-server";
import { createAssetSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function GET() {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const data = await listAssets(ctx.orgId);
  return Response.json({ data });
}

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

  const body = await request.json();
  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // ⚠️ Correction post-revue (Tâche 14 → Tâche 15) : createAsset (Tâche 14)
  // laisse volontairement remonter le P2002 brut de Prisma sur le doublon
  // (orgId, name) — la Tâche 14 a documenté que ce mappage revient à la
  // couche route. Sans ce try/catch, un nom d'actif dupliqué finirait en 500
  // au lieu d'un 409 propre, contrairement à la convention déjà en place
  // ailleurs dans l'admin (ex. app/api/admin/departments/route.ts).
  let asset;
  try {
    asset = await createAsset({ orgId: ctx.orgId, ...parsed.data });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return Response.json({ error: "Un actif avec ce nom existe déjà" }, { status: 409 });
    }
    throw err;
  }

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "ASSET_ADMINISTRATOR",
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: asset.id,
    eventType: "ASSET_CREATED",
    objectType: "AccessAsset",
    objectId: asset.id,
    objectVersion: asset.catalogueVersion,
    beneficiaryId: null,
    before: null,
    after: asset,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: asset }, { status: 201 });
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

- [ ] **Step 3: Route `assets/[assetId]/route.ts`**

```typescript
// app/api/access/assets/[assetId]/route.ts
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { updateAsset, archiveAsset } from "@/lib/access/catalogue-server";
import { updateAssetSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
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
  const { assetId } = await params;

  const body = await request.json();
  const parsed = updateAssetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const asset = await updateAsset(assetId, ctx.orgId, parsed.data);

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "ASSET_ADMINISTRATOR",
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: asset.id,
    eventType: "ASSET_UPDATED",
    objectType: "AccessAsset",
    objectId: asset.id,
    objectVersion: asset.catalogueVersion,
    beneficiaryId: null,
    before: null,
    after: asset,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: asset });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> }
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
  const { assetId } = await params;

  // "Suppression" = archivage (spec §4 : un actif n'est jamais supprimé).
  const asset = await archiveAsset(assetId, ctx.orgId);

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "ASSET_ADMINISTRATOR",
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: asset.id,
    eventType: "ASSET_ARCHIVED",
    objectType: "AccessAsset",
    objectId: asset.id,
    objectVersion: asset.catalogueVersion,
    beneficiaryId: null,
    before: null,
    after: asset,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: asset });
}
```

- [ ] **Step 4: Route `assets/[assetId]/levels/route.ts`**

```typescript
// app/api/access/assets/[assetId]/levels/route.ts
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { createLevel, CatalogueError } from "@/lib/access/catalogue-server";
import { createLevelSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
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
  const { assetId } = await params;

  const body = await request.json();
  const parsed = createLevelSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const level = await createLevel(assetId, ctx.orgId, parsed.data);

    await recordAudit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: assetId,
      eventType: "LEVEL_CREATED",
      objectType: "AccessLevel",
      objectId: level.id,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: level,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return Response.json({ data: level }, { status: 201 });
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (isUniqueConstraintError(err)) {
      return Response.json(
        { error: "Cette priorité est déjà utilisée par un autre niveau actif de cet actif" },
        { status: 409 }
      );
    }
    throw err;
  }
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

- [ ] **Step 5: Route `assets/[assetId]/levels/[levelId]/route.ts`**

```typescript
// app/api/access/assets/[assetId]/levels/[levelId]/route.ts
import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { updateLevel, archiveLevel, CatalogueError } from "@/lib/access/catalogue-server";
import { updateLevelSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assetId: string; levelId: string }> }
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
  const { levelId } = await params;

  const body = await request.json();
  const parsed = updateLevelSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const level = await updateLevel(levelId, ctx.orgId, parsed.data);

    await recordAudit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: level.assetId,
      eventType: "LEVEL_UPDATED",
      objectType: "AccessLevel",
      objectId: level.id,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: level,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return Response.json({ data: level });
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assetId: string; levelId: string }> }
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
  const { levelId } = await params;

  try {
    const level = await archiveLevel(levelId, ctx.orgId);

    await recordAudit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: level.assetId,
      eventType: "LEVEL_ARCHIVED",
      objectType: "AccessLevel",
      objectId: level.id,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: level,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return Response.json({ data: level });
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 6: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add app/api/access/assets lib/access/asset-admin-guard.ts
git commit -m "feat(access): routes API du catalogue (actifs et niveaux)"
```

---

## Task 16: Écran Administration des rôles

**Files:**
- Create: `app/(dashboard)/access/roles/page.tsx`
- Create: `components/access/RoleAssignmentsTable.tsx`
- Create: `components/access/RoleAssignmentFormModal.tsx`
- Create: `components/access/ConfigIssuesPanel.tsx`

**Interfaces:**
- Consumes: `listRoleAssignments` (Tâche 10, appelé directement dans la page serveur — pas via l'API HTTP, comme le fait `app/(dashboard)/admin/departments/page.tsx`), `listConfigIssues` (Tâche 8), `requireCEO` (existant), `FormModal` (existant, `components/admin/FormModal.tsx`), `AdminPageHeader` (existant).

- [ ] **Step 1: Page serveur**

```typescript
// app/(dashboard)/access/roles/page.tsx
import { redirect } from "next/navigation";
import { requireCEO } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listRoleAssignments } from "@/lib/access/roles-server";
import { listConfigIssues } from "@/lib/access/profile-server";
import { RoleAssignmentsTable } from "@/components/access/RoleAssignmentsTable";
import { ConfigIssuesPanel } from "@/components/access/ConfigIssuesPanel";

export default async function AccessRolesPage() {
  let session;
  try {
    session = await requireCEO();
  } catch {
    redirect("/dashboard");
  }
  const orgId = session.user.orgId;

  const [assignments, issues, users, departments] = await Promise.all([
    listRoleAssignments(orgId),
    listConfigIssues(orgId),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Administration des rôles"
        subtitle="Rôles du module de gestion des accès, suppléants et disponibilité"
      />
      <ConfigIssuesPanel issues={issues} departments={departments} />
      <RoleAssignmentsTable assignments={assignments} users={users} />
    </div>
  );
}
```

- [ ] **Step 2: Panneau des problèmes de configuration, avec correction en un clic**

`usersWithoutPrimaryDepartment` est la seule condition de configuration réelle en phase 1 (voir la note de correction de la Tâche 8). L'API pour la corriger existe déjà (`PATCH /api/access/profiles/[userId]`, Tâche 12) — ce panneau doit l'appeler directement, pas seulement lister le problème.

```typescript
// components/access/ConfigIssuesPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ConfigIssuesPanelProps {
  issues: {
    usersWithoutPrimaryDepartment: { id: string; name: string; departmentCount: number }[];
  };
  departments: { id: string; name: string }[];
}

export function ConfigIssuesPanel({ issues, departments }: ConfigIssuesPanelProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const total = issues.usersWithoutPrimaryDepartment.length;
  if (total === 0) return null;

  async function fixPrimaryDepartment(userId: string) {
    const primaryDepartmentId = selected[userId];
    if (!primaryDepartmentId) return;
    setError(null);
    setSavingId(userId);
    try {
      const res = await fetch(`/api/access/profiles/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryDepartmentId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la mise à jour");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mb-4 rounded-[10px] border border-[#f4a900]/30 bg-[#fffbe6] px-4 py-3">
      <p className="text-[12px] font-semibold text-dark mb-2">
        {total} employé{total > 1 ? "s" : ""} sans département principal
      </p>
      <ul className="space-y-2">
        {issues.usersWithoutPrimaryDepartment.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 text-[11px] text-izi-gray">
            <span>
              {u.name}
              {u.departmentCount > 1
                ? ` (membre de ${u.departmentCount} départements)`
                : " (membre d'aucun département)"}
            </span>
            <select
              value={selected[u.id] ?? ""}
              onChange={(e) => setSelected((s) => ({ ...s, [u.id]: e.target.value }))}
              className="rounded-[6px] border border-teal-md px-2 py-1 text-[11px] text-dark bg-white"
            >
              <option value="">Choisir un département...</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => fixPrimaryDepartment(u.id)}
              disabled={!selected[u.id] || savingId === u.id}
              className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {savingId === u.id ? "..." : "Définir"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[11px] text-izi-red">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Tableau des rôles avec bascule de disponibilité**

```typescript
// components/access/RoleAssignmentsTable.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RoleAssignmentFormModal } from "./RoleAssignmentFormModal";

interface RoleAssignmentDTO {
  id: string;
  role: string;
  userId: string | null;
  userName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
  revision: number;
}

const ROLE_LABELS: Record<string, string> = {
  IT_ACCESS_OPERATOR: "Opérateur accès IT",
  HR: "RH",
  CISO: "CISO",
  COO: "COO",
  ASSET_ADMINISTRATOR: "Administrateur d'actifs",
  AUDIT_VIEWER: "Auditeur",
  DEPARTMENT_HEAD: "Chef de département",
};

interface RoleAssignmentsTableProps {
  assignments: RoleAssignmentDTO[];
  users: { id: string; name: string }[];
}

export function RoleAssignmentsTable({ assignments, users }: RoleAssignmentsTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleAssignments = assignments.filter((a) => a.role !== "DEPARTMENT_HEAD");

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
    startTransition(() => router.refresh());
  }

  async function removeAssignment(assignmentId: string) {
    setError(null);
    const res = await fetch(`/api/access/roles/${assignmentId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Erreur lors du retrait");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-[10px] border border-border-soft bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
        <h2 className="text-[13px] font-semibold text-dark">Rôles attribués</h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors"
        >
          Attribuer un rôle
        </button>
      </div>

      {error && <p className="px-4 py-2 text-[11px] text-izi-red bg-izi-red-lt">{error}</p>}

      {visibleAssignments.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-izi-gray">
          Aucun rôle attribué pour l&apos;instant.
        </div>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border-soft text-izi-gray text-left">
              <th className="px-4 py-2 font-medium">Rôle</th>
              <th className="px-4 py-2 font-medium">Titulaire</th>
              <th className="px-4 py-2 font-medium">Suppléant</th>
              <th className="px-4 py-2 font-medium">Disponibilité</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibleAssignments.map((a) => (
              <tr key={a.id} className="border-b border-border-soft last:border-0">
                <td className="px-4 py-2 font-medium text-dark">{ROLE_LABELS[a.role]}</td>
                <td className="px-4 py-2 text-dark">{a.userName}</td>
                <td className="px-4 py-2 text-izi-gray">{a.backupUserName ?? "—"}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleUnavailable(a.id, a.primaryUnavailable)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      a.primaryUnavailable
                        ? "bg-izi-red-lt text-izi-red"
                        : "bg-izi-green-lt text-izi-green"
                    }`}
                  >
                    {a.primaryUnavailable ? "Indisponible" : "Disponible"}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeAssignment(a.id)}
                    className="text-[11px] text-izi-gray hover:text-izi-red"
                  >
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RoleAssignmentFormModal open={modalOpen} onClose={() => setModalOpen(false)} users={users} />
    </div>
  );
}
```

- [ ] **Step 4: Formulaire d'attribution**

```typescript
// components/access/RoleAssignmentFormModal.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "@/components/admin/FormModal";

const ASSIGNABLE_ROLES = [
  { value: "IT_ACCESS_OPERATOR", label: "Opérateur accès IT" },
  { value: "HR", label: "RH" },
  { value: "CISO", label: "CISO" },
  { value: "COO", label: "COO" },
  { value: "ASSET_ADMINISTRATOR", label: "Administrateur d'actifs" },
  { value: "AUDIT_VIEWER", label: "Auditeur" },
] as const;

interface RoleAssignmentFormModalProps {
  open: boolean;
  onClose: () => void;
  users: { id: string; name: string }[];
}

export function RoleAssignmentFormModal({ open, onClose, users }: RoleAssignmentFormModalProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const form = new FormData(e.currentTarget);
    const backupUserId = (form.get("backupUserId") as string) || null;

    try {
      const res = await fetch("/api/access/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: form.get("role"),
          userId: form.get("userId"),
          backupUserId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de l'attribution");
      }
      onClose();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal title="Attribuer un rôle" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Rôle
          </label>
          <select
            name="role"
            required
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Sélectionner...</option>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Titulaire
          </label>
          <select
            name="userId"
            required
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Sélectionner...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Suppléant (optionnel)
          </label>
          <select
            name="backupUserId"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Aucun</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {saving ? "..." : "Attribuer"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
```

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Vérification manuelle dans le navigateur**

Suivre la mémoire `reference-local-run` (port 3005, build de production, OTP dans les logs). Se connecter en `direction@izichange.com`, aller sur `/access/roles`, attribuer un rôle CISO à un utilisateur, vérifier qu'une deuxième tentative de CISO échoue avec le message d'erreur attendu, basculer la disponibilité, retirer un rôle.

```bash
docker compose up -d db
npx prisma migrate deploy
npm run build
NEXTAUTH_URL=http://localhost:3005 npx next start -p 3005
```

Expected : l'écran affiche le tableau, l'attribution fonctionne, la deuxième tentative de CISO affiche l'erreur 409 remontée par le formulaire, aucune erreur dans la console navigateur.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/access/roles" components/access/RoleAssignmentsTable.tsx components/access/RoleAssignmentFormModal.tsx components/access/ConfigIssuesPanel.tsx
git commit -m "feat(access): écran d'administration des rôles"
```

---

## Task 17: Écran Administration des actifs

**Files:**
- Create: `app/(dashboard)/access/assets/page.tsx`
- Create: `components/access/AssetsTable.tsx`
- Create: `components/access/AssetFormModal.tsx`
- Create: `components/access/AssetLevelsPanel.tsx`

**Interfaces:**
- Consumes: `listAssets` (Tâche 14), `getEffectiveRoleHolders` (Tâche 10), `AdminPageHeader`/`FormModal` (existants).

- [ ] **Step 1: Page serveur**

```typescript
// app/(dashboard)/access/assets/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listAssets } from "@/lib/access/catalogue-server";
import { AssetsTable } from "@/components/access/AssetsTable";

export default async function AccessAssetsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAssetAdmin = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!isAssetAdmin) redirect("/dashboard");

  const [assets, users] = await Promise.all([
    listAssets(orgId),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Administration des actifs"
        subtitle={`${assets.length} application${assets.length > 1 ? "s" : ""} au catalogue`}
      />
      <AssetsTable assets={assets} users={users} />
    </div>
  );
}
```

- [ ] **Step 2: Tableau des actifs**

```typescript
// components/access/AssetsTable.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AssetFormModal } from "./AssetFormModal";
import { AssetLevelsPanel } from "./AssetLevelsPanel";

interface LevelDTO {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: string | null;
}

interface AssetDTO {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  backupOwnerId: string | null;
  backupOwnerName: string | null;
  requestsEnabled: boolean;
  readyForRequests: boolean;
  catalogueVersion: number;
  archivedAt: string | null;
  levels: LevelDTO[];
}

interface AssetsTableProps {
  assets: AssetDTO[];
  users: { id: string; name: string }[];
}

export function AssetsTable({ assets, users }: AssetsTableProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors"
        >
          Nouvel actif
        </button>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
          Aucune application au catalogue pour l&apos;instant.
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-[10px] border border-border-soft bg-white">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <span className="text-[13px] font-medium text-dark">{asset.name}</span>
                  {asset.archivedAt && (
                    <span className="ml-2 rounded-full bg-izi-gray-lt px-1.5 py-0.5 text-[9px] font-semibold text-izi-gray">
                      Archivé
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-izi-gray">
                  <span>Propriétaire : {asset.ownerName ?? "—"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      asset.readyForRequests
                        ? "bg-izi-green-lt text-izi-green"
                        : "bg-izi-gray-lt text-izi-gray"
                    }`}
                  >
                    {asset.readyForRequests ? "Prêt aux demandes" : "Incomplet"}
                  </span>
                </div>
              </button>
              {expandedId === asset.id && (
                <div className="border-t border-border-soft px-4 py-3">
                  <AssetLevelsPanel asset={asset} onChanged={() => router.refresh()} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AssetFormModal open={modalOpen} onClose={() => setModalOpen(false)} users={users} />
    </div>
  );
}
```

- [ ] **Step 3: Formulaire de création d'actif**

```typescript
// components/access/AssetFormModal.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormModal } from "@/components/admin/FormModal";

interface AssetFormModalProps {
  open: boolean;
  onClose: () => void;
  users: { id: string; name: string }[];
}

export function AssetFormModal({ open, onClose, users }: AssetFormModalProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/access/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          description: (form.get("description") as string) || null,
          ownerId: (form.get("ownerId") as string) || null,
          backupOwnerId: (form.get("backupOwnerId") as string) || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la création");
      }
      onClose();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal title="Nouvel actif" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nom
          </label>
          <input
            name="name"
            required
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Description
          </label>
          <textarea
            name="description"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark font-sans resize-none h-[52px]"
          />
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Propriétaire
          </label>
          <select
            name="ownerId"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Aucun pour l&apos;instant</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Suppléant du propriétaire
          </label>
          <select
            name="backupOwnerId"
            className="izi-form-input w-full px-[9px] py-[7px] border border-teal-md rounded-[7px] text-dark bg-white font-sans"
          >
            <option value="">Aucun</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
          >
            {saving ? "..." : "Créer"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
```

- [ ] **Step 4: Panneau des niveaux d'un actif**

```typescript
// components/access/AssetLevelsPanel.tsx
"use client";

import { useState } from "react";

interface LevelDTO {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: string | null;
}

interface AssetLevelsPanelProps {
  asset: { id: string; levels: LevelDTO[] };
  onChanged: () => void;
}

export function AssetLevelsPanel({ asset, onChanged }: AssetLevelsPanelProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function addLevel() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/access/assets/${asset.id}/levels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          priority: priority ? Number(priority) : null,
          isAdmin,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Erreur lors de la création du niveau");
      }
      setName("");
      setPriority("");
      setIsAdmin(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdmin(level: LevelDTO) {
    await fetch(`/api/access/assets/${asset.id}/levels/${level.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAdmin: !level.isAdmin }),
    });
    onChanged();
  }

  async function archiveLevel(level: LevelDTO) {
    await fetch(`/api/access/assets/${asset.id}/levels/${level.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="space-y-3">
      {asset.levels.length === 0 ? (
        <p className="text-[11px] text-izi-gray">Aucun niveau défini.</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-izi-gray text-left">
              <th className="py-1 font-medium">Niveau</th>
              <th className="py-1 font-medium">Priorité</th>
              <th className="py-1 font-medium">Admin</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {asset.levels.map((l) => (
              <tr key={l.id} className={l.archivedAt ? "opacity-50" : ""}>
                <td className="py-1 text-dark">{l.name}</td>
                <td className="py-1 font-mono">{l.priority ?? "—"}</td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => toggleAdmin(l)}
                    disabled={!!l.archivedAt}
                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      l.isAdmin ? "bg-izi-red-lt text-izi-red" : "bg-izi-gray-lt text-izi-gray"
                    }`}
                  >
                    {l.isAdmin === null ? "Non défini" : l.isAdmin ? "Oui" : "Non"}
                  </button>
                </td>
                <td className="py-1 text-right">
                  {!l.archivedAt && (
                    <button
                      type="button"
                      onClick={() => archiveLevel(l)}
                      className="text-izi-gray hover:text-izi-red"
                    >
                      Archiver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-end gap-2 border-t border-border-soft pt-3">
        <div className="flex-1">
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Nouveau niveau
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="izi-form-input w-full px-[9px] py-[6px] border border-teal-md rounded-[7px] text-dark font-sans text-[12px]"
            placeholder="Ex : Lecture"
          />
        </div>
        <div className="w-20">
          <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-1 block">
            Priorité
          </label>
          <input
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="izi-form-input w-full px-[9px] py-[6px] border border-teal-md rounded-[7px] text-dark font-sans text-[12px]"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-[11px] text-dark cursor-pointer">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="accent-[color:var(--teal)]"
          />
          Admin
        </label>
        <button
          type="button"
          onClick={addLevel}
          disabled={saving || !name}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>

      {error && <p className="text-[11px] text-izi-red bg-izi-red-lt px-3 py-2 rounded-md">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Vérification manuelle dans le navigateur**

Sur le serveur local déjà lancé (Tâche 16), aller sur `/access/assets` : créer un actif sans propriétaire (doit rester « Incomplet »), lui assigner un propriétaire, ajouter deux niveaux avec la même priorité (doit échouer avec le message 409), corriger, vérifier que l'indicateur passe à « Prêt aux demandes » une fois `priority` et `isAdmin` renseignés sur tous les niveaux actifs.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/access/assets" components/access/AssetsTable.tsx components/access/AssetFormModal.tsx components/access/AssetLevelsPanel.tsx
git commit -m "feat(access): écran d'administration des actifs et de leurs niveaux"
```

---

## Task 18: Écran Journal d'audit

**Files:**
- Create: `app/(dashboard)/access/audit/page.tsx`
- Create: `components/access/AccessAuditTable.tsx`

**Interfaces:**
- Consumes: `queryAuditEvents` (Tâche 11), `getEffectiveRoleHolders` (Tâche 10).

- [ ] **Step 1: Page serveur**

```typescript
// app/(dashboard)/access/audit/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { queryAuditEvents } from "@/lib/access/audit-server";
import { AccessAuditTable } from "@/components/access/AccessAuditTable";

export default async function AccessAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAuditViewer = effectiveRoles.some((r) => r.role === "AUDIT_VIEWER");
  if (!isAuditViewer) redirect("/dashboard");

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 25;

  const { rows, total } = await queryAuditEvents(orgId, {}, { page, pageSize });

  return (
    <div>
      <AdminPageHeader
        title="Journal d'audit"
        subtitle={`${total} événement${total > 1 ? "s" : ""} enregistré${total > 1 ? "s" : ""}`}
      />
      <AccessAuditTable rows={rows} page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
```

- [ ] **Step 2: Tableau paginé avec export**

```typescript
// components/access/AccessAuditTable.tsx
"use client";

import Link from "next/link";

interface AuditRow {
  id: string;
  occurredAt: string;
  actorId: string;
  actorName: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  reason: string | null;
  outcome: string;
}

interface AccessAuditTableProps {
  rows: AuditRow[];
  page: number;
  pageSize: number;
  total: number;
}

export function AccessAuditTable({ rows, page, pageSize, total }: AccessAuditTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <a
          href="/api/access/audit/export"
          className="rounded-[7px] border border-border-soft bg-white px-3 py-1.5 text-[11px] font-medium text-dark hover:bg-izi-gray-lt transition-colors"
        >
          Exporter en CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
          Aucun événement enregistré pour l&apos;instant.
        </div>
      ) : (
        <div className="rounded-[10px] border border-border-soft bg-white overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border-soft text-izi-gray text-left">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Acteur</th>
                <th className="px-4 py-2 font-medium">Événement</th>
                <th className="px-4 py-2 font-medium">Objet</th>
                <th className="px-4 py-2 font-medium">Bénéficiaire</th>
                <th className="px-4 py-2 font-medium">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-soft last:border-0">
                  <td className="px-4 py-2 font-mono text-izi-gray">
                    {new Date(r.occurredAt).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo" })}
                  </td>
                  <td className="px-4 py-2 text-dark">{r.actorName ?? r.actorId}</td>
                  <td className="px-4 py-2 text-dark">{r.eventType}</td>
                  <td className="px-4 py-2 text-izi-gray">
                    {r.objectType}:{r.objectId}
                  </td>
                  <td className="px-4 py-2 text-izi-gray">{r.beneficiaryName ?? r.beneficiaryId ?? "—"}</td>
                  <td className="px-4 py-2 text-izi-gray">{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-[11px]">
          {page > 1 && (
            <Link href={`/access/audit?page=${page - 1}`} className="text-teal hover:text-teal-dk">
              Précédent
            </Link>
          )}
          <span className="text-izi-gray">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/access/audit?page=${page + 1}`} className="text-teal hover:text-teal-dk">
              Suivant
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle dans le navigateur**

Attribuer un rôle `AUDIT_VIEWER` à un compte de test depuis `/access/roles`, se reconnecter avec ce compte, aller sur `/access/audit`, vérifier que les actions faites dans les Tâches 16-17 apparaissent, cliquer sur « Exporter en CSV » et vérifier que le fichier téléchargé contient une ligne `AUDIT_EXPORTED` en plus (générée par l'export lui-même).

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/access/audit" components/access/AccessAuditTable.tsx
git commit -m "feat(access): écran du journal d'audit avec export CSV"
```

---

## Task 19: Entrée de menu « Accès »

**Files:**
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `components/layout/DashboardShell.tsx`
- Modify: `components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `getEffectiveRoleHolders` (Tâche 10).

Le composant `Sidebar` est un composant client qui ne peut pas appeler Prisma. Le calcul se fait dans `app/(dashboard)/layout.tsx` (déjà server component) et est passé en prop, comme `alertCount` ou `notificationCount`.

- [ ] **Step 1: Calculer la visibilité dans le layout du dashboard**

Dans `app/(dashboard)/layout.tsx`, ajouter l'import :

```typescript
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
```

Ajouter au `Promise.all` existant (celui qui calcule `products`, `departments`, `unresolvedAlertCount`, `myNotificationCount`) un cinquième élément :

```typescript
    getEffectiveRoleHolders(orgId, userId),
```

Et récupérer sa valeur dans la déstructuration :

```typescript
  const [products, departments, unresolvedAlertCount, myNotificationCount, accessRoles] = await Promise.all([
```

Puis calculer, juste avant le `return`:

```typescript
  const hasAnyAccessRole = accessRoles.length > 0 || session.user.role === "CEO";
```

Le `CEO` voit toujours le lien vers `/access/roles` (l'administration des rôles), même sans rôle du module attribué — c'est la seule route où son accès est garanti (spec §3 : le Platform Administrator gère les rôles).

Passer la prop à `DashboardShell` :

```typescript
    <DashboardShell
      ...
      showAccessMenu={hasAnyAccessRole}
    >
```

- [ ] **Step 2: Propager la prop à travers `DashboardShell`**

Dans `components/layout/DashboardShell.tsx`, ajouter `showAccessMenu: boolean;` à `DashboardShellProps`, l'ajouter à la déstructuration des props, et le passer à `<Sidebar>` :

```typescript
        <Sidebar
          products={products}
          departments={departments}
          alertCount={alertCount}
          notificationCount={notificationCount}
          userRole={userRole}
          showAccessMenu={showAccessMenu}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
```

- [ ] **Step 3: Ajouter l'entrée de menu dans `Sidebar`**

Dans `components/layout/Sidebar.tsx`, ajouter `showAccessMenu?: boolean;` à `SidebarProps`, l'ajouter à la déstructuration, puis ajouter un bloc de menu juste après le bloc « Suivi des membres » (avant la fermeture de la `div` de navigation, avant la section Admin) :

```typescript
          {/* Gestion des accès — visible seulement si un rôle du module est effectif */}
          {showAccessMenu && (
            <Link
              href="/access/roles"
              onClick={onClose}
              className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                pathname.startsWith("/access")
                  ? "bg-teal/[0.18] text-[#7dd8d8]"
                  : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Accès
            </Link>
          )}
```

Ce lien pointe vers `/access/roles` par défaut : chaque écran (Tâches 16-18) redirige lui-même vers `/dashboard` si l'utilisateur n'a pas le rôle correspondant, donc un lien unique suffit pour l'instant. Les écrans `/access/assets` et `/access/audit` restent accessibles par URL directe pour qui y a droit.

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle dans le navigateur**

Se connecter avec un compte PO sans rôle du module : le lien « Accès » ne doit pas apparaître. Se connecter en CEO : le lien apparaît toujours. Attribuer `ASSET_ADMINISTRATOR` à un PO, se reconnecter avec ce compte : le lien apparaît.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/layout.tsx" components/layout/DashboardShell.tsx components/layout/Sidebar.tsx
git commit -m "feat(access): entrée de menu Accès visible selon le rôle effectif"
```

---

## Task 20: Vérification finale de la phase 1

**Files:** aucun fichier nouveau — tâche de vérification globale.

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les tests passent, y compris `tests/unit/access-db/access-constraints.test.ts` (nécessite `docker compose up -d db` actif).

- [ ] **Step 2: Vérification des types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: aucune erreur (des avertissements préexistants dans d'autres fichiers sont acceptables, mais aucun nouveau dans `lib/access/`, `app/api/access/`, `app/(dashboard)/access/`, `components/access/`).

- [ ] **Step 4: Build de production**

Run: `npm run build`
Expected: build réussi, les routes `/access/roles`, `/access/assets`, `/access/audit` apparaissent dans la sortie du build (`ƒ /access/roles` etc.).

- [ ] **Step 5: Revue manuelle des 5 points du Review Focus**

Reprendre la liste de la section « Review Focus » en tête de ce document et confirmer pour chacun qu'un test existe et passe : deux titulaires CISO/COO (Tâche 3 + 10), suppléant = titulaire (Tâche 4 + 10), doublon d'affectation courante (Tâche 3), département principal ambigu (Tâche 8 + 16), titulaire désactivé/en départ (Tâche 4). Si un point manque un test réel (pas seulement mentionné), l'ajouter avant de considérer la phase 1 terminée.

- [ ] **Step 6: Commit final si des ajustements ont été faits**

```bash
git add -A
git commit -m "chore(access): vérification finale de la phase 1 (tests, types, lint, build)"
```

Si aucun ajustement n'était nécessaire, ne rien committer à cette étape.
