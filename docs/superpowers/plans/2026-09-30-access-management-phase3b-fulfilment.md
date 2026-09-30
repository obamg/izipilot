# Gestion des accès — Phase 3b : exécution des demandes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire le pont entre « demande approuvée » et « accès enregistré » : une tâche d'exécution est libérée pour le propriétaire/suppléant de l'actif, qui la réclame, fait le changement à la main dans l'application cible puis le confirme — la confirmation met à jour l'affectation courante de façon atomique et idempotente ; un processeur 5 minutes libère les débuts futurs et crée le travail de retrait des accès temporaires échus.

**Architecture:** Un module pur (`lib/access/fulfilment.ts`) porte la machine à états des tâches et le tableau d'effets sur l'affectation. Un service (`lib/access/fulfilment-server.ts`) fait chaque action dans UNE transaction Read Committed avec des `updateMany` conditionnels (état + révision) et un compare-and-swap sur `AccessAssignment.version` ; il est appelé par les trois sites 3a qui passent à `READY_FOR_FULFILMENT`, par le processeur (`lib/access/access-processor.ts`, route cron) et par les routes `/api/access/tasks/**`. La lecture (`lib/access/fulfilment-read-server.ts`) recalcule la portée en base et filtre avant pagination ; l'écran `/access/fulfilment` l'affiche.

**Tech Stack:** Next.js 16 App Router, Prisma 6 / PostgreSQL 16, Zod 4, Vitest 4, TypeScript strict, Tailwind v4. Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-09-30-access-management-phase3b-fulfilment-design.md` (décisions D-1 … D-23, toutes contraignantes). Faits sur le code existant : `.superpowers/sdd/phase3b-research/research.md`. Source métier v1 : `/Users/mariusokouin/Downloads/FEATURE-PROMPT.md` (« FP:ligne »).

## Global Constraints

- **Approuver n'est pas exécuter** (FP:43) : `AccessAssignment` n'est écrit que par `completeTask`, jamais par une approbation ni par le processeur (qui ne change que `status`).
- **Aucun appel externe, aucune notification, aucun e-mail** (A25).
- Le propriétaire est résolu **en direct** depuis `AccessAsset.ownerId/backupOwnerId` (D-5) : la tâche ne stocke pas de propriétaire. Acteur indisponible (`isAvailable`) ou hors périmètre → **404**, jamais 403.
- Erreurs typées `FulfilmentError` (D-8) : `NOT_FOUND` → 404, `STALE` et `INVALID_TRANSITION` → 409, `VALIDATION` → 400. Corps `{ error, code }`, messages en français, `"Non authentifié"` en 401 (D-22).
- Concurrence (D-20) : lectures ET écritures dans la même transaction ; `updateMany` conditionnel (état + `revision`) ; compare-and-swap sur `assignment.version`. **Ordre de verrouillage identique partout : version de demande → tâche → tâche d'expiration supplantée → affectation.**
- Toute insertion de tâche utilise `createMany({ skipDuplicates: true })` (une violation d'unicité avorterait la transaction Postgres de l'appelant). Clés : `REQ:<versionId>`, `EXP:<assignmentId>:<version>`.
- Une demande n'est **plus jamais supprimée** (D-4) : `closedAt` au rejet, à l'annulation, à l'exécution, à la réconciliation.
- Audit : toujours `recordAuditInTx` ; `objectType: "AccessFulfilmentTask"`, `scopeType: "ASSET"`, `scopeId: assetId`, `actorRole: null`, `after.actingAs` = `ASSET_OWNER` | `ASSET_OWNER_BACKUP`, `primaryCoveredId` = propriétaire principal quand le suppléant agit ; acteur du processeur = `"SYSTEM"` (D-18, D-11).
- `orgId` et l'acteur viennent **toujours** de la session. Filtrer par portée **avant** pagination et totaux (FP:98).
- Le propriétaire ne voit que des tâches (travail autorisé), jamais une version en attente/rejetée ni leur nombre (A05) ; aucun motif interne d'approbation ; le demandeur ne voit jamais les faits internes d'un blocage (D-6, D-14, D-16).
- Deux migrations distinctes (D-21) : `ALTER TYPE … ADD VALUE` seul, puis tables/colonnes/index. Appliquées par `npx prisma migrate deploy` — **ne pas lancer `prisma migrate dev`** (la base locale porte une table `mobile_refresh_tokens` d'une autre branche : `migrate dev` proposerait une réinitialisation).
- Base locale : conteneur `izipilot-db-1` (port 5432), `DATABASE_URL` dans `.env`. Les tests `tests/unit/access-db/*` l'utilisent ; les fichiers de test tournent en parallèle, chacun dans sa propre organisation.
- Dates en chaîne ISO avant la frontière Server → Client ; affichage `fr-FR`, fuseau `Africa/Porto-Novo`. Couleurs via tokens Tailwind (`teal`, `gold-lt`, `red-lt`, `izi-gray`, `border-soft`…), jamais d'hex ; jamais de texte gold sur `gold-lt`. Mobile d'abord, texte d'interface en français.
- Commits : message en français, terminé par une ligne vide puis `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Le propriétaire de l'actif est remplacé après qu'il a réclamé une tâche** — l'ancien détenteur ne doit plus pouvoir agir (404) et le nouveau propriétaire doit pouvoir reprendre la tâche par une passation vers lui-même, sans intervention d'un administrateur. Test : Tâche 6.
- **Le propriétaire est lui-même le bénéficiaire de la demande** — il doit pouvoir l'exécuter (D-7, sinon file bloquée pour un propriétaire unique), et l'audit doit le marquer `selfFulfilled`. Test : Tâche 8.
- **L'actif est archivé alors que des tâches sont ouvertes** — un retrait doit rester visible, réclamable et confirmable (FP:110) ; un octroi doit être refusé avec un motif clair. Tests : Tâche 8 (confirmation) et Tâche 10 (liste).
- **Le demandeur annule au moment exact où le propriétaire réclame** — un seul des deux effets doit l'emporter, jamais une tâche réclamée sur une demande annulée, jamais d'interblocage. Test : Tâche 6.
- **Le propriétaire saisit une preuve faite uniquement d'espaces, ou une date « dans 10 minutes » (horloge du téléphone)** — refus net avec un message, tolérance de 5 minutes seulement. Tests : Tâche 2 (fonction pure et schéma Zod) et Tâche 12 (route → 400).

## Tâches

1. Schéma, deux migrations, ordre de nettoyage des tests existants, contraintes en base
2. Logique pure `lib/access/fulfilment.ts` et schémas Zod
3. Fondations serveur : erreurs, périmètre d'exécution, libération et annulation d'une tâche READY
4. Modifications 3a : libération aux 3 sites, fermeture au lieu de suppression, annulation sensible à l'exécution
5. Lecture 3a : historique et suivi d'exécution dans « Mes demandes »
6. Réclamer et passer la main (avec revérification)
7. Bloquer, reprendre, réconcilier
8. Confirmer : effet sur l'affectation, rejeu, remplacement en deux temps, supplantation d'une expiration
9. Lots : réclamer et confirmer
10. Lecture des tâches : liste « mes actifs » et supervision
11. Processeur 5 minutes
12. Routes API des tâches
13. Route cron et crontab
14. Écran « Exécution »
15. « Mes demandes » : libellés, annulation après réclamation ; lien de navigation
16. Vérification finale

**Carte des fichiers**

| Fichier | Rôle | Tâches |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20260930090000_*`, `20260930090100_*` | Modèle | 1 |
| `lib/access/fulfilment.ts` | Pur : états, effets, validation, libellés | 2 |
| `lib/validations/access.ts` | Schémas Zod des routes | 2 |
| `lib/access/fulfilment-server.ts` | Mutations des tâches | 3, 6, 7, 8, 9 |
| `lib/access/requests-server.ts`, `requests-read-server.ts` | Modifications 3a | 4, 5 |
| `lib/access/fulfilment-read-server.ts` | Liste des tâches, navigation | 10 |
| `lib/access/access-processor.ts` | Processeur | 11 |
| `lib/access/fulfilment-http.ts`, `app/api/access/tasks/**`, `app/api/cron/access-processor/route.ts`, `cron/crontab` | HTTP | 12, 13 |
| `components/access/FulfilmentTask{Card,List}.tsx`, `app/(dashboard)/access/fulfilment/*` | Écran | 14 |
| `lib/access/request-labels.ts`, `app/(dashboard)/requests/mine/page.tsx`, `components/access/MyRequestActions.tsx`, `app/(dashboard)/layout.tsx`, `components/layout/{DashboardShell,Sidebar}.tsx` | Suivi et navigation | 15 |
| `tests/unit/access-db/fulfilment-fixtures.ts` | Jeu de données partagé des tests 3b | 3 |

---

## Task 1 : Schéma, deux migrations, ordre de nettoyage des tests existants, contraintes en base

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260930090000_add_access_request_fulfilment_states/migration.sql`
- Create: `prisma/migrations/20260930090100_add_access_fulfilment_tasks/migration.sql`
- Modify (nettoyage FK) : `tests/unit/access-db/access-constraints.test.ts`, `assignments-route.test.ts`, `import-server.test.ts`, `register-server.test.ts`, `requests-read-server.test.ts`, `requests-server.test.ts`
- Test: `tests/unit/access-db/access-constraints.test.ts`

**Interfaces:**
- Produces: enum `AccessRequestState` + `IN_PROGRESS`, `BLOCKED`, `COMPLETED` ; enums `AccessTaskAction` (`GRANT`, `CHANGE_LEVEL`, `RENEW`, `REVOKE`, `EXPIRY_REMOVAL`), `AccessTaskState` (`READY`, `CLAIMED`, `BLOCKED`, `COMPLETED`, `CANCELLED`), `AccessTaskEventType` ; modèles `AccessFulfilmentTask` (`prisma.accessFulfilmentTask`), `AccessTaskEvent` (`prisma.accessTaskEvent`) ; colonnes `AccessRequest.closedAt`, `AccessRequestVersion.outcome | completedAt | cancelRequestedAt` ; relation `AccessRequestVersion.fulfilmentTasks` ; index partiels `one_open_request_per_pair`, `one_open_task_per_version`.

Les migrations sont générées par le moteur de diff de Prisma (schéma → schéma, sans base ni base fantôme), complétées par du SQL brut pour les index partiels, puis appliquées par `migrate deploy`.

- [ ] **Step 1: Écrire les tests de contraintes (ils échouent : colonnes et modèles absents)**

Dans `tests/unit/access-db/access-constraints.test.ts`, remplacer le bloc `afterAll` par :

```ts
  afterAll(async () => {
    await prisma.accessTaskEvent.deleteMany({ where: { orgId } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });
    await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
    await prisma.accessRequest.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });
```

et ajouter, juste avant le `});` final du `describe` :

```ts
  // ── Phase 3b ────────────────────────────────────────────────────────────
  async function openVersion(requestId: string, versionNumber = 1) {
    return prisma.accessRequestVersion.create({
      data: {
        requestId,
        versionNumber,
        kind: "GRANT",
        initiatorId: userId,
        justification: "test contrainte",
        periodStart: new Date(),
        departmentSnapshot: "",
        assignmentVersion: 0,
        catalogueVersion: 1,
        state: "READY_FOR_FULFILMENT",
      },
    });
  }

  it("une seule demande OUVERTE par couple employé/actif ; une demande fermée libère le couple (index partiel)", async () => {
    const first = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    await expect(
      prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } })
    ).rejects.toThrow();
    await prisma.accessRequest.update({ where: { id: first.id }, data: { closedAt: new Date() } });
    const second = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    expect(second.closedAt).toBeNull();
    await prisma.accessRequest.update({ where: { id: second.id }, data: { closedAt: new Date() } });
  });

  it("une seule tâche ouverte par version de demande ; une tâche fermée n'empêche pas une nouvelle", async () => {
    const request = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    const version = await openVersion(request.id);
    const base = { orgId, assetId, beneficiaryId: userId, action: "GRANT" as const, requestVersionId: version.id, expectedAssignmentVersion: 0 };
    const t1 = await prisma.accessFulfilmentTask.create({ data: { ...base, idempotencyKey: `T1:${version.id}` } });
    await expect(
      prisma.accessFulfilmentTask.create({ data: { ...base, idempotencyKey: `T2:${version.id}` } })
    ).rejects.toThrow();
    await prisma.accessFulfilmentTask.update({ where: { id: t1.id }, data: { state: "CANCELLED" } });
    const t2 = await prisma.accessFulfilmentTask.create({ data: { ...base, idempotencyKey: `T2:${version.id}` } });
    expect(t2.state).toBe("READY");
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });

  it("une version référencée par une tâche ne peut pas être supprimée (FK Restrict : l'historique d'exécution survit)", async () => {
    const request = await prisma.accessRequest.create({ data: { orgId, beneficiaryId: userId, assetId } });
    const version = await openVersion(request.id);
    await prisma.accessFulfilmentTask.create({
      data: { orgId, assetId, beneficiaryId: userId, action: "GRANT", requestVersionId: version.id, expectedAssignmentVersion: 0, idempotencyKey: `REQ:${version.id}` },
    });
    await expect(prisma.accessRequestVersion.delete({ where: { id: version.id } })).rejects.toThrow();
    await expect(prisma.accessRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/access-constraints.test.ts`
Expected: FAIL (`accessTaskEvent` / `accessFulfilmentTask` indéfinis, `closedAt` inconnu).

- [ ] **Step 3: Migration A — valeurs d'énumération seules**

```bash
git show HEAD:prisma/schema.prisma > /tmp/schema-3b-head.prisma
```

Dans `prisma/schema.prisma`, ajouter trois valeurs à la fin de `enum AccessRequestState` :

```prisma
enum AccessRequestState {
  PENDING_APPROVAL
  CLARIFICATION_REQUIRED
  REVISION_REQUIRED
  AUTHORIZED_WAITING_START
  READY_FOR_FULFILMENT
  REJECTED
  CANCELLED
  IN_PROGRESS
  BLOCKED
  COMPLETED
}
```

```bash
mkdir -p prisma/migrations/20260930090000_add_access_request_fulfilment_states
npx prisma migrate diff --from-schema-datamodel /tmp/schema-3b-head.prisma --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null > prisma/migrations/20260930090000_add_access_request_fulfilment_states/migration.sql
cp prisma/schema.prisma /tmp/schema-3b-enum.prisma
cat prisma/migrations/20260930090000_add_access_request_fulfilment_states/migration.sql
```

Expected : un commentaire `-- AlterEnum`, puis exactement ces trois instructions et rien d'autre (⚠️ jamais `2>&1` : un avertissement Prisma écrit dans le fichier casserait `migrate deploy`) :

```sql
ALTER TYPE "AccessRequestState" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "AccessRequestState" ADD VALUE 'BLOCKED';
ALTER TYPE "AccessRequestState" ADD VALUE 'COMPLETED';
```

- [ ] **Step 4: Migration B — modèles, colonnes, index**

Dans `prisma/schema.prisma` :

(a) après `enum ApprovalDecision { … }`, ajouter :

```prisma
enum AccessTaskAction {
  GRANT
  CHANGE_LEVEL
  RENEW
  REVOKE
  EXPIRY_REMOVAL
}

enum AccessTaskState {
  READY
  CLAIMED
  BLOCKED
  COMPLETED
  CANCELLED
}

enum AccessTaskEventType {
  RELEASED
  CLAIMED
  HANDED_OVER
  BLOCKED
  RESUMED
  PARTIAL_REMOVAL
  COMPLETED
  RECONCILED
  CANCELLED
}
```

(b) dans `model Organization`, après `accessRequests AccessRequest[]`, ajouter `accessFulfilmentTasks AccessFulfilmentTask[]`.

(c) dans `model AccessAsset`, après `assignments AccessAssignment[]`, ajouter `fulfilmentTasks AccessFulfilmentTask[]`.

(d) remplacer `model AccessRequest` par :

```prisma
model AccessRequest {
  id            String    @id @default(cuid())
  orgId         String
  beneficiaryId String
  assetId       String
  // Phase 3b : une demande n'est plus jamais supprimée. `closedAt` est posé au
  // rejet, à l'annulation, à l'exécution et à la réconciliation. L'unicité
  // « une demande ouverte par employé/actif » est l'index unique PARTIEL
  // `one_open_request_per_pair` (WHERE "closedAt" IS NULL), créé en SQL brut
  // dans la migration 20260930090100 — Prisma ne sait pas l'exprimer ici.
  closedAt      DateTime?
  createdAt     DateTime  @default(now())

  org      Organization           @relation(fields: [orgId], references: [id], onDelete: Cascade)
  versions AccessRequestVersion[]

  @@index([orgId, beneficiaryId])
  @@index([orgId, assetId])
  @@map("access_requests")
}
```

(e) dans `model AccessRequestVersion`, après `exceptionReason String?`, ajouter :

```prisma
  outcome            String?
  completedAt        DateTime?
  cancelRequestedAt  DateTime?
```

et, après `stages AccessApprovalStage[]`, ajouter `fulfilmentTasks AccessFulfilmentTask[]`.

(f) à la fin du fichier, ajouter :

```prisma
// ============================================================================
// GESTION DES ACCÈS — Phase 3b (exécution des demandes)
// ============================================================================

model AccessFulfilmentTask {
  id                        String           @id @default(cuid())
  orgId                     String
  assetId                   String
  beneficiaryId             String
  action                    AccessTaskAction
  state                     AccessTaskState  @default(READY)
  requestVersionId          String?
  sourceAssignmentId        String?
  sourceAssignmentVersion   Int?
  fromLevelId               String?
  toLevelId                 String?
  periodStart               DateTime?
  periodEnd                 DateTime?
  expectedAssignmentVersion Int
  claimantId                String?
  claimedAt                 DateTime?
  blockedReason             String?          @db.Text
  progress                  Json?
  completedAt               DateTime?
  completionReference       String?
  completionNote            String?          @db.Text
  completionMethod          String?
  completedById             String?
  outcome                   String?
  idempotencyKey            String           @unique
  revision                  Int              @default(1)
  releasedAt                DateTime         @default(now())
  createdAt                 DateTime         @default(now())
  updatedAt                 DateTime         @updatedAt

  org            Organization          @relation(fields: [orgId], references: [id], onDelete: Cascade)
  asset          AccessAsset           @relation(fields: [assetId], references: [id], onDelete: Restrict)
  requestVersion AccessRequestVersion? @relation(fields: [requestVersionId], references: [id], onDelete: Restrict)
  events         AccessTaskEvent[]

  @@index([orgId, state])
  @@index([orgId, assetId, state])
  @@index([requestVersionId])
  @@index([sourceAssignmentId])
  @@map("access_fulfilment_tasks")
}

model AccessTaskEvent {
  id         String              @id @default(cuid())
  orgId      String
  taskId     String
  type       AccessTaskEventType
  actorId    String?
  actingAs   String?
  toUserId   String?
  reason     String?             @db.Text
  facts      Json?
  occurredAt DateTime            @default(now())

  task AccessFulfilmentTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, occurredAt])
  @@map("access_task_events")
}
```

Puis :

```bash
npx prisma format
npx prisma validate
mkdir -p prisma/migrations/20260930090100_add_access_fulfilment_tasks
npx prisma migrate diff --from-schema-datamodel /tmp/schema-3b-enum.prisma --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null > prisma/migrations/20260930090100_add_access_fulfilment_tasks/migration.sql
cat >> prisma/migrations/20260930090100_add_access_fulfilment_tasks/migration.sql <<'SQL'

-- ─── SQL brut (phase 3b) — Prisma ne sait pas exprimer ces index partiels ───
-- Ils sont invisibles pour `prisma migrate diff` (qui ignore les index
-- partiels, comme ceux de la phase 1) : aucune migration future ne les
-- supprimera par dérive.

-- D-4 : une demande n'est plus supprimée à l'état terminal ; l'unicité « une
-- demande ouverte par employé/actif » ne porte que sur les demandes non closes.
CREATE UNIQUE INDEX "one_open_request_per_pair"
  ON "access_requests" ("orgId", "beneficiaryId", "assetId")
  WHERE "closedAt" IS NULL;

-- D-20 : au plus une tâche ouverte par version de demande.
CREATE UNIQUE INDEX "one_open_task_per_version"
  ON "access_fulfilment_tasks" ("requestVersionId")
  WHERE "requestVersionId" IS NOT NULL AND "state" IN ('READY', 'CLAIMED', 'BLOCKED');
SQL
head -2 prisma/migrations/20260930090100_add_access_fulfilment_tasks/migration.sql
grep -c "one_nonterminal_request_enforced_in_service" prisma/migrations/20260930090100_add_access_fulfilment_tasks/migration.sql
```

Expected : le fichier commence par `-- CreateEnum` ; il contient 3 `CREATE TYPE`, `DROP INDEX "one_nonterminal_request_enforced_in_service";` (le `grep -c` affiche `1`), `ALTER TABLE "access_requests" ADD COLUMN "closedAt"`, `ALTER TABLE "access_request_versions" ADD COLUMN` (×3), 2 `CREATE TABLE`, 6 `CREATE INDEX`, 4 `ADD CONSTRAINT … FOREIGN KEY` (`orgId` CASCADE, `assetId` RESTRICT, `requestVersionId` RESTRICT, `taskId` CASCADE), puis les 2 index partiels. Aucun autre `DROP`.

- [ ] **Step 5: Appliquer et régénérer le client**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-url "$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null
```

Expected : `All migrations have been successfully applied.` ; le dernier diff ne mentionne **aucune** table `access_*` (au plus un `DROP TABLE "mobile_refresh_tokens"` : dérive locale préexistante d'une autre branche, à ignorer).

- [ ] **Step 6: Ordre de nettoyage des tests existants (FK Restrict)**

`AccessFulfilmentTask` référence `AccessAsset` et `AccessRequestVersion` en `Restrict` : tout `afterAll` qui supprime des actifs ou des versions doit d'abord supprimer les tâches. Supprimer dans une table vide est sans effet : ces lignes sont ajoutées partout, que le fichier crée déjà des tâches ou non (le processeur et les tâches suivantes en créeront).

Les deux lignes à insérer (notées **[T]** ci-dessous) :

```ts
    await prisma.accessTaskEvent.deleteMany({ where: { orgId } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });
```

- `tests/unit/access-db/import-server.test.ts` : insérer **[T]** en première position des deux `afterAll` qui suppriment des `accessAsset` (describes « catalogue seed » et « baseline assignments »), avant `await prisma.importBatch.deleteMany(...)`.
- `tests/unit/access-db/requests-read-server.test.ts` : insérer **[T]** en première position de l'`afterAll`.
- `tests/unit/access-db/assignments-route.test.ts` et `tests/unit/access-db/register-server.test.ts` : dans la boucle `for (const id of [orgId, otherOrgId])` de l'`afterAll`, insérer en première position :

```ts
      await prisma.accessTaskEvent.deleteMany({ where: { orgId: id } });
      await prisma.accessFulfilmentTask.deleteMany({ where: { orgId: id } });
```

- `tests/unit/access-db/requests-server.test.ts` :
  - insérer **[T]** en première position des **cinq** `afterAll` ;
  - dans l'`afterEach` du describe « correctifs revue finale », insérer **[T]** avant `await prisma.accessRequest.deleteMany({ where: { orgId } });` ;
  - dans le test « le CISO et l'opérateur IT peuvent initier une réduction… », insérer `await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });` avant le `await prisma.accessRequest.deleteMany({ where: { orgId } });` du milieu du test ;
  - dans la fonction `cleanup(version)` du describe « décision d'étape », insérer en première position :

```ts
    // Phase 3b : une version READY_FOR_FULFILMENT porte une tâche (FK Restrict).
    await prisma.accessTaskEvent.deleteMany({ where: { task: { requestVersionId: version.id } } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { requestVersionId: version.id } });
```

  - dans la fonction `cleanup(requestId)` du describe « clarification, révision, annulation », insérer en première position :

```ts
    await prisma.accessTaskEvent.deleteMany({ where: { task: { requestVersion: { requestId } } } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { requestVersion: { requestId } } });
```

  - dans le test « le titulaire COO demandant son propre accès… », insérer avant `await prisma.accessRequestVersion.delete({ where: { id: version.id } });` :

```ts
    await prisma.accessTaskEvent.deleteMany({ where: { task: { requestVersionId: version.id } } });
    await prisma.accessFulfilmentTask.deleteMany({ where: { requestVersionId: version.id } });
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run tests/unit/access-db && npx tsc --noEmit`
Expected: PASS — 8 fichiers, tous les tests existants verts + les 3 nouveaux tests de contraintes ; aucune erreur de type.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260930090000_add_access_request_fulfilment_states prisma/migrations/20260930090100_add_access_fulfilment_tasks tests/unit/access-db
git commit -m "feat(access): schéma phase 3b — tâches d'exécution, états de demande, index partiels" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2 : Logique pure `lib/access/fulfilment.ts` et schémas Zod

**Files:**
- Create: `lib/access/fulfilment.ts`
- Modify: `lib/validations/access.ts` (ajout en fin de fichier)
- Test: `tests/unit/access-fulfilment.test.ts`, `tests/unit/access-fulfilment-validation.test.ts`

**Interfaces:**
- Consumes: `ReadScope` (`lib/access/scope.ts`), `optionalId` (constante locale existante de `lib/validations/access.ts`).
- Produces (`lib/access/fulfilment.ts`) : types `TaskAction`, `TaskState`, `TaskTransition`, `TaskOutcome`, `CompletionMethod`, `OwnerRole`, `AssignmentSnapshot`, `TaskTerms`, `AssignmentWrite`, `AssignmentEffect`, `CompletionFacts` ; constantes `OPEN_TASK_STATES`, `CLOSED_TASK_STATES`, `EXPIRY_OWNER_REASON`, `PARTIAL_REMOVAL_REASON`, `SUPERSEDED_REASON`, `EXPIRED_BEFORE_FULFILMENT_REASON`, `ASSIGNMENT_CHANGED_REASON`, `TASK_ACTION_LABELS`, `TASK_STATE_LABELS` ; fonctions `taskActionForKind(kind): TaskAction`, `nextTaskState(state, transition): TaskState | null`, `canTransition(state, transition): boolean`, `outcomeFor(action): TaskOutcome`, `assignmentEffect(action, current, task, completedAt): AssignmentEffect`, `partialRemovalEffect(current, task, completedAt): AssignmentEffect`, `validateCompletionInput(facts, { now, claimedAt }): string | null`, `ownerRoleFor(asset, userId): OwnerRole | null`, `readOldRemovedAt(progress: unknown): string | null`, `fulfilmentNavFlags(scopes, fulfilmentAssetIds): { hasFulfilmentView, hasMineView, canOversee }`, `shortTaskReference(taskId): string`.
- Produces (`lib/validations/access.ts`) : `taskRevisionSchema`, `handoverTaskSchema`, `blockTaskSchema`, `reconcileTaskSchema`, `completeTaskSchema`, `claimBatchSchema`, `completeBatchSchema`, `taskListQuerySchema`, types `CompleteTaskBody`, `TaskListQueryInput`.

Écart assumé avec la spec §6 : `taskActionForKind(kind)` n'a pas de second paramètre `hasCurrentLevel` — le type de demande détermine seul l'action (un `GRANT` sur une ligne `EXPIRED_REMOVAL_PENDING` reste un `GRANT`, D-23).

- [ ] **Step 1: Écrire les tests de la logique pure**

```ts
// tests/unit/access-fulfilment.test.ts
import { describe, it, expect } from "vitest";
import {
  assignmentEffect,
  canTransition,
  fulfilmentNavFlags,
  nextTaskState,
  outcomeFor,
  ownerRoleFor,
  partialRemovalEffect,
  readOldRemovedAt,
  shortTaskReference,
  taskActionForKind,
  validateCompletionInput,
  type AssignmentSnapshot,
  type TaskState,
  type TaskTerms,
  type TaskTransition,
} from "@/lib/access/fulfilment";

const AT = new Date("2026-10-05T10:00:00.000Z");
const START = new Date("2026-10-01T00:00:00.000Z");
const END = new Date("2026-12-31T00:00:00.000Z");

function terms(over: Partial<TaskTerms> = {}): TaskTerms {
  return { fromLevelId: null, toLevelId: "L2", periodStart: START, periodEnd: null, oldRemoved: false, ...over };
}
function snap(over: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
  return { status: "ACTIVE", levelId: "L1", periodStart: START, periodEnd: null, ...over };
}

describe("taskActionForKind", () => {
  it("associe chaque type de demande à une action d'exécution", () => {
    expect(taskActionForKind("GRANT")).toBe("GRANT");
    expect(taskActionForKind("UPGRADE")).toBe("CHANGE_LEVEL");
    expect(taskActionForKind("REDUCE")).toBe("CHANGE_LEVEL");
    expect(taskActionForKind("RENEW")).toBe("RENEW");
    expect(taskActionForKind("REVOKE")).toBe("REVOKE");
  });
});

describe("machine à états des tâches", () => {
  const valid: [TaskState, TaskTransition, TaskState][] = [
    ["READY", "CLAIM", "CLAIMED"],
    ["CLAIMED", "HANDOVER", "CLAIMED"],
    ["BLOCKED", "HANDOVER", "BLOCKED"],
    ["CLAIMED", "BLOCK", "BLOCKED"],
    ["CLAIMED", "PARTIAL_REMOVAL", "BLOCKED"],
    ["BLOCKED", "RESUME", "CLAIMED"],
    ["CLAIMED", "COMPLETE", "COMPLETED"],
    ["READY", "CANCEL", "CANCELLED"],
    ["CLAIMED", "RECONCILE", "CANCELLED"],
    ["BLOCKED", "RECONCILE", "CANCELLED"],
  ];
  it.each(valid)("%s --%s--> %s", (from, transition, to) => {
    expect(nextTaskState(from, transition)).toBe(to);
    expect(canTransition(from, transition)).toBe(true);
  });

  const invalid: [TaskState, TaskTransition][] = [
    ["READY", "COMPLETE"],
    ["READY", "BLOCK"],
    ["READY", "RECONCILE"],
    ["READY", "HANDOVER"],
    ["CLAIMED", "CLAIM"],
    ["CLAIMED", "CANCEL"],
    ["BLOCKED", "COMPLETE"],
    ["BLOCKED", "CANCEL"],
  ];
  it.each(invalid)("%s --%s--> refusé", (from, transition) => {
    expect(nextTaskState(from, transition)).toBeNull();
    expect(canTransition(from, transition)).toBe(false);
  });

  it("COMPLETED et CANCELLED sont immuables", () => {
    const all: TaskTransition[] = ["CLAIM", "HANDOVER", "BLOCK", "PARTIAL_REMOVAL", "RESUME", "COMPLETE", "CANCEL", "RECONCILE"];
    for (const t of all) {
      expect(canTransition("COMPLETED", t)).toBe(false);
      expect(canTransition("CANCELLED", t)).toBe(false);
    }
  });
});

describe("outcomeFor", () => {
  it("donne le résultat métier de chaque action", () => {
    expect(outcomeFor("GRANT")).toBe("PROVISIONED");
    expect(outcomeFor("CHANGE_LEVEL")).toBe("CHANGED");
    expect(outcomeFor("RENEW")).toBe("RENEWED");
    expect(outcomeFor("REVOKE")).toBe("REVOKED");
    expect(outcomeFor("EXPIRY_REMOVAL")).toBe("REMOVED");
  });
});

describe("assignmentEffect — tableau §5 ligne par ligne", () => {
  it("GRANT sans affectation → ACTIVE au niveau cible, période de la version, grantedAt = date réelle", () => {
    const e = assignmentEffect("GRANT", null, terms({ periodEnd: END }), AT);
    expect(e).toEqual({
      ok: true,
      write: { status: "ACTIVE", levelId: "L2", periodStart: START, periodEnd: END, grantedAt: AT, revokedAt: null },
    });
  });

  it("GRANT sur une ligne REVOKED ou EXPIRED_REMOVAL_PENDING (D-23) → ACTIVE", () => {
    expect(assignmentEffect("GRANT", snap({ status: "REVOKED", levelId: null }), terms(), AT).ok).toBe(true);
    expect(assignmentEffect("GRANT", snap({ status: "EXPIRED_REMOVAL_PENDING" }), terms(), AT).ok).toBe(true);
  });

  it("GRANT sur une ligne ACTIVE avec niveau → refusé (l'affectation a changé)", () => {
    expect(assignmentEffect("GRANT", snap(), terms(), AT)).toEqual({ ok: false, reason: "L'affectation a changé depuis l'approbation" });
  });

  it("CHANGE_LEVEL depuis le niveau attendu → niveau cible, période de la version", () => {
    const e = assignmentEffect("CHANGE_LEVEL", snap(), terms({ fromLevelId: "L1", periodEnd: END }), AT);
    expect(e).toEqual({
      ok: true,
      write: { status: "ACTIVE", levelId: "L2", periodStart: START, periodEnd: END, grantedAt: AT, revokedAt: null },
    });
  });

  it("CHANGE_LEVEL alors que le niveau courant n'est plus celui attendu → refusé", () => {
    expect(assignmentEffect("CHANGE_LEVEL", snap({ levelId: "L9" }), terms({ fromLevelId: "L1" }), AT).ok).toBe(false);
    expect(assignmentEffect("CHANGE_LEVEL", null, terms({ fromLevelId: "L1" }), AT).ok).toBe(false);
  });

  it("CHANGE_LEVEL après retrait partiel : attend « aucun accès » (REVOKED, niveau nul)", () => {
    const after = snap({ status: "REVOKED", levelId: null });
    expect(assignmentEffect("CHANGE_LEVEL", after, terms({ fromLevelId: "L1", oldRemoved: true }), AT).ok).toBe(true);
    expect(assignmentEffect("CHANGE_LEVEL", snap(), terms({ fromLevelId: "L1", oldRemoved: true }), AT).ok).toBe(false);
  });

  it("RENEW sur ACTIVE ou EXPIRED_REMOVAL_PENDING → ACTIVE, nouvelle fin, niveau et grantedAt inchangés", () => {
    for (const status of ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] as const) {
      const e = assignmentEffect("RENEW", snap({ status, periodEnd: AT }), terms({ toLevelId: "L1", periodEnd: END }), AT);
      expect(e).toEqual({
        ok: true,
        write: { status: "ACTIVE", levelId: "L1", periodStart: START, periodEnd: END, revokedAt: null },
      });
    }
  });

  it("RENEW sur une ligne REVOKED ou d'un autre niveau → refusé", () => {
    expect(assignmentEffect("RENEW", snap({ status: "REVOKED", levelId: null }), terms({ toLevelId: "L1" }), AT).ok).toBe(false);
    expect(assignmentEffect("RENEW", snap({ levelId: "L3" }), terms({ toLevelId: "L1" }), AT).ok).toBe(false);
  });

  it("REVOKE et EXPIRY_REMOVAL sur ACTIVE/EXPIRED_REMOVAL_PENDING → REVOKED, niveau nul, revokedAt = date réelle", () => {
    for (const action of ["REVOKE", "EXPIRY_REMOVAL"] as const) {
      for (const status of ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] as const) {
        const e = assignmentEffect(action, snap({ status, periodEnd: END }), terms({ toLevelId: null }), AT);
        expect(e).toEqual({
          ok: true,
          write: { status: "REVOKED", levelId: null, periodStart: START, periodEnd: END, revokedAt: AT },
        });
      }
    }
  });

  it("REVOKE sans affectation ou déjà REVOKED → refusé", () => {
    expect(assignmentEffect("REVOKE", null, terms({ toLevelId: null }), AT).ok).toBe(false);
    expect(assignmentEffect("REVOKE", snap({ status: "REVOKED", levelId: null }), terms({ toLevelId: null }), AT).ok).toBe(false);
  });
});

describe("partialRemovalEffect (D-10, A18)", () => {
  it("retire l'ancien niveau : REVOKED, niveau nul", () => {
    const e = partialRemovalEffect(snap(), terms({ fromLevelId: "L1" }), AT);
    expect(e).toEqual({
      ok: true,
      write: { status: "REVOKED", levelId: null, periodStart: START, periodEnd: null, revokedAt: AT },
    });
  });
  it("refusé si déjà enregistré ou si le niveau courant n'est pas l'ancien niveau", () => {
    expect(partialRemovalEffect(snap(), terms({ fromLevelId: "L1", oldRemoved: true }), AT).ok).toBe(false);
    expect(partialRemovalEffect(snap({ levelId: "L7" }), terms({ fromLevelId: "L1" }), AT).ok).toBe(false);
  });
});

describe("validateCompletionInput", () => {
  const now = AT;
  const claimedAt = new Date("2026-10-05T08:00:00.000Z");
  it("accepte une référence seule ou une note seule", () => {
    expect(validateCompletionInput({ completedAt: now, reference: "TICKET-1", note: null }, { now, claimedAt })).toBeNull();
    expect(validateCompletionInput({ completedAt: now, reference: null, note: "fait" }, { now, claimedAt })).toBeNull();
  });
  it("refuse l'absence de preuve, y compris des espaces seuls (Review Focus #5)", () => {
    expect(validateCompletionInput({ completedAt: now, reference: "   ", note: " \n " }, { now, claimedAt })).toBe(
      "Une référence ou une note d'exécution est obligatoire"
    );
  });
  it("tolère 5 minutes de décalage d'horloge, pas davantage (Review Focus #5)", () => {
    const in4min = new Date(now.getTime() + 4 * 60_000);
    const in6min = new Date(now.getTime() + 6 * 60_000);
    expect(validateCompletionInput({ completedAt: in4min, reference: "R", note: null }, { now, claimedAt })).toBeNull();
    expect(validateCompletionInput({ completedAt: in6min, reference: "R", note: null }, { now, claimedAt })).toBe(
      "La date d'exécution ne peut pas être dans le futur"
    );
  });
  it("refuse une date antérieure de plus d'un jour à la prise en charge", () => {
    const tooEarly = new Date(claimedAt.getTime() - 25 * 3_600_000);
    expect(validateCompletionInput({ completedAt: tooEarly, reference: "R", note: null }, { now, claimedAt })).toBe(
      "La date d'exécution précède de plus d'un jour la prise en charge de la tâche"
    );
  });
  it("refuse une date invalide et des textes trop longs", () => {
    expect(validateCompletionInput({ completedAt: new Date("x"), reference: "R", note: null }, { now, claimedAt })).toBe("Date d'exécution invalide");
    expect(validateCompletionInput({ completedAt: now, reference: "r".repeat(201), note: null }, { now, claimedAt })).toBe(
      "La référence dépasse 200 caractères"
    );
    expect(validateCompletionInput({ completedAt: now, reference: null, note: "n".repeat(2001) }, { now, claimedAt })).toBe(
      "La note dépasse 2000 caractères"
    );
  });
});

describe("ownerRoleFor", () => {
  it("propriétaire, suppléant, ou rien", () => {
    const asset = { ownerId: "o", backupOwnerId: "b" };
    expect(ownerRoleFor(asset, "o")).toBe("ASSET_OWNER");
    expect(ownerRoleFor(asset, "b")).toBe("ASSET_OWNER_BACKUP");
    expect(ownerRoleFor(asset, "x")).toBeNull();
    expect(ownerRoleFor({ ownerId: null, backupOwnerId: null }, "o")).toBeNull();
  });
});

describe("readOldRemovedAt", () => {
  it("lit progress.oldRemovedAt sans jamais planter", () => {
    expect(readOldRemovedAt({ oldRemovedAt: "2026-10-05T10:00:00.000Z" })).toBe("2026-10-05T10:00:00.000Z");
    expect(readOldRemovedAt(null)).toBeNull();
    expect(readOldRemovedAt([])).toBeNull();
    expect(readOldRemovedAt({ oldRemovedAt: 3 })).toBeNull();
  });
});

describe("fulfilmentNavFlags", () => {
  it("lien « Exécution » si au moins un actif d'exécution ou la portée ALL", () => {
    expect(fulfilmentNavFlags([{ kind: "SELF", userId: "u" }], [])).toEqual({ hasFulfilmentView: false, hasMineView: false, canOversee: false });
    expect(fulfilmentNavFlags([{ kind: "SELF", userId: "u" }], ["a1"])).toEqual({ hasFulfilmentView: true, hasMineView: true, canOversee: false });
    expect(fulfilmentNavFlags([{ kind: "SELF", userId: "u" }, { kind: "ALL" }], [])).toEqual({ hasFulfilmentView: true, hasMineView: false, canOversee: true });
  });
});

describe("shortTaskReference", () => {
  it("préfixe EX- et les 6 derniers caractères en majuscules", () => {
    expect(shortTaskReference("clx0000abcdef")).toBe("EX-ABCDEF");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-fulfilment.test.ts`
Expected: FAIL — module `@/lib/access/fulfilment` introuvable.

- [ ] **Step 3: Créer `lib/access/fulfilment.ts`**

```ts
// lib/access/fulfilment.ts
// Exécution des demandes (phase 3b) — logique pure, sans accès base.
// Machine à états des tâches, effet d'une confirmation sur l'affectation
// courante (spec 3b §5), validation des faits d'exécution, rôle d'un
// propriétaire, drapeaux de navigation et libellés.
import type { ReadScope } from "./scope";

export type TaskAction = "GRANT" | "CHANGE_LEVEL" | "RENEW" | "REVOKE" | "EXPIRY_REMOVAL";
export type TaskState = "READY" | "CLAIMED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
export type TaskTransition =
  | "CLAIM"
  | "HANDOVER"
  | "BLOCK"
  | "PARTIAL_REMOVAL"
  | "RESUME"
  | "COMPLETE"
  | "CANCEL"
  | "RECONCILE";
export type TaskOutcome =
  | "PROVISIONED"
  | "CHANGED"
  | "RENEWED"
  | "REVOKED"
  | "REMOVED"
  | "NOT_PERFORMED"
  | "SUPERSEDED"
  | "EXPIRED_BEFORE_FULFILMENT";
export type CompletionMethod = "DIRECT" | "REMOVE_THEN_GRANT";
export type OwnerRole = "ASSET_OWNER" | "ASSET_OWNER_BACKUP";
export type RequestKindForTask = "GRANT" | "UPGRADE" | "RENEW" | "REDUCE" | "REVOKE";

export const OPEN_TASK_STATES = ["READY", "CLAIMED", "BLOCKED"] as const;
export const CLOSED_TASK_STATES = ["COMPLETED", "CANCELLED"] as const;

export const EXPIRY_OWNER_REASON = "Fin de période temporaire";
export const PARTIAL_REMOVAL_REASON = "Ancien niveau retiré — nouvel accès pas encore accordé";
export const SUPERSEDED_REASON = "Supplantée par un renouvellement";
export const EXPIRED_BEFORE_FULFILMENT_REASON = "Fin de période dépassée avant exécution";
export const ASSIGNMENT_CHANGED_REASON = "L'affectation a changé depuis l'approbation";

/**
 * Action de la tâche d'exécution pour un type de demande (3a). UPGRADE et
 * REDUCE sont tous deux un remplacement de niveau pour le propriétaire.
 */
export function taskActionForKind(kind: RequestKindForTask): TaskAction {
  switch (kind) {
    case "GRANT":
      return "GRANT";
    case "UPGRADE":
    case "REDUCE":
      return "CHANGE_LEVEL";
    case "RENEW":
      return "RENEW";
    case "REVOKE":
      return "REVOKE";
  }
}

// Spec 3b §5 (FP:285). COMPLETED et CANCELLED sont immuables : aucune entrée.
const TRANSITIONS: Record<TaskTransition, Partial<Record<TaskState, TaskState>>> = {
  CLAIM: { READY: "CLAIMED" },
  HANDOVER: { CLAIMED: "CLAIMED", BLOCKED: "BLOCKED" },
  BLOCK: { CLAIMED: "BLOCKED" },
  PARTIAL_REMOVAL: { CLAIMED: "BLOCKED" },
  RESUME: { BLOCKED: "CLAIMED" },
  COMPLETE: { CLAIMED: "COMPLETED" },
  CANCEL: { READY: "CANCELLED" },
  RECONCILE: { CLAIMED: "CANCELLED", BLOCKED: "CANCELLED" },
};

export function nextTaskState(state: TaskState, transition: TaskTransition): TaskState | null {
  return TRANSITIONS[transition][state] ?? null;
}

export function canTransition(state: TaskState, transition: TaskTransition): boolean {
  return nextTaskState(state, transition) !== null;
}

export function outcomeFor(action: TaskAction): TaskOutcome {
  switch (action) {
    case "GRANT":
      return "PROVISIONED";
    case "CHANGE_LEVEL":
      return "CHANGED";
    case "RENEW":
      return "RENEWED";
    case "REVOKE":
      return "REVOKED";
    case "EXPIRY_REMOVAL":
      return "REMOVED";
  }
}

export interface AssignmentSnapshot {
  status: "ACTIVE" | "EXPIRED_REMOVAL_PENDING" | "REVOKED";
  levelId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface TaskTerms {
  fromLevelId: string | null;
  toLevelId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Étape 1 d'un REMOVE_THEN_GRANT déjà enregistrée (D-10). */
  oldRemoved: boolean;
}

export interface AssignmentWrite {
  status: "ACTIVE" | "REVOKED";
  levelId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Absent = inchangé (renouvellement : le niveau courant n'est pas ré-accordé). */
  grantedAt?: Date;
  revokedAt: Date | null;
}

export type AssignmentEffect = { ok: true; write: AssignmentWrite } | { ok: false; reason: string };

const changed: AssignmentEffect = { ok: false, reason: ASSIGNMENT_CHANGED_REASON };

/**
 * Effet d'une confirmation sur l'affectation courante (spec 3b §5, tableau
 * « Affectation »). `ok: false` = l'état courant ne correspond pas à ce que
 * l'approbation supposait : la confirmation est refusée (409), jamais
 * appliquée sur un état inattendu.
 */
export function assignmentEffect(
  action: TaskAction,
  current: AssignmentSnapshot | null,
  task: TaskTerms,
  completedAt: Date
): AssignmentEffect {
  switch (action) {
    case "GRANT": {
      const free = current === null || current.status !== "ACTIVE" || current.levelId === null;
      if (!free || task.toLevelId === null) return changed;
      return {
        ok: true,
        write: {
          status: "ACTIVE",
          levelId: task.toLevelId,
          periodStart: task.periodStart ?? completedAt,
          periodEnd: task.periodEnd,
          grantedAt: completedAt,
          revokedAt: null,
        },
      };
    }
    case "CHANGE_LEVEL": {
      if (task.toLevelId === null || current === null) return changed;
      const expected = task.oldRemoved
        ? current.status === "REVOKED" && current.levelId === null
        : current.status === "ACTIVE" && current.levelId !== null && current.levelId === task.fromLevelId;
      if (!expected) return changed;
      return {
        ok: true,
        write: {
          status: "ACTIVE",
          levelId: task.toLevelId,
          periodStart: task.periodStart ?? completedAt,
          periodEnd: task.periodEnd,
          grantedAt: completedAt,
          revokedAt: null,
        },
      };
    }
    case "RENEW": {
      if (current === null || current.status === "REVOKED" || current.levelId === null) return changed;
      if (current.levelId !== task.toLevelId) return changed;
      return {
        ok: true,
        write: {
          status: "ACTIVE",
          levelId: current.levelId,
          periodStart: current.periodStart,
          periodEnd: task.periodEnd,
          revokedAt: null,
        },
      };
    }
    case "REVOKE":
    case "EXPIRY_REMOVAL": {
      if (current === null || current.status === "REVOKED") return changed;
      return {
        ok: true,
        write: {
          status: "REVOKED",
          levelId: null,
          periodStart: current.periodStart,
          periodEnd: current.periodEnd,
          revokedAt: completedAt,
        },
      };
    }
  }
}

/**
 * Étape 1 d'un remplacement REMOVE_THEN_GRANT (D-10, FP:243) : l'ancien
 * niveau est retiré, le nouveau pas encore accordé → « aucun accès courant »,
 * jamais deux niveaux ni un faux succès (A18).
 */
export function partialRemovalEffect(
  current: AssignmentSnapshot | null,
  task: TaskTerms,
  completedAt: Date
): AssignmentEffect {
  if (task.oldRemoved || current === null) return changed;
  if (current.status !== "ACTIVE" || current.levelId === null || current.levelId !== task.fromLevelId) return changed;
  return {
    ok: true,
    write: {
      status: "REVOKED",
      levelId: null,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      revokedAt: completedAt,
    },
  };
}

export interface CompletionFacts {
  completedAt: Date;
  reference: string | null;
  note: string | null;
}

const FIVE_MINUTES_MS = 5 * 60_000;
const ONE_DAY_MS = 24 * 3_600_000;

/** Message d'erreur (français) ou null si les faits d'exécution sont recevables. */
export function validateCompletionInput(
  facts: CompletionFacts,
  ctx: { now: Date; claimedAt: Date | null }
): string | null {
  if (Number.isNaN(facts.completedAt.getTime())) return "Date d'exécution invalide";
  if (facts.completedAt.getTime() > ctx.now.getTime() + FIVE_MINUTES_MS) {
    return "La date d'exécution ne peut pas être dans le futur";
  }
  if (ctx.claimedAt && facts.completedAt.getTime() < ctx.claimedAt.getTime() - ONE_DAY_MS) {
    return "La date d'exécution précède de plus d'un jour la prise en charge de la tâche";
  }
  const reference = facts.reference?.trim() ?? "";
  const note = facts.note?.trim() ?? "";
  if (!reference && !note) return "Une référence ou une note d'exécution est obligatoire";
  if (reference.length > 200) return "La référence dépasse 200 caractères";
  if (note.length > 2000) return "La note dépasse 2000 caractères";
  return null;
}

/** Rôle de l'utilisateur sur l'actif (le propriétaire principal prime), ou null. */
export function ownerRoleFor(
  asset: { ownerId: string | null; backupOwnerId: string | null },
  userId: string
): OwnerRole | null {
  if (asset.ownerId === userId) return "ASSET_OWNER";
  if (asset.backupOwnerId === userId) return "ASSET_OWNER_BACKUP";
  return null;
}

/** Date ISO de l'étape 1 d'un REMOVE_THEN_GRANT, lue dans `progress` (Json). */
export function readOldRemovedAt(progress: unknown): string | null {
  if (progress && typeof progress === "object" && !Array.isArray(progress)) {
    const value = (progress as Record<string, unknown>).oldRemovedAt;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Drapeaux de navigation de l'écran « Exécution » (D-15), calculés côté
 * serveur depuis les portées — même principe que `registerNavFlags`.
 */
export function fulfilmentNavFlags(
  scopes: ReadScope[],
  fulfilmentAssetIds: string[]
): { hasFulfilmentView: boolean; hasMineView: boolean; canOversee: boolean } {
  const hasMineView = fulfilmentAssetIds.length > 0;
  const canOversee = scopes.some((s) => s.kind === "ALL");
  return { hasFulfilmentView: hasMineView || canOversee, hasMineView, canOversee };
}

export const TASK_ACTION_LABELS: Record<TaskAction, string> = {
  GRANT: "Accorder",
  CHANGE_LEVEL: "Changer de niveau",
  RENEW: "Renouveler",
  REVOKE: "Retirer",
  EXPIRY_REMOVAL: "Retirer — fin de période",
};

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  READY: "À réclamer",
  CLAIMED: "En cours",
  BLOCKED: "Bloquée",
  COMPLETED: "Exécutée",
  CANCELLED: "Annulée",
};

/** Référence courte affichée sur la carte (« EX-XXXXXX »). */
export function shortTaskReference(taskId: string): string {
  return `EX-${taskId.slice(-6).toUpperCase()}`;
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-fulfilment.test.ts`
Expected: PASS (42 tests).

- [ ] **Step 5: Écrire les tests des schémas Zod**

```ts
// tests/unit/access-fulfilment-validation.test.ts
import { describe, it, expect } from "vitest";
import {
  blockTaskSchema,
  claimBatchSchema,
  completeBatchSchema,
  completeTaskSchema,
  handoverTaskSchema,
  reconcileTaskSchema,
  taskListQuerySchema,
  taskRevisionSchema,
} from "@/lib/validations/access";

const nowIso = () => new Date().toISOString();

describe("completeTaskSchema", () => {
  it("accepte une date passée avec une référence, convertit en Date, partialRemovalOnly=false par défaut", () => {
    const r = completeTaskSchema.safeParse({ completedAt: nowIso(), reference: " TICKET-42 ", expectedRevision: 2 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.completedAt).toBeInstanceOf(Date);
    expect(r.data.reference).toBe("TICKET-42");
    expect(r.data.note).toBeNull();
    expect(r.data.partialRemovalOnly).toBe(false);
  });

  it("refuse ni référence ni note, y compris des espaces seuls (Review Focus #5)", () => {
    const r = completeTaskSchema.safeParse({ completedAt: nowIso(), reference: "   ", note: "  ", expectedRevision: 1 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0].message).toBe("Une référence ou une note d'exécution est obligatoire");
  });

  it("refuse une date à plus de 5 minutes dans le futur (Review Focus #5)", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(completeTaskSchema.safeParse({ completedAt: future, note: "fait", expectedRevision: 1 }).success).toBe(false);
  });

  it("refuse une date non ISO, une révision < 1, une méthode inconnue, des textes trop longs", () => {
    expect(completeTaskSchema.safeParse({ completedAt: "hier", note: "x", expectedRevision: 1 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), note: "x", expectedRevision: 0 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), note: "x", method: "AUTRE", expectedRevision: 1 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), reference: "r".repeat(201), expectedRevision: 1 }).success).toBe(false);
    expect(completeTaskSchema.safeParse({ completedAt: nowIso(), note: "n".repeat(2001), expectedRevision: 1 }).success).toBe(false);
  });
});

describe("motifs (passation, blocage, réconciliation)", () => {
  it("motif de 3 à 1000 caractères après trim", () => {
    expect(handoverTaskSchema.safeParse({ toUserId: "u", reason: "  ab ", expectedRevision: 1 }).success).toBe(false);
    expect(handoverTaskSchema.safeParse({ toUserId: "u", reason: "congés", expectedRevision: 1 }).success).toBe(true);
    expect(blockTaskSchema.safeParse({ reason: "x".repeat(1001), expectedRevision: 1 }).success).toBe(false);
    expect(reconcileTaskSchema.safeParse({ reason: "rien fait", expectedRevision: 1 }).success).toBe(true);
  });
  it("les faits d'un blocage sont optionnels ; vide → null", () => {
    const r = blockTaskSchema.safeParse({ reason: "compte verrouillé", facts: "", expectedRevision: 1 });
    expect(r.success && r.data.facts).toBeNull();
  });
  it("expectedRevision obligatoire", () => {
    expect(taskRevisionSchema.safeParse({}).success).toBe(false);
  });
});

describe("lots", () => {
  it("1 à 100 éléments", () => {
    expect(claimBatchSchema.safeParse({ items: [] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({ taskId: `t${i}`, expectedRevision: 1 }));
    expect(claimBatchSchema.safeParse({ items: many }).success).toBe(false);
    expect(claimBatchSchema.safeParse({ items: many.slice(0, 100) }).success).toBe(true);
  });
  it("chaque élément de confirmation porte sa propre preuve", () => {
    const ok = { taskId: "t1", completedAt: nowIso(), reference: "R1", expectedRevision: 2 };
    const missing = { taskId: "t2", completedAt: nowIso(), expectedRevision: 2 };
    expect(completeBatchSchema.safeParse({ items: [ok] }).success).toBe(true);
    expect(completeBatchSchema.safeParse({ items: [ok, missing] }).success).toBe(false);
  });
});

describe("taskListQuerySchema", () => {
  it("valeurs par défaut et assetId vide = pas de filtre", () => {
    const r = taskListQuerySchema.parse({ assetId: "" });
    expect(r).toEqual({ view: "mine", state: "open", assetId: undefined, page: 1, pageSize: 25 });
  });
  it("refuse une vue inconnue", () => {
    expect(taskListQuerySchema.safeParse({ view: "tout" }).success).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/access-fulfilment-validation.test.ts`
Expected: FAIL — exports absents de `@/lib/validations/access`.

- [ ] **Step 6: Ajouter les schémas à la fin de `lib/validations/access.ts`**

```ts

// ── Exécution des demandes (phase 3b) ────────────────────────────────────
// Corps des routes /api/access/tasks/**. Les contrôles qui exigent la base
// (date ≥ prise en charge − 1 jour, méthode requise pour un changement de
// niveau) restent dans le service (validateCompletionInput, completeTask).
const expectedRevision = z.number().int().min(1);
const taskReason = z.string().trim().min(3).max(1000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const completedAtField = z
  .string()
  .datetime()
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, {
    message: "La date d'exécution ne peut pas être dans le futur",
  });

const EVIDENCE_REQUIRED = "Une référence ou une note d'exécution est obligatoire";
const hasEvidence = (b: { reference: string | null; note: string | null }) => b.reference !== null || b.note !== null;

const completionFields = z.object({
  completedAt: completedAtField,
  reference: optionalText(200),
  note: optionalText(2000),
  method: z.enum(["DIRECT", "REMOVE_THEN_GRANT"]).optional(),
  expectedRevision,
});

export const taskRevisionSchema = z.object({ expectedRevision });

export const handoverTaskSchema = z.object({
  toUserId: z.string().min(1).max(64),
  reason: taskReason,
  expectedRevision,
});

export const blockTaskSchema = z.object({
  reason: taskReason,
  facts: optionalText(2000),
  expectedRevision,
});

export const reconcileTaskSchema = z.object({ reason: taskReason, expectedRevision });

export const completeTaskSchema = completionFields
  .extend({ partialRemovalOnly: z.boolean().default(false) })
  .refine(hasEvidence, { message: EVIDENCE_REQUIRED, path: ["reference"] });

export const claimBatchSchema = z.object({
  items: z
    .array(z.object({ taskId: z.string().min(1).max(64), expectedRevision }))
    .min(1)
    .max(100),
});

export const completeBatchSchema = z.object({
  items: z
    .array(
      completionFields
        .extend({ taskId: z.string().min(1).max(64) })
        .refine(hasEvidence, { message: EVIDENCE_REQUIRED, path: ["reference"] })
    )
    .min(1)
    .max(100),
});

export const taskListQuerySchema = z.object({
  view: z.enum(["mine", "oversight"]).default("mine"),
  state: z.enum(["open", "history"]).default("open"),
  assetId: optionalId,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CompleteTaskBody = z.infer<typeof completeTaskSchema>;
export type TaskListQueryInput = z.infer<typeof taskListQuerySchema>;
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run tests/unit/access-fulfilment.test.ts tests/unit/access-fulfilment-validation.test.ts && npx tsc --noEmit`
Expected: PASS (42 + 11 tests), aucune erreur de type.

- [ ] **Step 8: Commit**

```bash
git add lib/access/fulfilment.ts lib/validations/access.ts tests/unit/access-fulfilment.test.ts tests/unit/access-fulfilment-validation.test.ts
git commit -m "feat(access): logique pure de l'exécution — états des tâches, effets sur l'affectation, schémas Zod" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3 : Fondations serveur — erreurs, périmètre d'exécution, libération et annulation d'une tâche READY

**Files:**
- Create: `lib/access/fulfilment-server.ts`
- Create: `tests/unit/access-db/fulfilment-fixtures.ts`
- Test: `tests/unit/access-db/fulfilment-server.test.ts`

**Interfaces:**
- Consumes: `taskActionForKind`, `TaskOutcome` (Tâche 2) ; `recordAuditInTx(tx, input)` (`lib/access/audit-server.ts`) ; `isAvailable({ userId, isActive, lifecycle })` (`lib/access/roles.ts`) ; `submitRequest`, `decideStage`, `RequestVersionDTO` (`lib/access/requests-server.ts`, pour les fixtures).
- Produces (`lib/access/fulfilment-server.ts`) :
  - `type DbClient = Prisma.TransactionClient | typeof prisma`
  - `type FulfilmentErrorCode = "NOT_FOUND" | "STALE" | "INVALID_TRANSITION" | "VALIDATION"` ; `class FulfilmentError extends Error { readonly code }` ; `fulfilmentErrorStatus(code): 400 | 404 | 409`
  - `SYSTEM_ACTOR = "SYSTEM"`
  - `getFulfilmentAssetIds(client: DbClient, orgId: string, userId: string): Promise<string[]>`
  - `releaseTaskInTx(tx, { orgId, actorId, version, request, correlationId? }): Promise<{ taskId: string; created: boolean }>` — `version` : `Pick<AccessRequestVersion, "id" | "kind" | "targetLevelId" | "periodStart" | "periodEnd" | "assignmentVersion">`, `request` : `Pick<AccessRequest, "id" | "beneficiaryId" | "assetId">`. (Écart assumé avec la spec §6 : pas de paramètre `assignment`, la fonction lit l'affectation elle-même dans `tx`.)
  - `cancelReadyTaskForVersionInTx(tx, { orgId, actorId, versionId, reason, outcome }): Promise<boolean>`
- Produces (`tests/unit/access-db/fulfilment-fixtures.ts`) : `FulfilmentFixture`, `createFulfilmentFixture(tag)`, `cleanupFulfilmentFixture(orgId)`, `newEmployee(fx, label)`, `giveAccess(fx, userId, levelId, { periodEnd?, assetId? })`, `approvedSelfRequest(fx, beneficiaryId, levelId, { periodEnd?, periodStart? })`, `approvedReduction(fx, beneficiaryId, targetLevelId)`, `taskForVersion(versionId)`, `currentAssignment(fx, userId, assetId?)`.

- [ ] **Step 1: Créer le jeu de données partagé**

```ts
// tests/unit/access-db/fulfilment-fixtures.ts
// Jeu de données partagé par les tests base réelle de la phase 3b
// (fulfilment-server, access-processor, routes). Pas un fichier *.test.ts :
// vitest ne l'exécute pas seul.
import { prisma } from "@/lib/prisma";
import { submitRequest, decideStage, type RequestVersionDTO } from "@/lib/access/requests-server";

export interface FulfilmentFixture {
  orgId: string;
  departmentId: string;
  assetId: string;
  levels: { reader: string; editor: string };
  users: {
    owner: string;
    backup: string;
    stranger: string;
    employee: string;
    deptHead: string;
    ciso: string;
    coo: string;
  };
  stamp: string;
}

export async function createFulfilmentFixture(tag: string): Promise<FulfilmentFixture> {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const org = await prisma.organization.create({ data: { name: `Test Exécution ${tag}`, slug: `test-fulfil-${stamp}` } });
  const orgId = org.id;
  const mk = async (label: string) =>
    (await prisma.user.create({ data: { orgId, email: `${label.toLowerCase()}-${stamp}@example.com`, name: label, role: "PO" } })).id;
  const users = {
    owner: await mk("Owner"),
    backup: await mk("Backup"),
    stranger: await mk("Stranger"),
    employee: await mk("Employee"),
    deptHead: await mk("DeptHead"),
    ciso: await mk("Ciso"),
    coo: await mk("Coo"),
  };
  const dept = await prisma.department.create({
    data: { orgId, code: "DF", name: `Dept ${tag}`, color: "#000000", ownerId: users.deptHead },
  });
  await prisma.accessProfile.createMany({
    data: Object.values(users).map((userId) => ({
      orgId,
      userId,
      lifecycle: "ACTIVE" as const,
      primaryDepartmentId: userId === users.employee ? dept.id : null,
    })),
  });
  await prisma.accessRoleAssignment.createMany({
    data: [
      { orgId, role: "CISO", userId: users.ciso },
      { orgId, role: "COO", userId: users.coo },
    ],
  });
  const asset = await prisma.accessAsset.create({
    data: { orgId, name: `Asset ${tag}`, requestsEnabled: true, ownerId: users.owner, backupOwnerId: users.backup },
  });
  const reader = await prisma.accessLevel.create({ data: { assetId: asset.id, name: "Reader", priority: 1, isAdmin: false } });
  const editor = await prisma.accessLevel.create({ data: { assetId: asset.id, name: "Editor", priority: 5, isAdmin: false } });
  return {
    orgId,
    departmentId: dept.id,
    assetId: asset.id,
    levels: { reader: reader.id, editor: editor.id },
    users,
    stamp,
  };
}

/** Nouvel employé ACTIF du département de la fixture (un couple employé/actif libre). */
export async function newEmployee(fx: FulfilmentFixture, label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { orgId: fx.orgId, email: `${label.toLowerCase()}-${fx.stamp}-${Math.random().toString(36).slice(2, 7)}@example.com`, name: label, role: "PO" },
  });
  await prisma.accessProfile.create({
    data: { orgId: fx.orgId, userId: user.id, lifecycle: "ACTIVE", primaryDepartmentId: fx.departmentId },
  });
  return user.id;
}

export function giveAccess(
  fx: FulfilmentFixture,
  userId: string,
  levelId: string,
  opts: { periodEnd?: Date | null; assetId?: string } = {}
) {
  return prisma.accessAssignment.create({
    data: {
      orgId: fx.orgId,
      userId,
      assetId: opts.assetId ?? fx.assetId,
      levelId,
      status: "ACTIVE",
      periodStart: new Date(Date.now() - 30 * 86_400_000),
      periodEnd: opts.periodEnd ?? null,
    },
  });
}

/** Octroi/montée/renouvellement soumis par le bénéficiaire, approuvé chef → CISO. */
export async function approvedSelfRequest(
  fx: FulfilmentFixture,
  beneficiaryId: string,
  levelId: string,
  opts: { periodEnd?: Date | null; periodStart?: Date } = {}
): Promise<RequestVersionDTO> {
  const v = await submitRequest(fx.orgId, beneficiaryId, {
    beneficiaryId,
    assetId: fx.assetId,
    targetLevelId: levelId,
    justification: "besoin métier",
    periodEnd: opts.periodEnd ?? null,
    ...(opts.periodStart ? { periodStart: opts.periodStart } : {}),
  });
  const afterHead = await decideStage(fx.orgId, fx.users.deptHead, v.stages[0].id, "APPROVE", null);
  return decideStage(fx.orgId, fx.users.ciso, afterHead.stages[1].id, "APPROVE", null);
}

/** Réduction/révocation initiée par le chef de département, approuvée par le CISO. */
export async function approvedReduction(
  fx: FulfilmentFixture,
  beneficiaryId: string,
  targetLevelId: string | null
): Promise<RequestVersionDTO> {
  const v = await submitRequest(fx.orgId, fx.users.deptHead, {
    beneficiaryId,
    assetId: fx.assetId,
    targetLevelId,
    justification: "réduction décidée",
  });
  return decideStage(fx.orgId, fx.users.ciso, v.stages[0].id, "APPROVE", null);
}

export function taskForVersion(versionId: string) {
  return prisma.accessFulfilmentTask.findFirstOrThrow({ where: { requestVersionId: versionId } });
}

export function currentAssignment(fx: FulfilmentFixture, userId: string, assetId = fx.assetId) {
  return prisma.accessAssignment.findFirst({ where: { orgId: fx.orgId, userId, assetId } });
}

export async function cleanupFulfilmentFixture(orgId: string): Promise<void> {
  await prisma.accessTaskEvent.deleteMany({ where: { orgId } });
  await prisma.accessFulfilmentTask.deleteMany({ where: { orgId } });
  await prisma.accessApprovalStage.deleteMany({ where: { requestVersion: { request: { orgId } } } });
  await prisma.accessRequestVersion.deleteMany({ where: { request: { orgId } } });
  await prisma.accessRequest.deleteMany({ where: { orgId } });
  await prisma.accessAssignmentEvent.deleteMany({ where: { orgId } });
  await prisma.accessAssignment.deleteMany({ where: { orgId } });
  await prisma.accessAuditEvent.deleteMany({ where: { orgId } });
  await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
  await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
  await prisma.accessAsset.deleteMany({ where: { orgId } });
  await prisma.accessProfile.deleteMany({ where: { orgId } });
  await prisma.department.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}
```

- [ ] **Step 2: Écrire le test**

```ts
// tests/unit/access-db/fulfilment-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  cancelReadyTaskForVersionInTx,
  getFulfilmentAssetIds,
  releaseTaskInTx,
} from "@/lib/access/fulfilment-server";
import {
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  giveAccess,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

async function readyVersionRow(
  fx: FulfilmentFixture,
  beneficiaryId: string,
  targetLevelId: string | null,
  kind: "GRANT" | "UPGRADE" | "REVOKE",
  assignmentVersion: number
) {
  const request = await prisma.accessRequest.create({ data: { orgId: fx.orgId, beneficiaryId, assetId: fx.assetId } });
  const version = await prisma.accessRequestVersion.create({
    data: {
      requestId: request.id,
      versionNumber: 1,
      kind,
      initiatorId: beneficiaryId,
      targetLevelId,
      justification: "fondations",
      periodStart: new Date(),
      departmentSnapshot: fx.departmentId,
      assignmentVersion,
      catalogueVersion: 1,
      state: "READY_FOR_FULFILMENT",
    },
  });
  return { request, version };
}

describe("fulfilment-server — fondations (périmètre, libération, annulation READY)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("fondations");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("getFulfilmentAssetIds : propriétaire et suppléant, actifs archivés COMPRIS ; tiers → aucun", async () => {
    const archived = await prisma.accessAsset.create({
      data: { orgId: fx.orgId, name: "Archivé", ownerId: fx.users.owner, archivedAt: new Date() },
    });
    expect((await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.owner)).sort()).toEqual([fx.assetId, archived.id].sort());
    expect(await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.backup)).toEqual([fx.assetId]);
    expect(await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.stranger)).toEqual([]);
    await prisma.accessAsset.delete({ where: { id: archived.id } });
  });

  it("getFulfilmentAssetIds : un propriétaire parti (indisponible) n'a plus aucun actif d'exécution", async () => {
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "DEPARTED" } });
    expect(await getFulfilmentAssetIds(prisma, fx.orgId, fx.users.backup)).toEqual([]);
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "ACTIVE" } });
  });

  it("releaseTaskInTx : crée UNE tâche READY (clé REQ:<versionId>), idempotent au rejeu, avec événement et audit", async () => {
    const assignment = await giveAccess(fx, fx.users.employee, fx.levels.reader);
    const { request, version } = await readyVersionRow(fx, fx.users.employee, fx.levels.editor, "UPGRADE", assignment.version);

    const first = await prisma.$transaction((tx) =>
      releaseTaskInTx(tx, { orgId: fx.orgId, actorId: fx.users.ciso, version, request })
    );
    const second = await prisma.$transaction((tx) =>
      releaseTaskInTx(tx, { orgId: fx.orgId, actorId: fx.users.ciso, version, request })
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ taskId: first.taskId, created: false });

    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: first.taskId } });
    expect(task).toMatchObject({
      state: "READY",
      action: "CHANGE_LEVEL",
      idempotencyKey: `REQ:${version.id}`,
      fromLevelId: fx.levels.reader,
      toLevelId: fx.levels.editor,
      expectedAssignmentVersion: assignment.version,
      beneficiaryId: fx.users.employee,
      assetId: fx.assetId,
    });
    expect(await prisma.accessTaskEvent.count({ where: { taskId: task.id, type: "RELEASED" } })).toBe(1);
    expect(
      await prisma.accessAuditEvent.count({ where: { orgId: fx.orgId, eventType: "TASK_RELEASED", objectId: task.id } })
    ).toBe(1);

    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });

  it("cancelReadyTaskForVersionInTx : READY → CANCELLED une seule fois ; false sans tâche READY", async () => {
    const { request, version } = await readyVersionRow(fx, fx.users.stranger, fx.levels.reader, "GRANT", 0);
    const { taskId } = await prisma.$transaction((tx) =>
      releaseTaskInTx(tx, { orgId: fx.orgId, actorId: fx.users.ciso, version, request })
    );
    const input = { orgId: fx.orgId, actorId: fx.users.stranger, versionId: version.id, reason: "annulée", outcome: "NOT_PERFORMED" as const };
    expect(await prisma.$transaction((tx) => cancelReadyTaskForVersionInTx(tx, input))).toBe(true);
    expect(await prisma.$transaction((tx) => cancelReadyTaskForVersionInTx(tx, input))).toBe(false);
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("CANCELLED");
    expect(task.outcome).toBe("NOT_PERFORMED");
    await prisma.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts`
Expected: FAIL — module `@/lib/access/fulfilment-server` introuvable.

- [ ] **Step 4: Créer `lib/access/fulfilment-server.ts`**

```ts
// lib/access/fulfilment-server.ts
// Exécution des demandes (phase 3b) — tâches d'exécution : libération,
// périmètre, revérification et mutations (réclamer, passer la main, bloquer,
// reprendre, confirmer, réconcilier, lots).
//
// Discipline de concurrence (D-20, même idiome que requests-server.ts) :
// toutes les lectures ET écritures d'une action se font dans UNE transaction
// Read Committed ; les écritures sont des `updateMany` conditionnels (état +
// révision) dont la clause WHERE est ré-évaluée par Postgres après le commit
// d'une transaction concurrente. Ordre de verrouillage IDENTIQUE partout pour
// éviter les interblocages : version de demande → tâche → tâche d'expiration
// supplantée → affectation.
import type { AccessRequest, AccessRequestVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { isAvailable } from "./roles";
import { taskActionForKind, type TaskOutcome } from "./fulfilment";

export type DbClient = Prisma.TransactionClient | typeof prisma;

export type FulfilmentErrorCode = "NOT_FOUND" | "STALE" | "INVALID_TRANSITION" | "VALIDATION";

/** Erreur typée (D-8) : NOT_FOUND → 404, STALE/INVALID_TRANSITION → 409, VALIDATION → 400. */
export class FulfilmentError extends Error {
  readonly code: FulfilmentErrorCode;
  constructor(code: FulfilmentErrorCode, message: string) {
    super(message);
    this.name = "FulfilmentError";
    this.code = code;
  }
}

export function fulfilmentErrorStatus(code: FulfilmentErrorCode): 400 | 404 | 409 {
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION") return 400;
  return 409;
}

/** Acteur du processeur 5 minutes dans l'audit (colonne sans FK, D-11). */
export const SYSTEM_ACTOR = "SYSTEM";

async function isUserAvailable(client: DbClient, orgId: string, userId: string): Promise<boolean> {
  const [user, profile] = await Promise.all([
    client.user.findFirst({ where: { id: userId, orgId }, select: { isActive: true } }),
    client.accessProfile.findUnique({ where: { userId }, select: { lifecycle: true } }),
  ]);
  return !!user && isAvailable({ userId, isActive: user.isActive, lifecycle: profile?.lifecycle ?? null });
}

/**
 * Actifs sur lesquels l'utilisateur exécute (D-5) : propriétaire OU suppléant,
 * archivés COMPRIS (le retrait doit rester possible, FP:110), lecteur
 * disponible exigé. Distinct de `getOwnedAssetIds` (registre, non archivés).
 * Accepte un `tx` pour les revérifications transactionnelles.
 */
export async function getFulfilmentAssetIds(client: DbClient, orgId: string, userId: string): Promise<string[]> {
  if (!(await isUserAvailable(client, orgId, userId))) return [];
  const assets = await client.accessAsset.findMany({
    where: { orgId, OR: [{ ownerId: userId }, { backupOwnerId: userId }] },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return assets.map((a) => a.id);
}

export interface ReleaseTaskInput {
  orgId: string;
  /** Utilisateur à l'origine du passage à READY_FOR_FULFILMENT, ou SYSTEM_ACTOR. */
  actorId: string;
  version: Pick<
    AccessRequestVersion,
    "id" | "kind" | "targetLevelId" | "periodStart" | "periodEnd" | "assignmentVersion"
  >;
  request: Pick<AccessRequest, "id" | "beneficiaryId" | "assetId">;
  correlationId?: string | null;
}

/**
 * Libère la tâche d'exécution d'une version autorisée (D-2), dans la
 * transaction de l'appelant. Idempotent : la clé `REQ:<versionId>` est
 * unique et l'insertion est un `INSERT … ON CONFLICT DO NOTHING`
 * (`skipDuplicates`) — une violation d'unicité avorterait la transaction
 * Postgres de l'appelant, un try/catch ne suffirait pas.
 */
export async function releaseTaskInTx(
  tx: Prisma.TransactionClient,
  input: ReleaseTaskInput
): Promise<{ taskId: string; created: boolean }> {
  const { orgId, version, request } = input;
  const idempotencyKey = `REQ:${version.id}`;
  const assignment = await tx.accessAssignment.findFirst({
    where: { orgId, userId: request.beneficiaryId, assetId: request.assetId },
    select: { levelId: true },
  });
  const action = taskActionForKind(version.kind);
  const { count } = await tx.accessFulfilmentTask.createMany({
    data: [
      {
        orgId,
        assetId: request.assetId,
        beneficiaryId: request.beneficiaryId,
        action,
        requestVersionId: version.id,
        fromLevelId: assignment?.levelId ?? null,
        toLevelId: version.targetLevelId,
        periodStart: version.periodStart,
        periodEnd: version.periodEnd,
        // Instantané approuvé : si l'affectation a bougé depuis, la
        // confirmation sera refusée (D-9) au lieu de s'appliquer à l'aveugle.
        expectedAssignmentVersion: version.assignmentVersion,
        idempotencyKey,
      },
    ],
    skipDuplicates: true,
  });
  const task = await tx.accessFulfilmentTask.findUniqueOrThrow({ where: { idempotencyKey }, select: { id: true } });
  if (count === 1) {
    const isSystem = input.actorId === SYSTEM_ACTOR;
    await tx.accessTaskEvent.create({
      data: {
        orgId,
        taskId: task.id,
        type: "RELEASED",
        actorId: isSystem ? null : input.actorId,
        actingAs: isSystem ? "SYSTEM" : null,
      },
    });
    await recordAuditInTx(tx, {
      orgId,
      actorId: input.actorId,
      actorRole: null,
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: request.assetId,
      eventType: "TASK_RELEASED",
      objectType: "AccessFulfilmentTask",
      objectId: task.id,
      objectVersion: 1,
      beneficiaryId: request.beneficiaryId,
      before: null,
      after: { action, state: "READY", requestVersionId: version.id, idempotencyKey },
      reason: null,
      outcome: "SUCCESS",
      correlationId: input.correlationId ?? null,
    });
  }
  return { taskId: task.id, created: count === 1 };
}

/**
 * Annule la tâche READY d'une version (annulation avant réclamation, D-19).
 * Renvoie false s'il n'y en a pas (version prête avant la phase 3b, que le
 * processeur n'a pas encore réparée).
 */
export async function cancelReadyTaskForVersionInTx(
  tx: Prisma.TransactionClient,
  input: { orgId: string; actorId: string; versionId: string; reason: string; outcome: TaskOutcome }
): Promise<boolean> {
  const task = await tx.accessFulfilmentTask.findFirst({
    where: { orgId: input.orgId, requestVersionId: input.versionId, state: "READY" },
    select: { id: true, revision: true, assetId: true, beneficiaryId: true },
  });
  if (!task) return false;
  const { count } = await tx.accessFulfilmentTask.updateMany({
    where: { id: task.id, state: "READY" },
    data: { state: "CANCELLED", outcome: input.outcome, revision: { increment: 1 } },
  });
  if (count === 0) return false;
  const isSystem = input.actorId === SYSTEM_ACTOR;
  await tx.accessTaskEvent.create({
    data: {
      orgId: input.orgId,
      taskId: task.id,
      type: "CANCELLED",
      actorId: isSystem ? null : input.actorId,
      actingAs: isSystem ? "SYSTEM" : null,
      reason: input.reason,
    },
  });
  await recordAuditInTx(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    actorRole: null,
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: task.assetId,
    eventType: "TASK_CANCELLED",
    objectType: "AccessFulfilmentTask",
    objectId: task.id,
    objectVersion: task.revision + 1,
    beneficiaryId: task.beneficiaryId,
    before: { state: "READY" },
    after: { state: "CANCELLED", outcome: input.outcome },
    reason: input.reason,
    outcome: "SUCCESS",
    correlationId: null,
  });
  return true;
}
```

- [ ] **Step 5: Vérifier**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add lib/access/fulfilment-server.ts tests/unit/access-db/fulfilment-fixtures.ts tests/unit/access-db/fulfilment-server.test.ts
git commit -m "feat(access): fondations de l'exécution — périmètre, libération et annulation d'une tâche" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4 : Modifications 3a — libération aux 3 sites, fermeture au lieu de suppression, annulation sensible à l'exécution

**Files:**
- Modify: `lib/access/requests-server.ts` (`submitRequest`, `decideStage`, `reviseRequest`, `cancelRequest`, suppression de `isRecordNotFoundError`)
- Test: `tests/unit/access-db/requests-server.test.ts`

**Interfaces:**
- Consumes: `releaseTaskInTx`, `cancelReadyTaskForVersionInTx` (Tâche 3) ; fixtures (Tâche 3).
- Produces: `cancelRequest(orgId, actorId, requestId): Promise<CancelOutcome>` avec `type CancelOutcome = "CANCELLED" | "CANCEL_REQUESTED"` (auparavant `Promise<void>` ; la route `POST /api/access/requests/[requestId]/cancel` reste en 204 et n'est pas modifiée). Une version `READY_FOR_FULFILMENT` a désormais toujours sa tâche `READY` créée dans la même transaction. Rejet et annulation ferment la demande (`closedAt`), ils ne la suppriment plus.

Deux tests 3a existants vérifiaient la **suppression** de la demande (rejet, annulation). Ce comportement contredisait FP:92/352 (historique conservé) et est corrigé par D-4 : leurs assertions sont adaptées, pas supprimées. Tous les autres tests 3a doivent rester verts sans modification de leurs assertions.

- [ ] **Step 1: Adapter les deux tests 3a et ajouter les tests 3b**

Dans `tests/unit/access-db/requests-server.test.ts` :

(a) ajouter après l'import de `@/lib/access/requests-server` :

```ts
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";
```

(b) dans le test « le titulaire COO demandant son propre accès… », ajouter après `expect(version.state).toBe("READY_FOR_FULFILMENT");` :

```ts
    // Phase 3b : la tâche d'exécution est libérée dans la même transaction.
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: version.id, state: "READY" } })).toBe(1);
```

(c) dans le test « le CISO approuve la dernière étape… », ajouter avant `await cleanup(updated);` :

```ts
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: updated.id, state: "READY" } })).toBe(1);
```

(d) remplacer entièrement le test « REJECT à n'importe quelle étape termine la demande, AccessRequest supprimé » par :

```ts
  // Phase 3b (D-4) : ce test vérifiait la SUPPRESSION de la demande au rejet
  // (cascade qui effaçait versions et étapes, contraire à FP:92/352). La
  // demande est désormais fermée (`closedAt`) et son historique conservé.
  it("REJECT à n'importe quelle étape termine la demande : fermée, historique conservé", async () => {
    const v = await freshRequest();
    const updated = await decideStage(orgId, deptHeadId, v.stages[0].id, "REJECT", "motif de rejet");
    expect(updated.state).toBe("REJECTED");
    const request = await prisma.accessRequest.findUniqueOrThrow({ where: { id: v.requestId } });
    expect(request.closedAt).not.toBeNull();
    const kept = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: v.id }, include: { stages: true } });
    expect(kept.state).toBe("REJECTED");
    expect(kept.stages.find((s) => s.sequence === 1)?.reason).toBe("motif de rejet");
    await cleanup(updated);
  });
```

(e) remplacer entièrement le test « l'initiateur peut annuler tant que la demande n'est pas terminale » par :

```ts
  // Phase 3b (D-4, D-19) : ce test vérifiait la suppression de la demande à
  // l'annulation. Elle est désormais fermée, la version reste CANCELLED.
  it("l'initiateur peut annuler tant que la demande n'est pas terminale : fermée, historique conservé", async () => {
    const v = await submitRequest(orgId, employeeId, {
      beneficiaryId: employeeId, assetId, targetLevelId: levelReaderId, justification: "à annuler",
    });
    expect(await cancelRequest(orgId, employeeId, v.requestId)).toBe("CANCELLED");
    const request = await prisma.accessRequest.findUniqueOrThrow({ where: { id: v.requestId } });
    expect(request.closedAt).not.toBeNull();
    const kept = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: v.id } });
    expect(kept.state).toBe("CANCELLED");
    await expect(cancelRequest(orgId, employeeId, v.requestId)).rejects.toThrow(/déjà clôturée/);
    await cleanup(v.requestId);
  });
```

(f) ajouter à la fin du fichier :

```ts

describe("requests-server — passage à l'exécution (phase 3b : libération, fermeture, annulation)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("req3b");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("dernière approbation (decideStage) : tâche READY libérée dans la même transaction, audit TASK_RELEASED par l'approbateur", async () => {
    const emp = await newEmployee(fx, "Rel1");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    expect(final.state).toBe("READY_FOR_FULFILMENT");
    const task = await taskForVersion(final.id);
    expect(task).toMatchObject({ state: "READY", action: "GRANT", idempotencyKey: `REQ:${final.id}`, expectedAssignmentVersion: 0 });
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_RELEASED", objectId: task.id } });
    expect(audit.actorId).toBe(fx.users.ciso);
  });

  it("exception COO à la soumission : tâche libérée ; aucune tâche tant que la demande est en attente", async () => {
    const pending = await submitRequest(fx.orgId, fx.users.employee, {
      beneficiaryId: fx.users.employee, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "attente",
    });
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: pending.id } })).toBe(0);
    await cancelRequest(fx.orgId, fx.users.employee, pending.requestId);

    const coo = await submitRequest(fx.orgId, fx.users.coo, {
      beneficiaryId: fx.users.coo, assetId: fx.assetId, targetLevelId: fx.levels.editor, justification: "COO",
    });
    expect((await taskForVersion(coo.id)).state).toBe("READY");
  });

  it("révision sans étape (l'initiateur est devenu COO titulaire) : tâche libérée", async () => {
    const emp = await newEmployee(fx, "Rel3");
    const v = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "initial",
    });
    const returned = await decideStage(fx.orgId, fx.users.deptHead, v.stages[0].id, "RETURN", "revoir");
    await prisma.accessRoleAssignment.updateMany({ where: { orgId: fx.orgId, role: "COO" }, data: { userId: emp } });
    const revised = await reviseRequest(fx.orgId, emp, returned.id, { justification: "révisée" });
    await prisma.accessRoleAssignment.updateMany({ where: { orgId: fx.orgId, role: "COO" }, data: { userId: fx.users.coo } });
    expect(revised.state).toBe("READY_FOR_FULFILMENT");
    expect(revised.stages).toHaveLength(0);
    expect((await taskForVersion(revised.id)).state).toBe("READY");
  });

  it("début futur : AUTHORIZED_WAITING_START, AUCUNE tâche (le processeur la libérera)", async () => {
    const emp = await newEmployee(fx, "Rel4");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodStart: new Date(Date.now() + 7 * 86_400_000) });
    expect(final.state).toBe("AUTHORIZED_WAITING_START");
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: final.id } })).toBe(0);
  });

  it("annulation AVANT réclamation (READY) : version CANCELLED, tâche CANCELLED, demande fermée", async () => {
    const emp = await newEmployee(fx, "Cancel1");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    expect(await cancelRequest(fx.orgId, emp, final.requestId)).toBe("CANCELLED");
    const task = await taskForVersion(final.id);
    expect(task.state).toBe("CANCELLED");
    expect(task.outcome).toBe("NOT_PERFORMED");
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("CANCELLED");
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).not.toBeNull();
  });

  it("annulation APRÈS réclamation (IN_PROGRESS) : seulement « annulation demandée », tâche intacte, demande ouverte", async () => {
    const emp = await newEmployee(fx, "Cancel2");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    // Réclamation simulée (claimTask arrive en Tâche 6) : même effet en base.
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { state: "IN_PROGRESS" } });
    await prisma.accessFulfilmentTask.update({
      where: { id: task.id },
      data: { state: "CLAIMED", claimantId: fx.users.owner, claimedAt: new Date(), revision: 2 },
    });

    expect(await cancelRequest(fx.orgId, emp, final.requestId)).toBe("CANCEL_REQUESTED");
    const version = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } });
    expect(version.state).toBe("IN_PROGRESS");
    expect(version.cancelRequestedAt).not.toBeNull();
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } })).state).toBe("CLAIMED");
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).toBeNull();
    expect(
      await prisma.accessAuditEvent.count({ where: { orgId: fx.orgId, eventType: "REQUEST_CANCEL_REQUESTED", objectId: final.id } })
    ).toBe(1);
    await expect(cancelRequest(fx.orgId, emp, final.requestId)).rejects.toThrow(/déjà été demandée/);
  });

  it("historique conservé après rejet ; le couple employé/actif est libre pour une nouvelle demande", async () => {
    const emp = await newEmployee(fx, "Hist");
    const v = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "première",
    });
    await decideStage(fx.orgId, fx.users.deptHead, v.stages[0].id, "REJECT", "non");
    const again = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "seconde",
    });
    expect(again.requestId).not.toBe(v.requestId);
    const all = await prisma.accessRequest.findMany({ where: { orgId: fx.orgId, beneficiaryId: emp }, include: { versions: true } });
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === v.requestId)?.versions[0].state).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-server.test.ts`
Expected: FAIL — les tests (b) à (f) échouent (aucune tâche libérée, demande supprimée au rejet/à l'annulation, `cancelRequest` renvoie `undefined`).

- [ ] **Step 3: Modifier `lib/access/requests-server.ts`**

(a) Après `import { recordAuditInTx } from "./audit-server";`, ajouter :

```ts
import { cancelReadyTaskForVersionInTx, releaseTaskInTx } from "./fulfilment-server";
```

(b) Dans `submitRequest`, entre la création de `version` (`const version = await tx.accessRequestVersion.create({ … });`) et l'appel `recordAuditInTx` « REQUEST_SUBMITTED », insérer :

```ts
      // Exception COO (aucune étape) : autorisée dès la soumission → la tâche
      // d'exécution est libérée dans la même transaction (phase 3b, D-2).
      if (initialState === "READY_FOR_FULFILMENT") {
        await releaseTaskInTx(tx, { orgId, actorId, version, request });
      }
```

(c) Dans `decideStage`, juste après le bloc `if (versionUpdateResult.count === 0) { throw … }`, insérer :

```ts
    // Dernière approbation : la tâche d'exécution est libérée dans la même
    // transaction (phase 3b, D-2). AUTHORIZED_WAITING_START n'a pas de tâche :
    // le processeur 5 minutes la libère à `periodStart`.
    if (newState === "READY_FOR_FULFILMENT") {
      await releaseTaskInTx(tx, { orgId, actorId, version, request });
    }
```

(d) Toujours dans `decideStage`, remplacer tout le bloc final — du commentaire `// ⚠️ Capturer le DTO final AVANT un éventuel REJECT …` jusqu'à `return finalVersion;` inclus — par :

```ts
    // Phase 3b (D-4) : un rejet FERME la demande (`closedAt`), il ne la
    // supprime plus — versions et étapes restent l'historique (FP:92/352) et
    // l'index partiel `one_open_request_per_pair` libère le couple
    // employé/actif pour une nouvelle demande.
    if (decision === "REJECT") {
      await tx.accessRequest.update({ where: { id: request.id }, data: { closedAt: new Date() } });
    }

    return tx.accessRequestVersion.findUnique({
      where: { id: version.id },
      include: { stages: true, request: true },
    });
```

(e) Dans `reviseRequest`, entre la création de `newVersion` et l'appel `recordAuditInTx` « REQUEST_REVISED », insérer :

```ts
      // Route recalculée sans étape (ex. l'initiateur est devenu COO
      // titulaire) : libération immédiate de la tâche (phase 3b, D-2).
      if (initialState === "READY_FOR_FULFILMENT") {
        await releaseTaskInTx(tx, { orgId, actorId, version: newVersion, request: oldVersion.request });
      }
```

(f) Supprimer la fonction `isRecordNotFoundError` (elle n'a plus d'appelant).

(g) Remplacer toute la fonction `cancelRequest` **et son commentaire JSDoc** par :

```ts
const PRE_CLAIM_STATES: AccessRequestState[] = [
  "PENDING_APPROVAL",
  "CLARIFICATION_REQUIRED",
  "REVISION_REQUIRED",
  "AUTHORIZED_WAITING_START",
  "READY_FOR_FULFILMENT",
];
const IN_FULFILMENT_STATES: AccessRequestState[] = ["IN_PROGRESS", "BLOCKED"];

export type CancelOutcome = "CANCELLED" | "CANCEL_REQUESTED";

/**
 * Annulation par l'initiateur, sensible à l'exécution (phase 3b, D-19,
 * FP:170) :
 * - avant réclamation (PENDING_APPROVAL … READY_FOR_FULFILMENT) : annulation
 *   effective — version CANCELLED, tâche READY éventuelle CANCELLED, demande
 *   FERMÉE (`closedAt`), jamais supprimée (D-4) ;
 * - après réclamation (IN_PROGRESS, BLOCKED) : seulement
 *   `cancelRequestedAt` + audit REQUEST_CANCEL_REQUESTED. Le propriétaire
 *   réconcilie (« aucune modification effectuée ») ou confirme factuellement.
 *
 * ⚠️ Même discipline que `decideStage` : lectures et écritures dans la
 * transaction, `updateMany` conditionnel sur l'état lu. La version est
 * verrouillée AVANT la tâche (même ordre que `claimTask`) : une annulation
 * et une réclamation concurrentes se sérialisent sur la ligne de version,
 * une seule gagne, sans interblocage.
 */
export async function cancelRequest(orgId: string, actorId: string, requestId: string): Promise<CancelOutcome> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.accessRequest.findFirst({
      where: { id: requestId, orgId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!request) throw new RequestError("Demande introuvable dans cette organisation");
    const currentVersion = request.versions[0];
    if (!currentVersion || currentVersion.initiatorId !== actorId) {
      throw new RequestError("Seul l'initiateur peut annuler cette demande");
    }
    if (request.closedAt !== null) {
      throw new RequestError("Cette demande est déjà clôturée");
    }

    if (IN_FULFILMENT_STATES.includes(currentVersion.state)) {
      if (currentVersion.cancelRequestedAt !== null) {
        throw new RequestError("L'annulation a déjà été demandée");
      }
      const flagged = await tx.accessRequestVersion.updateMany({
        where: { id: currentVersion.id, state: { in: IN_FULFILMENT_STATES }, cancelRequestedAt: null },
        data: { cancelRequestedAt: new Date(), revision: { increment: 1 } },
      });
      if (flagged.count === 0) {
        throw new RequestError("Cette demande a été modifiée entre-temps — annulation refusée");
      }
      await recordAuditInTx(tx, {
        orgId,
        actorId,
        actorRole: null,
        primaryCoveredId: request.beneficiaryId,
        scopeType: "ACCESS_REQUEST",
        scopeId: requestId,
        eventType: "REQUEST_CANCEL_REQUESTED",
        objectType: "AccessRequestVersion",
        objectId: currentVersion.id,
        objectVersion: currentVersion.versionNumber,
        beneficiaryId: request.beneficiaryId,
        before: { state: currentVersion.state },
        after: { state: currentVersion.state, cancelRequested: true },
        reason: null,
        outcome: "SUCCESS",
        correlationId: null,
      });
      return "CANCEL_REQUESTED";
    }

    if (!PRE_CLAIM_STATES.includes(currentVersion.state)) {
      throw new RequestError("Cette demande est déjà terminée");
    }

    const versionUpdateResult = await tx.accessRequestVersion.updateMany({
      where: { id: currentVersion.id, state: currentVersion.state },
      data: { state: "CANCELLED", revision: { increment: 1 } },
    });
    if (versionUpdateResult.count === 0) {
      throw new RequestError("Cette demande a été modifiée entre-temps — annulation refusée");
    }
    if (currentVersion.state === "READY_FOR_FULFILMENT") {
      await cancelReadyTaskForVersionInTx(tx, {
        orgId,
        actorId,
        versionId: currentVersion.id,
        reason: "Demande annulée par l'initiateur",
        outcome: "NOT_PERFORMED",
      });
    }
    await tx.accessRequest.update({ where: { id: requestId }, data: { closedAt: new Date() } });

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
    return "CANCELLED";
  });
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-db && npx tsc --noEmit`
Expected: PASS — `requests-server.test.ts` : 46 tests (39 existants dont 2 adaptés + 7 nouveaux) ; aucun autre fichier `access-db` ne régresse ; aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/requests-server.ts tests/unit/access-db/requests-server.test.ts
git commit -m "feat(access): demandes 3a — tâche libérée à l'autorisation, demande fermée au lieu de supprimée, annulation sensible à l'exécution" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5 : Lecture 3a — historique et suivi d'exécution dans « Mes demandes »

**Files:**
- Modify: `lib/access/requests-read-server.ts` (`RequestSummaryDTO`, `VersionForSummary`, `toSummaries`, `listMyRequests`)
- Test: `tests/unit/access-db/requests-read-server.test.ts`

**Interfaces:**
- Consumes: modèle `AccessFulfilmentTask` (Tâche 1) ; fixtures (Tâche 3).
- Produces: `RequestSummaryDTO` gagne `closed: boolean`, `outcome: string | null`, `completedAt: Date | null`, `cancelRequestedAt: Date | null`, `taskState: string | null`, `taskReason: string | null`. `listMyRequests(orgId, userId)` renvoie aussi les demandes terminées, plus récentes d'abord, filtrées en base par initiateur. `listMyApprovals` : comportement inchangé (mêmes champs en plus, à `null`/`false`).

D-4a : `listDepartmentReducibleAccess` ne lit aucune demande (seulement `AccessAssignment`) — rien à filtrer par `closedAt`, aucune modification.

- [ ] **Step 1: Écrire les tests**

Dans `tests/unit/access-db/requests-read-server.test.ts`, ajouter après l'import de `@/lib/access/requests-read-server` :

```ts
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";
```

et à la fin du fichier :

```ts

describe("requests-read-server — historique et suivi d'exécution (phase 3b)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("read3b");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("listMyRequests montre l'historique (rejetées comprises), plus récentes d'abord, sans les demandes initiées par d'autres", async () => {
    const emp = await newEmployee(fx, "Hist");
    const first = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "première",
    });
    await decideStage(fx.orgId, fx.users.deptHead, first.stages[0].id, "REJECT", "non");
    const second = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "seconde",
    });

    const mine = await listMyRequests(fx.orgId, emp);
    expect(mine.map((r) => r.versionId)).toEqual([second.id, first.id]);
    expect(mine[1]).toMatchObject({ state: "REJECTED", closed: true, taskState: null });
    expect(mine[0]).toMatchObject({ state: "PENDING_APPROVAL", closed: false });
    // Le chef de département n'a initié aucune de ces demandes.
    expect(await listMyRequests(fx.orgId, fx.users.deptHead)).toHaveLength(0);
  });

  it("une demande bloquée expose l'état de la tâche et le motif de blocage, jamais les faits internes", async () => {
    const emp = await newEmployee(fx, "Blocked");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { state: "BLOCKED" } });
    await prisma.accessFulfilmentTask.update({
      where: { id: task.id },
      data: { state: "BLOCKED", claimantId: fx.users.owner, blockedReason: "Compte fournisseur verrouillé" },
    });
    await prisma.accessTaskEvent.create({
      data: { orgId: fx.orgId, taskId: task.id, type: "BLOCKED", reason: "Compte fournisseur verrouillé", facts: { note: "mot de passe admin expiré" } },
    });

    const [row] = await listMyRequests(fx.orgId, emp);
    expect(row).toMatchObject({ state: "BLOCKED", taskState: "BLOCKED", taskReason: "Compte fournisseur verrouillé", closed: false });
    expect(JSON.stringify(row)).not.toContain("mot de passe admin expiré");
  });

  it("renvoi en révision par le processeur : le motif de la tâche annulée sert de motif de révision", async () => {
    const emp = await newEmployee(fx, "Overdue");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { state: "REVISION_REQUIRED" } });
    await prisma.accessFulfilmentTask.update({ where: { id: task.id }, data: { state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT" } });
    await prisma.accessTaskEvent.create({
      data: { orgId: fx.orgId, taskId: task.id, type: "CANCELLED", reason: "Fin de période dépassée avant exécution", actingAs: "SYSTEM" },
    });

    const [row] = await listMyRequests(fx.orgId, emp);
    expect(row).toMatchObject({
      state: "REVISION_REQUIRED",
      currentStageReason: "Fin de période dépassée avant exécution",
      taskState: "CANCELLED",
      closed: false,
    });
  });
});
```

(`submitRequest`, `decideStage`, `prisma` et les fonctions vitest sont déjà importés en tête de ce fichier.)

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/requests-read-server.test.ts`
Expected: FAIL — `closed`, `taskState`, `taskReason` absents ; ordre non garanti.

- [ ] **Step 3: Modifier `lib/access/requests-read-server.ts`**

(a) Dans `RequestSummaryDTO`, après le champ `currentStageReason: string | null;`, ajouter :

```ts
  /**
   * Phase 3b — suivi de l'exécution (D-14). `closed` : la demande est
   * terminée (rejet, annulation, exécution, réconciliation). `taskState` /
   * `taskReason` : état de la dernière tâche d'exécution de la version et
   * motif MÉTIER (motif de blocage, ou motif d'annulation d'une tâche) —
   * jamais les faits internes saisis par le propriétaire.
   */
  closed: boolean;
  outcome: string | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  taskState: string | null;
  taskReason: string | null;
```

(b) Dans `VersionForSummary`, remplacer la ligne `request: { beneficiaryId: string; assetId: string };` par :

```ts
  outcome: string | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  request: { beneficiaryId: string; assetId: string; closedAt: Date | null };
```

(c) Remplacer toute la fonction `toSummaries` par :

```ts
async function toSummaries(versions: VersionForSummary[]): Promise<RequestSummaryDTO[]> {
  const beneficiaryIds = [...new Set(versions.map((v) => v.request.beneficiaryId))];
  const assetIds = [...new Set(versions.map((v) => v.request.assetId))];
  const levelIds = [...new Set(versions.map((v) => v.targetLevelId).filter((id): id is string => id !== null))];
  const versionIds = versions.map((v) => v.id);

  const [users, assets, levels, tasks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: beneficiaryIds } }, select: { id: true, name: true } }),
    prisma.accessAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } }),
    levelIds.length
      ? prisma.accessLevel.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    versionIds.length
      ? prisma.accessFulfilmentTask.findMany({
          where: { requestVersionId: { in: versionIds } },
          orderBy: { releasedAt: "desc" },
          select: {
            requestVersionId: true,
            state: true,
            blockedReason: true,
            events: { where: { type: "CANCELLED" }, orderBy: { occurredAt: "desc" }, take: 1, select: { reason: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const assetNameById = new Map(assets.map((a) => [a.id, a.name]));
  const levelNameById = new Map(levels.map((l) => [l.id, l.name]));
  // Dernière tâche par version (tri releasedAt desc : la première rencontrée).
  const taskByVersionId = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) {
    if (t.requestVersionId && !taskByVersionId.has(t.requestVersionId)) taskByVersionId.set(t.requestVersionId, t);
  }

  return versions.map((v) => {
    const task = taskByVersionId.get(v.id) ?? null;
    const taskReason =
      task?.state === "BLOCKED"
        ? task.blockedReason
        : task?.state === "CANCELLED"
          ? task.events[0]?.reason ?? null
          : null;
    return {
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
      justification: v.justification,
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      pendingClarificationStageId:
        v.state === "CLARIFICATION_REQUIRED" ? v.stages.find((s) => s.decision === null)?.id ?? null : null,
      currentStageReason:
        v.state === "CLARIFICATION_REQUIRED"
          ? v.stages.find((s) => s.decision === null)?.reason ?? null
          : v.state === "REVISION_REQUIRED"
            // Retour d'un approbateur, sinon renvoi en révision par le
            // processeur (fin de période dépassée avant exécution, D-11.4).
            ? v.stages.find((s) => s.decision === "RETURN")?.reason ?? taskReason
            : null,
      closed: v.request.closedAt !== null,
      outcome: v.outcome,
      completedAt: v.completedAt,
      cancelRequestedAt: v.cancelRequestedAt,
      taskState: task?.state ?? null,
      taskReason,
    };
  });
}
```

(d) Remplacer le commentaire et le début de `listMyRequests` — du commentaire `/** Les demandes dont l'utilisateur est l'initiateur de la version courante. */` jusqu'à la ligne `where: { orgId },` incluse — par :

```ts
/**
 * Les demandes dont l'utilisateur est l'initiateur de la version courante,
 * historique compris (phase 3b, D-4a : les demandes terminées ne sont plus
 * supprimées), plus récentes d'abord. Filtre en base par initiateur (dette
 * 3a : l'organisation entière était chargée puis filtrée en mémoire).
 */
export async function listMyRequests(orgId: string, userId: string): Promise<RequestSummaryDTO[]> {
  const requests = await prisma.accessRequest.findMany({
    where: { orgId, versions: { some: { initiatorId: userId } } },
    orderBy: { createdAt: "desc" },
```

(le reste de la fonction — `include`, filtre sur la version courante, `return toSummaries(mine);` — est inchangé).

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-db/requests-read-server.test.ts && npx tsc --noEmit`
Expected: PASS (15 tests : 12 existants + 3), aucune erreur de type. (`app/(dashboard)/requests/mine/page.tsx` compile toujours : il étale `...r` et ne sérialise que les dates qu'il connaît ; les nouvelles dates sont traitées en Tâche 15.)

- [ ] **Step 5: Commit**

```bash
git add lib/access/requests-read-server.ts tests/unit/access-db/requests-read-server.test.ts
git commit -m "feat(access): mes demandes — historique conservé et suivi de l'exécution" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6 : Réclamer et passer la main (avec revérification)

**Files:**
- Modify: `lib/access/fulfilment-server.ts` (imports + ajout en fin de fichier)
- Test: `tests/unit/access-db/fulfilment-server.test.ts`

**Interfaces:**
- Consumes: Tâches 2–4 (`ownerRoleFor`, `ASSIGNMENT_CHANGED_REASON`, `FulfilmentError`, `cancelRequest`).
- Produces:
  - `interface RevalidationTarget` et `revalidateTask(client: DbClient, task: RevalidationTarget, now: Date): Promise<string | null>` (motif français ou `null`)
  - `interface TaskMutationOptions { correlationId?: string | null; now?: Date }` ; `interface TaskStateDTO { taskId: string; state: TaskState; revision: number }`
  - `claimTask(orgId, actorId, taskId, expectedRevision, opts?): Promise<TaskStateDTO>`
  - `handoverTask(orgId, actorId, taskId, { toUserId, reason, expectedRevision }, opts?): Promise<TaskStateDTO>`
  - internes réutilisés par les Tâches 7–8 (même fichier) : `loadTaskForActor`, `runTaskTx`, `moveVersionInTx`, `auditTaskInTx`, `assertRevision`, `ActorContext`, `STALE_MESSAGE`, `isUserAvailable`.

- [ ] **Step 1: Écrire les tests**

Dans `tests/unit/access-db/fulfilment-server.test.ts`, remplacer les imports de `@/lib/access/fulfilment-server` et de `./fulfilment-fixtures` par :

```ts
import { cancelRequest, submitRequest } from "@/lib/access/requests-server";
import {
  FulfilmentError,
  cancelReadyTaskForVersionInTx,
  claimTask,
  getFulfilmentAssetIds,
  handoverTask,
  releaseTaskInTx,
} from "@/lib/access/fulfilment-server";
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  giveAccess,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(FulfilmentError);
  await expect(p).rejects.toMatchObject({ code });
}
```

et ajouter à la fin du fichier :

```ts

describe("fulfilment-server — réclamer et passer la main", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("claim");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function readyTask(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return { emp, final, task: await taskForVersion(final.id) };
  }

  it("le propriétaire réclame : tâche CLAIMED, version IN_PROGRESS, événement et audit (rôle représenté)", async () => {
    const { final, task } = await readyTask("Claim1");
    const res = await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    expect(res).toEqual({ taskId: task.id, state: "CLAIMED", revision: 2 });
    const after = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after).toMatchObject({ state: "CLAIMED", claimantId: fx.users.owner });
    expect(after.claimedAt).not.toBeNull();
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("IN_PROGRESS");
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_CLAIMED", objectId: task.id } });
    expect(audit).toMatchObject({ actorId: fx.users.owner, actorRole: null, primaryCoveredId: null, scopeType: "ASSET", scopeId: fx.assetId });
    expect(audit.after).toMatchObject({ state: "CLAIMED", actingAs: "ASSET_OWNER", selfFulfilled: false });
  });

  it("le suppléant réclame à tout moment : audit ASSET_OWNER_BACKUP, propriétaire couvert renseigné (FP:83, FP:86)", async () => {
    const { task } = await readyTask("Claim2");
    await claimTask(fx.orgId, fx.users.backup, task.id, 1);
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_CLAIMED", objectId: task.id } });
    expect(audit.primaryCoveredId).toBe(fx.users.owner);
    expect(audit.after).toMatchObject({ actingAs: "ASSET_OWNER_BACKUP" });
  });

  it("un tiers → NOT_FOUND ; révision périmée → STALE ; déjà réclamée → INVALID_TRANSITION", async () => {
    const { task } = await readyTask("Claim3");
    await expectCode(claimTask(fx.orgId, fx.users.stranger, task.id, 1), "NOT_FOUND");
    await expectCode(claimTask(fx.orgId, fx.users.owner, "tache-inexistante", 1), "NOT_FOUND");
    await expectCode(claimTask(fx.orgId, fx.users.owner, task.id, 7), "STALE");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await expectCode(claimTask(fx.orgId, fx.users.backup, task.id, 2), "INVALID_TRANSITION");
  });

  it("réclamation concurrente propriétaire/suppléant : un seul gagnant", async () => {
    const { task } = await readyTask("Race");
    const results = await Promise.allSettled([
      claimTask(fx.orgId, fx.users.owner, task.id, 1),
      claimTask(fx.orgId, fx.users.backup, task.id, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(FulfilmentError);
    expect(["STALE", "INVALID_TRANSITION"]).toContain((loser.reason as FulfilmentError).code);
    expect(await prisma.accessTaskEvent.count({ where: { taskId: task.id, type: "CLAIMED" } })).toBe(1);
  });

  it("Review Focus #4 — annulation par le demandeur et réclamation simultanées : un seul effet, états cohérents", async () => {
    const { emp, final, task } = await readyTask("CancelRace");
    const [cancel, claim] = await Promise.allSettled([
      cancelRequest(fx.orgId, emp, final.requestId),
      claimTask(fx.orgId, fx.users.owner, task.id, 1),
    ]);
    const version = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } });
    const after = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } });
    if (claim.status === "fulfilled") {
      // La réclamation a gagné : l'annulation n'a pu que devenir une demande d'annulation, ou échouer.
      expect(after.state).toBe("CLAIMED");
      expect(version.state).toBe("IN_PROGRESS");
      expect(cancel.status === "rejected" || cancel.value === "CANCEL_REQUESTED").toBe(true);
    } else {
      expect(cancel).toEqual({ status: "fulfilled", value: "CANCELLED" });
      expect(after.state).toBe("CANCELLED");
      expect(version.state).toBe("CANCELLED");
    }
  });

  it("actif sans propriétaire : personne ne peut réclamer (FP:312)", async () => {
    const orphan = await prisma.accessAsset.create({ data: { orgId: fx.orgId, name: "Orpheline", requestsEnabled: true } });
    const level = await prisma.accessLevel.create({ data: { assetId: orphan.id, name: "Base", priority: 1, isAdmin: false } });
    const v = await submitRequest(fx.orgId, fx.users.coo, {
      beneficiaryId: fx.users.coo, assetId: orphan.id, targetLevelId: level.id, justification: "COO",
    });
    const task = await taskForVersion(v.id);
    for (const actor of [fx.users.coo, fx.users.ciso, fx.users.owner]) {
      await expectCode(claimTask(fx.orgId, actor, task.id, 1), "NOT_FOUND");
    }
  });

  it("passation au suppléant avec motif ; vers soi-même ou un tiers → VALIDATION ; tâche non réclamée → INVALID_TRANSITION", async () => {
    const { task } = await readyTask("Handover");
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 1 }), "INVALID_TRANSITION");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.owner, reason: "moi", expectedRevision: 2 }), "VALIDATION");
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.stranger, reason: "tiers", expectedRevision: 2 }), "VALIDATION");
    const res = await handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 2 });
    expect(res).toEqual({ taskId: task.id, state: "CLAIMED", revision: 3 });
    const after = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.claimantId).toBe(fx.users.backup);
    const event = await prisma.accessTaskEvent.findFirstOrThrow({ where: { taskId: task.id, type: "HANDED_OVER" } });
    expect(event).toMatchObject({ actorId: fx.users.owner, toUserId: fx.users.backup, reason: "congés" });
  });

  it("passation vers un suppléant indisponible → VALIDATION", async () => {
    const { task } = await readyTask("HandoverGone");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "OFFBOARDING" } });
    await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "départ", expectedRevision: 2 }), "VALIDATION");
    await prisma.accessProfile.update({ where: { userId: fx.users.backup }, data: { lifecycle: "ACTIVE" } });
  });

  it("Review Focus #1 — propriétaire remplacé après réclamation : l'ancien détenteur ne peut plus agir, le nouveau reprend par passation", async () => {
    const { task } = await readyTask("Replaced");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    const newOwner = await newEmployee(fx, "NewOwner");
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { ownerId: newOwner } });
    try {
      await expectCode(handoverTask(fx.orgId, fx.users.owner, task.id, { toUserId: fx.users.backup, reason: "x", expectedRevision: 2 }), "NOT_FOUND");
      const res = await handoverTask(fx.orgId, newOwner, task.id, { toUserId: newOwner, reason: "reprise après changement de propriétaire", expectedRevision: 2 });
      expect(res.revision).toBe(3);
      expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: task.id } })).claimantId).toBe(newOwner);
    } finally {
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { ownerId: fx.users.owner } });
    }
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts`
Expected: FAIL — `claimTask`, `handoverTask` non exportés.

- [ ] **Step 3: Implémenter dans `lib/access/fulfilment-server.ts`**

(a) Remplacer le bloc d'imports (les cinq lignes `import …`) par :

```ts
import type { AccessRequest, AccessRequestState, AccessRequestVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { isAvailable } from "./roles";
import {
  ASSIGNMENT_CHANGED_REASON,
  ownerRoleFor,
  taskActionForKind,
  type OwnerRole,
  type TaskOutcome,
  type TaskState,
} from "./fulfilment";
```

(b) Ajouter à la fin du fichier :

```ts

// ── Revérification (FP:245, D-9, D-12) ───────────────────────────────────

export interface RevalidationTarget {
  orgId: string;
  state: TaskState;
  action: "GRANT" | "CHANGE_LEVEL" | "RENEW" | "REVOKE" | "EXPIRY_REMOVAL";
  assetId: string;
  beneficiaryId: string;
  toLevelId: string | null;
  periodEnd: Date | null;
  expectedAssignmentVersion: number;
  asset: { archivedAt: Date | null; catalogueVersion: number };
  requestVersion: { state: AccessRequestState; kind: string; catalogueVersion: number } | null;
}

const EXPECTED_VERSION_STATE: Record<"READY" | "CLAIMED" | "BLOCKED", AccessRequestState> = {
  READY: "READY_FOR_FULFILMENT",
  CLAIMED: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
};

/**
 * Motif actionnable (français) si la tâche ne peut plus être exécutée telle
 * qu'approuvée, sinon null. Utilisée au claim, à la confirmation, pour
 * autoriser la réconciliation et pour l'affichage (`staleReason`).
 * Octroi/montée/renouvellement : bénéficiaire ACTIVE, actif non archivé,
 * période non échue. Réduction/retrait : aucun de ces trois contrôles
 * (FP:110, FP:124 — le nettoyage n'est jamais empêché).
 */
export async function revalidateTask(client: DbClient, task: RevalidationTarget, now: Date): Promise<string | null> {
  if (task.state === "COMPLETED" || task.state === "CANCELLED") return null;
  const version = task.requestVersion;
  if (version && version.state !== EXPECTED_VERSION_STATE[task.state]) {
    return "La demande a changé depuis l'approbation";
  }
  const grantFamily =
    task.action === "GRANT" || task.action === "RENEW" || (task.action === "CHANGE_LEVEL" && version?.kind === "UPGRADE");
  if (grantFamily) {
    const profile = await client.accessProfile.findUnique({
      where: { userId: task.beneficiaryId },
      select: { lifecycle: true },
    });
    if (profile?.lifecycle !== "ACTIVE") return "L'employé n'est plus actif";
    if (task.asset.archivedAt !== null) return "L'application a été archivée";
    if (task.periodEnd !== null && task.periodEnd.getTime() <= now.getTime()) {
      return "La période est terminée — la demande doit être révisée";
    }
  }
  if (version && task.asset.catalogueVersion !== version.catalogueVersion) {
    return "Le catalogue de l'application a changé depuis l'approbation";
  }
  if (task.toLevelId) {
    const level = await client.accessLevel.findFirst({
      where: { id: task.toLevelId, assetId: task.assetId },
      select: { archivedAt: true, enabled: true },
    });
    if (!level || level.archivedAt !== null || !level.enabled) return "Le niveau cible a été archivé";
  }
  const assignment = await client.accessAssignment.findFirst({
    where: { orgId: task.orgId, userId: task.beneficiaryId, assetId: task.assetId },
    select: { id: true, version: true },
  });
  if ((assignment?.version ?? 0) !== task.expectedAssignmentVersion) return ASSIGNMENT_CHANGED_REASON;
  if (assignment && (task.action === "GRANT" || task.action === "RENEW")) {
    const claimedExpiry = await client.accessFulfilmentTask.findFirst({
      where: { sourceAssignmentId: assignment.id, action: "EXPIRY_REMOVAL", state: { in: ["CLAIMED", "BLOCKED"] } },
      select: { id: true },
    });
    if (claimedExpiry) return "Un retrait est en cours — à réconcilier";
  }
  return null;
}

// ── Contexte d'action d'un propriétaire ─────────────────────────────────

const NOT_FOUND_MESSAGE = "Tâche introuvable";
const STALE_MESSAGE = "La tâche a changé, rechargez";

const TASK_INCLUDE = {
  asset: { select: { id: true, ownerId: true, backupOwnerId: true, archivedAt: true, catalogueVersion: true } },
  requestVersion: { include: { request: true } },
} satisfies Prisma.AccessFulfilmentTaskInclude;

type LoadedTask = Prisma.AccessFulfilmentTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

interface ActorContext {
  actingAs: OwnerRole;
  /** Propriétaire principal couvert quand le suppléant agit (FP:86). */
  primaryCoveredId: string | null;
}

/**
 * Charge la tâche et vérifie le périmètre de l'acteur EN DIRECT (D-5) :
 * propriétaire ou suppléant courant de l'actif, et disponible. Tâche
 * inexistante, d'une autre organisation ou hors périmètre → même 404.
 */
async function loadTaskForActor(
  tx: Prisma.TransactionClient,
  orgId: string,
  actorId: string,
  taskId: string
): Promise<{ task: LoadedTask; actor: ActorContext }> {
  const task = await tx.accessFulfilmentTask.findFirst({ where: { id: taskId, orgId }, include: TASK_INCLUDE });
  if (!task) throw new FulfilmentError("NOT_FOUND", NOT_FOUND_MESSAGE);
  const role = ownerRoleFor(task.asset, actorId);
  if (!role || !(await isUserAvailable(tx, orgId, actorId))) {
    throw new FulfilmentError("NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return {
    task,
    actor: { actingAs: role, primaryCoveredId: role === "ASSET_OWNER_BACKUP" ? task.asset.ownerId : null },
  };
}

async function runTaskTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn);
  } catch (err) {
    if (err instanceof FulfilmentError) throw err;
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : null;
    // P2002 : création concurrente de l'affectation (unique userId+assetId) ;
    // P2034 : conflit d'écriture/interblocage détecté par Postgres.
    if (code === "P2002" || code === "P2034") throw new FulfilmentError("STALE", STALE_MESSAGE);
    throw err;
  }
}

async function moveVersionInTx(
  tx: Prisma.TransactionClient,
  versionId: string | null,
  from: AccessRequestState[],
  data: Prisma.AccessRequestVersionUpdateManyMutationInput
): Promise<void> {
  if (!versionId) return;
  const { count } = await tx.accessRequestVersion.updateMany({
    where: { id: versionId, state: { in: from } },
    data: { ...data, revision: { increment: 1 } },
  });
  if (count === 0) throw new FulfilmentError("STALE", "La demande a changé, rechargez");
}

interface TaskAuditInput {
  orgId: string;
  actorId: string;
  actor: ActorContext;
  task: { id: string; assetId: string; beneficiaryId: string };
  eventType: string;
  objectVersion: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  correlationId: string | null;
}

async function auditTaskInTx(tx: Prisma.TransactionClient, input: TaskAuditInput): Promise<void> {
  await recordAuditInTx(tx, {
    orgId: input.orgId,
    actorId: input.actorId,
    // Pas de valeur d'énumération « propriétaire d'actif » (D-18) : le rôle
    // représenté va dans `after.actingAs`.
    actorRole: null,
    primaryCoveredId: input.actor.primaryCoveredId,
    scopeType: "ASSET",
    scopeId: input.task.assetId,
    eventType: input.eventType,
    objectType: "AccessFulfilmentTask",
    objectId: input.task.id,
    objectVersion: input.objectVersion,
    beneficiaryId: input.task.beneficiaryId,
    before: input.before,
    after: { ...input.after, actingAs: input.actor.actingAs },
    reason: input.reason,
    outcome: "SUCCESS",
    correlationId: input.correlationId,
  });
}

export interface TaskMutationOptions {
  /** Lot (D-13) : même identifiant pour tous les éléments d'un appel. */
  correlationId?: string | null;
  /** Horloge injectable (tests). */
  now?: Date;
}

export interface TaskStateDTO {
  taskId: string;
  state: TaskState;
  revision: number;
}

function assertRevision(task: { revision: number }, expectedRevision: number): void {
  if (task.revision !== expectedRevision) throw new FulfilmentError("STALE", STALE_MESSAGE);
}

// ── Réclamer / passer la main ────────────────────────────────────────────

export async function claimTask(
  orgId: string,
  actorId: string,
  taskId: string,
  expectedRevision: number,
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  const now = opts.now ?? new Date();
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "READY") throw new FulfilmentError("INVALID_TRANSITION", "Cette tâche n'est plus à réclamer");
    assertRevision(task, expectedRevision);
    const stale = await revalidateTask(tx, task, now);
    if (stale) throw new FulfilmentError("STALE", stale);

    await moveVersionInTx(tx, task.requestVersionId, ["READY_FOR_FULFILMENT"], { state: "IN_PROGRESS" });
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: "READY", revision: expectedRevision },
      data: { state: "CLAIMED", claimantId: actorId, claimedAt: now, revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: { orgId, taskId: task.id, type: "CLAIMED", actorId, actingAs: actor.actingAs },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_CLAIMED",
      objectVersion: expectedRevision + 1,
      before: { state: "READY" },
      after: { state: "CLAIMED", selfFulfilled: actorId === task.beneficiaryId },
      reason: null,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: "CLAIMED", revision: expectedRevision + 1 };
  });
}

/**
 * Passation (D-8) vers l'AUTRE propriétaire/suppléant disponible de l'actif,
 * motif obligatoire. Faite par le détenteur OU par tout propriétaire/suppléant
 * courant (le détenteur a pu perdre son périmètre : FP:241, FP:112).
 */
export async function handoverTask(
  orgId: string,
  actorId: string,
  taskId: string,
  input: { toUserId: string; reason: string; expectedRevision: number },
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "CLAIMED" && task.state !== "BLOCKED") {
      throw new FulfilmentError("INVALID_TRANSITION", "Seule une tâche réclamée ou bloquée peut être passée");
    }
    assertRevision(task, input.expectedRevision);
    const candidates = [task.asset.ownerId, task.asset.backupOwnerId].filter(
      (id): id is string => id !== null && id !== task.claimantId
    );
    if (!candidates.includes(input.toUserId) || !(await isUserAvailable(tx, orgId, input.toUserId))) {
      throw new FulfilmentError(
        "VALIDATION",
        "Le destinataire doit être l'autre propriétaire ou suppléant disponible de l'application"
      );
    }
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: task.state, revision: input.expectedRevision },
      data: { claimantId: input.toUserId, revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: {
        orgId,
        taskId: task.id,
        type: "HANDED_OVER",
        actorId,
        actingAs: actor.actingAs,
        toUserId: input.toUserId,
        reason: input.reason,
      },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_HANDED_OVER",
      objectVersion: input.expectedRevision + 1,
      before: { claimantId: task.claimantId },
      after: { claimantId: input.toUserId },
      reason: input.reason,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: task.state, revision: input.expectedRevision + 1 };
  });
}
```

Note : une tâche `READY` dont la revérification échoue ne peut pas être réclamée (D-12, « une action périmée est refusée ») ; l'issue est l'annulation par le demandeur (D-19, avant réclamation) ou, pour une période échue, le processeur (Tâche 11).

- [ ] **Step 4: Vérifier (cinq fois : les tests de concurrence ne doivent pas être instables)**

Run: `for i in 1 2 3 4 5; do npx vitest run tests/unit/access-db/fulfilment-server.test.ts | grep -E "Tests |FAIL"; done && npx tsc --noEmit`
Expected: cinq fois `Tests  13 passed (13)`, aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/fulfilment-server.ts tests/unit/access-db/fulfilment-server.test.ts
git commit -m "feat(access): réclamer une tâche d'exécution et passer la main, avec revérification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7 : Bloquer, reprendre, réconcilier

**Files:**
- Modify: `lib/access/fulfilment-server.ts` (imports + ajout en fin de fichier)
- Test: `tests/unit/access-db/fulfilment-server.test.ts`

**Interfaces:**
- Consumes: Tâche 6 (`loadTaskForActor`, `runTaskTx`, `moveVersionInTx`, `auditTaskInTx`, `assertRevision`, `revalidateTask`, `TaskStateDTO`, `TaskMutationOptions`) ; `readOldRemovedAt` (Tâche 2) ; `cancelRequest` (Tâche 4).
- Produces:
  - `blockTask(orgId, actorId, taskId, { reason, facts: string | null, expectedRevision }, opts?): Promise<TaskStateDTO>`
  - `resumeTask(orgId, actorId, taskId, expectedRevision, opts?): Promise<TaskStateDTO>`
  - `reconcileTask(orgId, actorId, taskId, { reason, expectedRevision }, opts?): Promise<TaskStateDTO>`
  - interne réutilisé par la Tâche 8 : `assertClaimant(task, actorId, message)`.

- [ ] **Step 1: Écrire les tests**

Dans `tests/unit/access-db/fulfilment-server.test.ts`, ajouter `blockTask`, `reconcileTask` et `resumeTask` à l'import de `@/lib/access/fulfilment-server` (ordre alphabétique), puis ajouter à la fin du fichier :

```ts

describe("fulfilment-server — bloquer, reprendre, réconcilier", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("block");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function claimedTask(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    return { emp, final, taskId: task.id };
  }

  it("blocage par le détenteur : tâche et version BLOCKED, motif et faits enregistrés, affectation intacte", async () => {
    const { emp, final, taskId } = await claimedTask("Block1");
    await expectCode(blockTask(fx.orgId, fx.users.backup, taskId, { reason: "pas moi", facts: null, expectedRevision: 2 }), "INVALID_TRANSITION");
    const res = await blockTask(fx.orgId, fx.users.owner, taskId, {
      reason: "Compte fournisseur verrouillé",
      facts: "tentative à 10h, erreur 403",
      expectedRevision: 2,
    });
    expect(res).toEqual({ taskId, state: "BLOCKED", revision: 3 });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.blockedReason).toBe("Compte fournisseur verrouillé");
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("BLOCKED");
    const event = await prisma.accessTaskEvent.findFirstOrThrow({ where: { taskId, type: "BLOCKED" } });
    expect(event.facts).toEqual({ note: "tentative à 10h, erreur 403" });
    expect(await prisma.accessAssignment.count({ where: { orgId: fx.orgId, userId: emp } })).toBe(0);
  });

  it("reprise par le suppléant : il devient détenteur, version IN_PROGRESS, motif effacé", async () => {
    const { final, taskId } = await claimedTask("Resume1");
    await blockTask(fx.orgId, fx.users.owner, taskId, { reason: "attente fournisseur", facts: null, expectedRevision: 2 });
    await expectCode(resumeTask(fx.orgId, fx.users.backup, taskId, 2), "STALE");
    const res = await resumeTask(fx.orgId, fx.users.backup, taskId, 3);
    expect(res).toEqual({ taskId, state: "CLAIMED", revision: 4 });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task).toMatchObject({ claimantId: fx.users.backup, blockedReason: null });
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("IN_PROGRESS");
    await expectCode(resumeTask(fx.orgId, fx.users.backup, taskId, 4), "INVALID_TRANSITION");
  });

  it("réconciliation refusée sans demande d'annulation ni revérification en échec", async () => {
    const { taskId } = await claimedTask("Recon0");
    await expectCode(reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "rien fait", expectedRevision: 2 }), "INVALID_TRANSITION");
  });

  it("D-19 : annulation demandée après réclamation → le détenteur réconcilie « aucune modification » → CANCELLED, demande fermée", async () => {
    const { emp, final, taskId } = await claimedTask("Recon1");
    expect(await cancelRequest(fx.orgId, emp, final.requestId)).toBe("CANCEL_REQUESTED");
    await expectCode(reconcileTask(fx.orgId, fx.users.backup, taskId, { reason: "pas détenteur", expectedRevision: 2 }), "INVALID_TRANSITION");
    const res = await reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "Aucune modification effectuée", expectedRevision: 2 });
    expect(res).toEqual({ taskId, state: "CANCELLED", revision: 3 });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.outcome).toBe("NOT_PERFORMED");
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("CANCELLED");
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).not.toBeNull();
    expect(await prisma.accessTaskEvent.count({ where: { taskId, type: "RECONCILED" } })).toBe(1);
  });

  it("réconciliation autorisée quand la tâche est périmée (niveau cible archivé), y compris depuis BLOCKED", async () => {
    const { taskId } = await claimedTask("Recon2");
    await blockTask(fx.orgId, fx.users.owner, taskId, { reason: "niveau supprimé chez l'éditeur", facts: null, expectedRevision: 2 });
    await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: new Date() } });
    try {
      const res = await reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "Aucune modification effectuée", expectedRevision: 3 });
      expect(res.state).toBe("CANCELLED");
    } finally {
      await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: null } });
    }
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts`
Expected: FAIL — `blockTask`, `resumeTask`, `reconcileTask` non exportés.

- [ ] **Step 3: Implémenter dans `lib/access/fulfilment-server.ts`**

(a) Dans l'import de `./fulfilment`, ajouter `readOldRemovedAt,` après `ownerRoleFor,`.

(b) Ajouter à la fin du fichier :

```ts

// ── Bloquer / reprendre / réconcilier ────────────────────────────────────

function assertClaimant(task: { claimantId: string | null }, actorId: string, message: string): void {
  if (task.claimantId !== actorId) throw new FulfilmentError("INVALID_TRANSITION", message);
}

/**
 * Signaler un blocage (FP:285) : faits et motif enregistrés, AUCUNE écriture
 * d'affectation — y compris quand l'owner a fait un changement externe
 * malgré un état contradictoire (D-9, FP:245).
 */
export async function blockTask(
  orgId: string,
  actorId: string,
  taskId: string,
  input: { reason: string; facts: string | null; expectedRevision: number },
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "CLAIMED") throw new FulfilmentError("INVALID_TRANSITION", "Seule une tâche en cours peut être bloquée");
    assertClaimant(task, actorId, "Seul le détenteur de la tâche peut signaler un blocage");
    assertRevision(task, input.expectedRevision);

    await moveVersionInTx(tx, task.requestVersionId, ["IN_PROGRESS"], { state: "BLOCKED" });
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: "CLAIMED", claimantId: actorId, revision: input.expectedRevision },
      data: { state: "BLOCKED", blockedReason: input.reason, revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: {
        orgId,
        taskId: task.id,
        type: "BLOCKED",
        actorId,
        actingAs: actor.actingAs,
        reason: input.reason,
        ...(input.facts ? { facts: { note: input.facts } } : {}),
      },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_BLOCKED",
      objectVersion: input.expectedRevision + 1,
      before: { state: "CLAIMED" },
      after: { state: "BLOCKED", facts: input.facts },
      reason: input.reason,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: "BLOCKED", revision: input.expectedRevision + 1 };
  });
}

/** Reprise (FP:285) par tout owner autorisé : il devient le détenteur. */
export async function resumeTask(
  orgId: string,
  actorId: string,
  taskId: string,
  expectedRevision: number,
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "BLOCKED") throw new FulfilmentError("INVALID_TRANSITION", "Seule une tâche bloquée peut être reprise");
    assertRevision(task, expectedRevision);

    await moveVersionInTx(tx, task.requestVersionId, ["BLOCKED"], { state: "IN_PROGRESS" });
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: "BLOCKED", revision: expectedRevision },
      data: { state: "CLAIMED", claimantId: actorId, blockedReason: null, revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: { orgId, taskId: task.id, type: "RESUMED", actorId, actingAs: actor.actingAs },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_RESUMED",
      objectVersion: expectedRevision + 1,
      before: { state: "BLOCKED", claimantId: task.claimantId },
      after: { state: "CLAIMED", claimantId: actorId },
      reason: null,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: "CLAIMED", revision: expectedRevision + 1 };
  });
}

/**
 * Réconciliation « aucune modification effectuée » (spec 3b §5) : CLAIMED ou
 * BLOCKED → CANCELLED, seulement si l'annulation a été demandée (D-19) ou si
 * la revérification échoue. Jamais après un retrait partiel déjà enregistré
 * (un fait d'exécution ne s'efface pas).
 */
export async function reconcileTask(
  orgId: string,
  actorId: string,
  taskId: string,
  input: { reason: string; expectedRevision: number },
  opts: TaskMutationOptions = {}
): Promise<TaskStateDTO> {
  const now = opts.now ?? new Date();
  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);
    if (task.state !== "CLAIMED" && task.state !== "BLOCKED") {
      throw new FulfilmentError("INVALID_TRANSITION", "Seule une tâche réclamée ou bloquée peut être réconciliée");
    }
    assertClaimant(task, actorId, "Seul le détenteur de la tâche peut la réconcilier");
    assertRevision(task, input.expectedRevision);
    if (readOldRemovedAt(task.progress) !== null) {
      throw new FulfilmentError(
        "INVALID_TRANSITION",
        "L'ancien niveau a déjà été retiré — confirmez l'octroi ou signalez un blocage"
      );
    }
    const cancelRequested = task.requestVersion?.cancelRequestedAt != null;
    const stale = await revalidateTask(tx, task, now);
    if (!cancelRequested && !stale) {
      throw new FulfilmentError(
        "INVALID_TRANSITION",
        "Réconciliation possible seulement après une demande d'annulation ou si la tâche est périmée"
      );
    }

    await moveVersionInTx(tx, task.requestVersionId, ["IN_PROGRESS", "BLOCKED"], { state: "CANCELLED" });
    if (task.requestVersion) {
      await tx.accessRequest.update({ where: { id: task.requestVersion.requestId }, data: { closedAt: now } });
    }
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: task.state, claimantId: actorId, revision: input.expectedRevision },
      data: { state: "CANCELLED", outcome: "NOT_PERFORMED", revision: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);

    await tx.accessTaskEvent.create({
      data: { orgId, taskId: task.id, type: "RECONCILED", actorId, actingAs: actor.actingAs, reason: input.reason },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_RECONCILED",
      objectVersion: input.expectedRevision + 1,
      before: { state: task.state },
      after: { state: "CANCELLED", outcome: "NOT_PERFORMED", cancelRequested, staleReason: stale },
      reason: input.reason,
      correlationId: opts.correlationId ?? null,
    });
    return { taskId: task.id, state: "CANCELLED", revision: input.expectedRevision + 1 };
  });
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts && npx tsc --noEmit`
Expected: PASS (18 tests), aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/fulfilment-server.ts tests/unit/access-db/fulfilment-server.test.ts
git commit -m "feat(access): bloquer, reprendre et réconcilier une tâche d'exécution" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8 : Confirmer — effet sur l'affectation, rejeu, remplacement en deux temps, supplantation d'une expiration

**Files:**
- Modify: `lib/access/fulfilment-server.ts` (imports + ajout en fin de fichier)
- Test: `tests/unit/access-db/fulfilment-server.test.ts`

**Interfaces:**
- Consumes: Tâches 2, 6, 7 (`assignmentEffect`, `partialRemovalEffect`, `outcomeFor`, `validateCompletionInput`, `revalidateTask`, `loadTaskForActor`, `runTaskTx`, `moveVersionInTx`, `auditTaskInTx`, `assertRevision`, `assertClaimant`).
- Produces:
  - `interface CompleteTaskInput { completedAt: Date; reference: string | null; note: string | null; method?: CompletionMethod; partialRemovalOnly?: boolean; expectedRevision: number }`
  - `interface CompletionResultDTO { taskId: string; state: TaskState; revision: number; outcome: TaskOutcome | null; assignmentVersion: number; replayed: boolean }`
  - `completeTask(orgId, actorId, taskId, input: CompleteTaskInput, opts?): Promise<CompletionResultDTO>`

Règles (D-9, D-10, D-23) : seul le détenteur d'une tâche `CLAIMED` confirme ; rejouée à l'identique sur une tâche `COMPLETED` → même résultat sans écriture ; revérification puis effet du tableau §5 ; `CHANGE_LEVEL` exige `method` ; `partialRemovalOnly` (méthode `REMOVE_THEN_GRANT`) enregistre « aucun accès » + tâche et version `BLOCKED` ; un octroi/renouvellement supplante une tâche d'expiration `READY` de la même affectation et est refusé si elle est réclamée.

- [ ] **Step 1: Écrire les tests**

Dans `tests/unit/access-db/fulfilment-server.test.ts` : ajouter `completeTask` à l'import de `@/lib/access/fulfilment-server`, ajouter `approvedReduction` et `currentAssignment` à l'import de `./fulfilment-fixtures`, puis ajouter à la fin du fichier :

```ts

describe("fulfilment-server — confirmer (D-9, D-10, D-23, A16–A18)", () => {
  let fx: FulfilmentFixture;
  const DAY = 86_400_000;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("complete");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  function facts(over: Partial<{ reference: string | null; note: string | null; method: "DIRECT" | "REMOVE_THEN_GRANT"; completedAt: Date; partialRemovalOnly: boolean }> = {}) {
    return { completedAt: new Date(), reference: "TICKET-1", note: null, ...over };
  }

  async function claimed(finalId: string, actor = fx.users.owner) {
    const task = await taskForVersion(finalId);
    await claimTask(fx.orgId, actor, task.id, 1);
    return task.id;
  }

  it("GRANT : affectation créée ACTIVE (source REQUEST, OWNER_CONFIRMED), événement, version COMPLETED, demande fermée", async () => {
    const emp = await newEmployee(fx, "Grant");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    const completedAt = new Date(Date.now() - 60_000);
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ completedAt }), expectedRevision: 2 });
    expect(res).toEqual({ taskId, state: "COMPLETED", revision: 3, outcome: "PROVISIONED", assignmentVersion: 1, replayed: false });

    const a = await currentAssignment(fx, emp);
    expect(a).toMatchObject({ status: "ACTIVE", levelId: fx.levels.reader, source: "REQUEST", verification: "OWNER_CONFIRMED", version: 1 });
    expect(a?.grantedAt?.getTime()).toBe(completedAt.getTime());
    const events = await prisma.accessAssignmentEvent.findMany({ where: { assignmentId: a!.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sourceType: "FULFILMENT", sourceId: taskId, beforeLevelId: null, afterLevelId: fx.levels.reader, outcome: "PROVISIONED", actorId: fx.users.owner });
    const version = await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } });
    expect(version).toMatchObject({ state: "COMPLETED", outcome: "PROVISIONED" });
    expect(version.completedAt?.getTime()).toBe(completedAt.getTime());
    expect((await prisma.accessRequest.findUniqueOrThrow({ where: { id: final.requestId } })).closedAt).not.toBeNull();
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED", objectId: taskId } });
    expect(audit.after).toMatchObject({ outcome: "PROVISIONED", selfFulfilled: false, actingAs: "ASSET_OWNER", reference: "TICKET-1" });
  });

  it("CHANGE_LEVEL (montée, méthode directe) : niveau remplacé, version +1, ancien niveau dans l'historique", async () => {
    const emp = await newEmployee(fx, "Upgrade");
    const before = await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedSelfRequest(fx, emp, fx.levels.editor);
    expect(final.kind).toBe("UPGRADE");
    const taskId = await claimed(final.id);
    await expectCode(completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 }), "VALIDATION");
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ method: "DIRECT" }), expectedRevision: 2 });
    expect(res.outcome).toBe("CHANGED");
    const a = await currentAssignment(fx, emp);
    expect(a).toMatchObject({ levelId: fx.levels.editor, status: "ACTIVE", version: before.version + 1 });
    const event = await prisma.accessAssignmentEvent.findFirstOrThrow({ where: { assignmentId: before.id } });
    expect(event).toMatchObject({ beforeLevelId: fx.levels.reader, afterLevelId: fx.levels.editor });
  });

  it("RENEW : nouvelle fin de période, niveau et date d'octroi inchangés", async () => {
    const emp = await newEmployee(fx, "Renew");
    const before = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() + 10 * DAY) });
    const newEnd = new Date(Date.now() + 90 * DAY);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: newEnd });
    expect(final.kind).toBe("RENEW");
    const taskId = await claimed(final.id);
    await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 });
    const a = await currentAssignment(fx, emp);
    expect(a?.levelId).toBe(fx.levels.reader);
    expect(a?.periodEnd?.getTime()).toBe(newEnd.getTime());
    expect(a?.grantedAt).toEqual(before.grantedAt);
    expect(a?.version).toBe(before.version + 1);
  });

  it("REVOKE : REVOKED, niveau nul, date de retrait ; possible même pour un employé parti (FP:124)", async () => {
    const emp = await newEmployee(fx, "Revoke");
    await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedReduction(fx, emp, null);
    const taskId = await claimed(final.id);
    await prisma.accessProfile.update({ where: { userId: emp }, data: { lifecycle: "DEPARTED" } });
    const completedAt = new Date(Date.now() - 5_000);
    const res = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ completedAt }), expectedRevision: 2 });
    expect(res.outcome).toBe("REVOKED");
    const a = await currentAssignment(fx, emp);
    expect(a).toMatchObject({ status: "REVOKED", levelId: null, source: "LEGACY_IMPORT" });
    expect(a?.revokedAt?.getTime()).toBe(completedAt.getTime());
  });

  it("A17 — confirmation rejouée à l'identique : même résultat, aucune nouvelle écriture ; faits différents → refus", async () => {
    const emp = await newEmployee(fx, "Replay");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    const input = { ...facts({ completedAt: new Date(Date.now() - 1_000) }), expectedRevision: 2 };
    const first = await completeTask(fx.orgId, fx.users.owner, taskId, input);
    const second = await completeTask(fx.orgId, fx.users.owner, taskId, input);
    expect(second).toEqual({ ...first, replayed: true });
    const a = await currentAssignment(fx, emp);
    expect(a?.version).toBe(1);
    expect(await prisma.accessAssignmentEvent.count({ where: { assignmentId: a!.id } })).toBe(1);
    expect(await prisma.accessTaskEvent.count({ where: { taskId, type: "COMPLETED" } })).toBe(1);
    await expectCode(completeTask(fx.orgId, fx.users.owner, taskId, { ...input, reference: "AUTRE" }), "INVALID_TRANSITION");
  });

  it("A16 — double confirmation concurrente de la même tâche : un seul niveau courant, une seule écriture", async () => {
    const emp = await newEmployee(fx, "Double");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    const input = { ...facts({ completedAt: new Date(Date.now() - 1_000) }), expectedRevision: 2 };
    const results = await Promise.allSettled([
      completeTask(fx.orgId, fx.users.owner, taskId, input),
      completeTask(fx.orgId, fx.users.owner, taskId, input),
    ]);
    const writes = results.filter((r) => r.status === "fulfilled" && r.value.replayed === false);
    expect(writes).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as FulfilmentError).code).toBe("STALE");
    }
    expect(await prisma.accessAssignment.count({ where: { orgId: fx.orgId, userId: emp } })).toBe(1);
    expect(await prisma.accessAssignmentEvent.count({ where: { orgId: fx.orgId, userId: emp } })).toBe(1);
  });

  it("A16 — retrait demandé et retrait d'expiration confirmés en même temps : un seul gagne (compare-and-swap sur la version)", async () => {
    const emp = await newEmployee(fx, "TwoRemovals");
    const assignment = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - DAY) });
    const final = await approvedReduction(fx, emp, null);
    // Expiration telle que le processeur la posera (Tâche 11) : statut, tâche, version inchangée.
    await prisma.accessAssignment.update({ where: { id: assignment.id }, data: { status: "EXPIRED_REMOVAL_PENDING" } });
    const expiry = await prisma.accessFulfilmentTask.create({
      data: {
        orgId: fx.orgId, assetId: fx.assetId, beneficiaryId: emp, action: "EXPIRY_REMOVAL",
        sourceAssignmentId: assignment.id, sourceAssignmentVersion: assignment.version, fromLevelId: fx.levels.reader,
        expectedAssignmentVersion: assignment.version, idempotencyKey: `EXP:${assignment.id}:${assignment.version}`,
      },
    });
    const revokeTaskId = await claimed(final.id, fx.users.owner);
    await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);
    const results = await Promise.allSettled([
      completeTask(fx.orgId, fx.users.owner, revokeTaskId, { ...facts(), expectedRevision: 2 }),
      completeTask(fx.orgId, fx.users.backup, expiry.id, { ...facts(), expectedRevision: 2 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(a).toMatchObject({ status: "REVOKED", levelId: null, version: assignment.version + 1 });
    expect(await prisma.accessAssignmentEvent.count({ where: { assignmentId: assignment.id } })).toBe(1);
  });

  it("A18 — remplacement par retrait puis octroi : l'étape 1 seule enregistre « aucun accès » et un travail bloqué, puis la reprise accorde", async () => {
    const emp = await newEmployee(fx, "Partial");
    const before = await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedSelfRequest(fx, emp, fx.levels.editor);
    const taskId = await claimed(final.id);
    const step1 = await completeTask(fx.orgId, fx.users.owner, taskId, {
      ...facts({ method: "REMOVE_THEN_GRANT", partialRemovalOnly: true, note: "ancien rôle retiré" }),
      expectedRevision: 2,
    });
    expect(step1).toMatchObject({ state: "BLOCKED", outcome: null, assignmentVersion: before.version + 1 });
    const mid = await currentAssignment(fx, emp);
    expect(mid).toMatchObject({ status: "REVOKED", levelId: null });
    const task = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe("BLOCKED");
    expect(task.blockedReason).toBe("Ancien niveau retiré — nouvel accès pas encore accordé");
    expect(task.expectedAssignmentVersion).toBe(before.version + 1);
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("BLOCKED");
    // Un fait d'exécution ne s'efface pas : pas de réconciliation « rien fait ».
    await prisma.accessRequestVersion.update({ where: { id: final.id }, data: { cancelRequestedAt: new Date() } });
    await expectCode(reconcileTask(fx.orgId, fx.users.owner, taskId, { reason: "rien fait", expectedRevision: 3 }), "INVALID_TRANSITION");

    await resumeTask(fx.orgId, fx.users.owner, taskId, 3);
    const done = await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ method: "REMOVE_THEN_GRANT" }), expectedRevision: 4 });
    expect(done).toMatchObject({ state: "COMPLETED", outcome: "CHANGED", assignmentVersion: before.version + 2 });
    expect(await currentAssignment(fx, emp)).toMatchObject({ status: "ACTIVE", levelId: fx.levels.editor });
    const history = await prisma.accessAssignmentEvent.findMany({ where: { assignmentId: before.id }, orderBy: { occurredAt: "asc" } });
    expect(history.map((e) => [e.beforeLevelId, e.afterLevelId])).toEqual([[fx.levels.reader, null], [null, fx.levels.editor]]);
  });

  it("« seul l'ancien niveau retiré » refusé hors changement de niveau par retrait puis octroi", async () => {
    const emp = await newEmployee(fx, "PartialBad");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const taskId = await claimed(final.id);
    await expectCode(
      completeTask(fx.orgId, fx.users.owner, taskId, { ...facts({ method: "REMOVE_THEN_GRANT", partialRemovalOnly: true }), expectedRevision: 2 }),
      "VALIDATION"
    );
  });

  it("confirmer une tâche non réclamée, ou réclamée par un autre → INVALID_TRANSITION", async () => {
    const emp = await newEmployee(fx, "NotClaimed");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    await expectCode(completeTask(fx.orgId, fx.users.owner, task.id, { ...facts(), expectedRevision: 1 }), "INVALID_TRANSITION");
    await claimTask(fx.orgId, fx.users.owner, task.id, 1);
    await expectCode(completeTask(fx.orgId, fx.users.backup, task.id, { ...facts(), expectedRevision: 2 }), "INVALID_TRANSITION");
  });

  describe("revérifications à la confirmation → STALE avec un motif actionnable", () => {
    async function claimedGrant(label: string, opts: { periodEnd?: Date } = {}) {
      const emp = await newEmployee(fx, label);
      const final = await approvedSelfRequest(fx, emp, fx.levels.reader, opts);
      return { emp, taskId: await claimed(final.id) };
    }
    async function expectStale(taskId: string, message: string, now?: Date) {
      const p = completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 }, now ? { now } : {});
      await expect(p).rejects.toMatchObject({ code: "STALE", message });
    }

    it("niveau cible archivé", async () => {
      const { taskId } = await claimedGrant("StaleLevel");
      await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: new Date() } });
      try {
        await expectStale(taskId, "Le niveau cible a été archivé");
      } finally {
        await prisma.accessLevel.update({ where: { id: fx.levels.reader }, data: { archivedAt: null } });
      }
    });

    it("catalogueVersion modifiée", async () => {
      const { taskId } = await claimedGrant("StaleCatalogue");
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { catalogueVersion: { increment: 1 } } });
      try {
        await expectStale(taskId, "Le catalogue de l'application a changé depuis l'approbation");
      } finally {
        await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { catalogueVersion: { decrement: 1 } } });
      }
    });

    it("affectation modifiée depuis l'approbation (assignment.version)", async () => {
      const { emp, taskId } = await claimedGrant("StaleAssignment");
      await prisma.accessAssignment.create({
        data: { orgId: fx.orgId, userId: emp, assetId: fx.assetId, levelId: null, status: "REVOKED" },
      });
      await expectStale(taskId, "L'affectation a changé depuis l'approbation");
    });

    it("bénéficiaire parti (octroi)", async () => {
      const { emp, taskId } = await claimedGrant("StaleDeparted");
      await prisma.accessProfile.update({ where: { userId: emp }, data: { lifecycle: "DEPARTED" } });
      await expectStale(taskId, "L'employé n'est plus actif");
    });

    it("période temporaire échue avant la confirmation", async () => {
      const { taskId } = await claimedGrant("StalePeriod", { periodEnd: new Date(Date.now() + 3_600_000) });
      await expectStale(taskId, "La période est terminée — la demande doit être révisée", new Date(Date.now() + 2 * 3_600_000));
    });
  });

  it("D-23 — un renouvellement confirmé supplante la tâche d'expiration NON réclamée ; réclamée → refus « à réconcilier »", async () => {
    for (const expiryClaimed of [false, true]) {
      const emp = await newEmployee(fx, expiryClaimed ? "RenewBlocked" : "RenewWins");
      const assignment = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() + DAY) });
      const newEnd = new Date(Date.now() + 60 * DAY);
      const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: newEnd });
      const renewTaskId = await claimed(final.id);
      await prisma.accessAssignment.update({ where: { id: assignment.id }, data: { status: "EXPIRED_REMOVAL_PENDING" } });
      const expiry = await prisma.accessFulfilmentTask.create({
        data: {
          orgId: fx.orgId, assetId: fx.assetId, beneficiaryId: emp, action: "EXPIRY_REMOVAL",
          sourceAssignmentId: assignment.id, sourceAssignmentVersion: assignment.version, fromLevelId: fx.levels.reader,
          expectedAssignmentVersion: assignment.version, idempotencyKey: `EXP:${assignment.id}:${assignment.version}`,
        },
      });
      if (expiryClaimed) {
        await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);
        await expect(
          completeTask(fx.orgId, fx.users.owner, renewTaskId, { ...facts(), expectedRevision: 2 })
        ).rejects.toMatchObject({ code: "STALE", message: "Un retrait est en cours — à réconcilier" });
        continue;
      }
      await completeTask(fx.orgId, fx.users.owner, renewTaskId, { ...facts(), expectedRevision: 2 });
      const a = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(a).toMatchObject({ status: "ACTIVE", levelId: fx.levels.reader, version: assignment.version + 1 });
      expect(a.periodEnd?.getTime()).toBe(newEnd.getTime());
      const superseded = await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: expiry.id } });
      expect(superseded).toMatchObject({ state: "CANCELLED", outcome: "SUPERSEDED" });
      expect(await prisma.accessTaskEvent.findFirst({ where: { taskId: expiry.id, type: "CANCELLED" } })).toMatchObject({
        reason: "Supplantée par un renouvellement",
      });
    }
  });

  it("Review Focus #2 — le propriétaire exécute sa propre demande : autorisé (D-7), audit selfFulfilled", async () => {
    await prisma.accessProfile.update({ where: { userId: fx.users.owner }, data: { primaryDepartmentId: fx.departmentId } });
    const final = await approvedSelfRequest(fx, fx.users.owner, fx.levels.reader);
    const taskId = await claimed(final.id, fx.users.owner);
    await completeTask(fx.orgId, fx.users.owner, taskId, { ...facts(), expectedRevision: 2 });
    const audit = await prisma.accessAuditEvent.findFirstOrThrow({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED", objectId: taskId } });
    expect(audit.after).toMatchObject({ selfFulfilled: true });
    expect((await currentAssignment(fx, fx.users.owner))?.levelId).toBe(fx.levels.reader);
  });

  it("Review Focus #3 — actif archivé : le retrait reste confirmable, un octroi est refusé", async () => {
    const empRevoke = await newEmployee(fx, "ArchRevoke");
    await giveAccess(fx, empRevoke, fx.levels.reader);
    const revoke = await approvedReduction(fx, empRevoke, null);
    const revokeTaskId = await claimed(revoke.id);
    const empGrant = await newEmployee(fx, "ArchGrant");
    const grant = await approvedSelfRequest(fx, empGrant, fx.levels.reader);
    const grantTaskId = await claimed(grant.id);

    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: new Date() } });
    try {
      await expect(
        completeTask(fx.orgId, fx.users.owner, grantTaskId, { ...facts(), expectedRevision: 2 })
      ).rejects.toMatchObject({ code: "STALE", message: "L'application a été archivée" });
      const res = await completeTask(fx.orgId, fx.users.owner, revokeTaskId, { ...facts(), expectedRevision: 2 });
      expect(res.outcome).toBe("REVOKED");
    } finally {
      await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: null } });
    }
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts`
Expected: FAIL — `completeTask` non exporté.

- [ ] **Step 3: Implémenter dans `lib/access/fulfilment-server.ts`**

(a) Remplacer l'import de `./fulfilment` par :

```ts
import {
  ASSIGNMENT_CHANGED_REASON,
  PARTIAL_REMOVAL_REASON,
  SUPERSEDED_REASON,
  assignmentEffect,
  outcomeFor,
  ownerRoleFor,
  partialRemovalEffect,
  readOldRemovedAt,
  taskActionForKind,
  validateCompletionInput,
  type AssignmentSnapshot,
  type AssignmentWrite,
  type CompletionMethod,
  type OwnerRole,
  type TaskOutcome,
  type TaskState,
} from "./fulfilment";
```

(b) Ajouter à la fin du fichier :

```ts

// ── Confirmer (D-9, D-10, D-23) ──────────────────────────────────────────

export interface CompleteTaskInput {
  completedAt: Date;
  reference: string | null;
  note: string | null;
  method?: CompletionMethod;
  partialRemovalOnly?: boolean;
  expectedRevision: number;
}

export interface CompletionResultDTO {
  taskId: string;
  state: TaskState;
  revision: number;
  outcome: TaskOutcome | null;
  assignmentVersion: number;
  /** true = confirmation rejouée à l'identique : aucune écriture (FP:241, A17). */
  replayed: boolean;
}

function normalize(text: string | null | undefined): string | null {
  const t = text?.trim() ?? "";
  return t ? t : null;
}

/** Écrit l'affectation courante (compare-and-swap sur `version`) et son événement. */
async function writeAssignmentInTx(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    task: { id: string; beneficiaryId: string; assetId: string; expectedAssignmentVersion: number };
    current: { id: string; levelId: string | null } | null;
    write: AssignmentWrite;
    actorId: string;
    outcome: string;
    confirmsGrant: boolean;
  }
): Promise<number> {
  const data = {
    levelId: input.write.levelId,
    status: input.write.status,
    periodStart: input.write.periodStart,
    periodEnd: input.write.periodEnd,
    revokedAt: input.write.revokedAt,
    ...(input.write.grantedAt ? { grantedAt: input.write.grantedAt } : {}),
    ...(input.confirmsGrant ? { source: "REQUEST" as const, verification: "OWNER_CONFIRMED" as const } : {}),
  };
  let assignmentId: string;
  let newVersion: number;
  if (!input.current) {
    // Une création concurrente pour le même couple lève P2002 (unique
    // userId+assetId) → traduit en STALE par runTaskTx.
    const created = await tx.accessAssignment.create({
      data: { orgId: input.orgId, userId: input.task.beneficiaryId, assetId: input.task.assetId, ...data, version: 1 },
    });
    assignmentId = created.id;
    newVersion = 1;
  } else {
    const { count } = await tx.accessAssignment.updateMany({
      where: { id: input.current.id, version: input.task.expectedAssignmentVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) throw new FulfilmentError("STALE", ASSIGNMENT_CHANGED_REASON);
    assignmentId = input.current.id;
    newVersion = input.task.expectedAssignmentVersion + 1;
  }
  await tx.accessAssignmentEvent.create({
    data: {
      orgId: input.orgId,
      assignmentId,
      userId: input.task.beneficiaryId,
      assetId: input.task.assetId,
      beforeLevelId: input.current?.levelId ?? null,
      afterLevelId: input.write.levelId,
      actorId: input.actorId,
      actorRole: null,
      sourceType: "FULFILMENT",
      sourceId: input.task.id,
      outcome: input.outcome,
    },
  });
  return newVersion;
}

/**
 * D-23 / FP:231 : une confirmation d'octroi/renouvellement supplante
 * atomiquement une tâche d'expiration NON réclamée de la même affectation ;
 * une tâche d'expiration réclamée/bloquée impose une réconciliation.
 */
async function supersedeExpiryTasksInTx(
  tx: Prisma.TransactionClient,
  input: { orgId: string; actorId: string; actor: ActorContext; assignmentId: string; correlationId: string | null }
): Promise<void> {
  const open = await tx.accessFulfilmentTask.findMany({
    where: {
      orgId: input.orgId,
      sourceAssignmentId: input.assignmentId,
      action: "EXPIRY_REMOVAL",
      state: { in: ["READY", "CLAIMED", "BLOCKED"] },
    },
  });
  for (const expiry of open) {
    const { count } =
      expiry.state === "READY"
        ? await tx.accessFulfilmentTask.updateMany({
            where: { id: expiry.id, state: "READY" },
            data: { state: "CANCELLED", outcome: "SUPERSEDED", revision: { increment: 1 } },
          })
        : { count: 0 };
    if (count === 0) throw new FulfilmentError("STALE", "Un retrait est en cours — à réconcilier");
    await tx.accessTaskEvent.create({
      data: {
        orgId: input.orgId,
        taskId: expiry.id,
        type: "CANCELLED",
        actorId: input.actorId,
        actingAs: input.actor.actingAs,
        reason: SUPERSEDED_REASON,
      },
    });
    await auditTaskInTx(tx, {
      orgId: input.orgId,
      actorId: input.actorId,
      actor: input.actor,
      task: expiry,
      eventType: "TASK_CANCELLED",
      objectVersion: expiry.revision + 1,
      before: { state: "READY" },
      after: { state: "CANCELLED", outcome: "SUPERSEDED" },
      reason: SUPERSEDED_REASON,
      correlationId: input.correlationId,
    });
  }
}

export async function completeTask(
  orgId: string,
  actorId: string,
  taskId: string,
  input: CompleteTaskInput,
  opts: TaskMutationOptions = {}
): Promise<CompletionResultDTO> {
  const now = opts.now ?? new Date();
  const reference = normalize(input.reference);
  const note = normalize(input.note);
  const correlationId = opts.correlationId ?? null;

  return runTaskTx(async (tx) => {
    const { task, actor } = await loadTaskForActor(tx, orgId, actorId, taskId);

    // Rejeu (double clic, nouvelle tentative réseau) : même acteur, mêmes
    // faits → résultat enregistré, aucune écriture (FP:241, A17).
    if (task.state === "COMPLETED") {
      const sameFacts =
        task.completedById === actorId &&
        task.completedAt?.getTime() === input.completedAt.getTime() &&
        task.completionReference === reference &&
        task.completionNote === note;
      if (!sameFacts) throw new FulfilmentError("INVALID_TRANSITION", "Cette tâche est déjà exécutée");
      return {
        taskId: task.id,
        state: "COMPLETED",
        revision: task.revision,
        outcome: task.outcome as TaskOutcome,
        assignmentVersion: task.expectedAssignmentVersion + 1,
        replayed: true,
      };
    }
    if (task.state === "READY") throw new FulfilmentError("INVALID_TRANSITION", "Réclamez la tâche avant de la confirmer");
    if (task.state === "BLOCKED") throw new FulfilmentError("INVALID_TRANSITION", "Reprenez la tâche avant de la confirmer");
    if (task.state !== "CLAIMED") throw new FulfilmentError("INVALID_TRANSITION", "Cette tâche est annulée");
    assertClaimant(task, actorId, "Cette tâche est détenue par un autre propriétaire");
    assertRevision(task, input.expectedRevision);

    const factsError = validateCompletionInput(
      { completedAt: input.completedAt, reference, note },
      { now, claimedAt: task.claimedAt }
    );
    if (factsError) throw new FulfilmentError("VALIDATION", factsError);
    const oldRemoved = readOldRemovedAt(task.progress) !== null;
    if (task.action === "CHANGE_LEVEL" && !oldRemoved && !input.method) {
      throw new FulfilmentError("VALIDATION", "Indiquez la méthode de remplacement (directe ou retrait puis octroi)");
    }
    if (input.partialRemovalOnly && (task.action !== "CHANGE_LEVEL" || input.method !== "REMOVE_THEN_GRANT" || oldRemoved)) {
      throw new FulfilmentError(
        "VALIDATION",
        "« Seul l'ancien niveau a été retiré » ne s'applique qu'à un changement de niveau par retrait puis octroi"
      );
    }

    const stale = await revalidateTask(tx, task, now);
    if (stale) throw new FulfilmentError("STALE", stale);

    const current = await tx.accessAssignment.findFirst({
      where: { orgId, userId: task.beneficiaryId, assetId: task.assetId },
    });
    const snapshot: AssignmentSnapshot | null = current
      ? { status: current.status, levelId: current.levelId, periodStart: current.periodStart, periodEnd: current.periodEnd }
      : null;
    const terms = {
      fromLevelId: task.fromLevelId,
      toLevelId: task.toLevelId,
      periodStart: task.periodStart,
      periodEnd: task.periodEnd,
      oldRemoved,
    };
    const facts = { completedAt: input.completedAt.toISOString(), reference, note, method: input.method ?? null };

    // Étape 1 seule d'un REMOVE_THEN_GRANT (D-10, A18) : « aucun accès » et
    // travail bloqué, jamais un faux succès.
    if (input.partialRemovalOnly) {
      const effect = partialRemovalEffect(snapshot, terms, input.completedAt);
      if (!effect.ok || !current) throw new FulfilmentError("STALE", ASSIGNMENT_CHANGED_REASON);
      const newAssignmentVersion = task.expectedAssignmentVersion + 1;
      await moveVersionInTx(tx, task.requestVersionId, ["IN_PROGRESS"], { state: "BLOCKED" });
      const { count } = await tx.accessFulfilmentTask.updateMany({
        where: { id: task.id, state: "CLAIMED", claimantId: actorId, revision: input.expectedRevision },
        data: {
          state: "BLOCKED",
          blockedReason: PARTIAL_REMOVAL_REASON,
          progress: { oldRemovedAt: input.completedAt.toISOString() },
          completionMethod: "REMOVE_THEN_GRANT",
          expectedAssignmentVersion: newAssignmentVersion,
          revision: { increment: 1 },
        },
      });
      if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);
      await writeAssignmentInTx(tx, {
        orgId,
        task,
        current,
        write: effect.write,
        actorId,
        outcome: "OLD_LEVEL_REMOVED",
        confirmsGrant: false,
      });
      await tx.accessTaskEvent.create({
        data: { orgId, taskId: task.id, type: "PARTIAL_REMOVAL", actorId, actingAs: actor.actingAs, facts },
      });
      await auditTaskInTx(tx, {
        orgId,
        actorId,
        actor,
        task,
        eventType: "TASK_PARTIAL_REMOVAL",
        objectVersion: input.expectedRevision + 1,
        before: { state: "CLAIMED", levelId: current.levelId, assignmentVersion: task.expectedAssignmentVersion },
        after: { state: "BLOCKED", levelId: null, assignmentVersion: newAssignmentVersion, ...facts },
        reason: null,
        correlationId,
      });
      return {
        taskId: task.id,
        state: "BLOCKED",
        revision: input.expectedRevision + 1,
        outcome: null,
        assignmentVersion: newAssignmentVersion,
        replayed: false,
      };
    }

    const effect = assignmentEffect(task.action, snapshot, terms, input.completedAt);
    if (!effect.ok) throw new FulfilmentError("STALE", effect.reason);
    const outcome = outcomeFor(task.action);

    // Ordre de verrouillage : version → tâche → expiration supplantée → affectation.
    await moveVersionInTx(tx, task.requestVersionId, ["IN_PROGRESS"], {
      state: "COMPLETED",
      outcome,
      completedAt: input.completedAt,
    });
    if (task.requestVersion) {
      await tx.accessRequest.update({ where: { id: task.requestVersion.requestId }, data: { closedAt: now } });
    }
    const { count } = await tx.accessFulfilmentTask.updateMany({
      where: { id: task.id, state: "CLAIMED", claimantId: actorId, revision: input.expectedRevision },
      data: {
        state: "COMPLETED",
        completedAt: input.completedAt,
        completionReference: reference,
        completionNote: note,
        completionMethod: input.method ?? null,
        completedById: actorId,
        outcome,
        revision: { increment: 1 },
      },
    });
    if (count === 0) throw new FulfilmentError("STALE", STALE_MESSAGE);
    if (current && (task.action === "GRANT" || task.action === "RENEW")) {
      await supersedeExpiryTasksInTx(tx, { orgId, actorId, actor, assignmentId: current.id, correlationId });
    }
    const assignmentVersion = await writeAssignmentInTx(tx, {
      orgId,
      task,
      current,
      write: effect.write,
      actorId,
      outcome,
      confirmsGrant: task.action === "GRANT" || task.action === "CHANGE_LEVEL" || task.action === "RENEW",
    });

    await tx.accessTaskEvent.create({
      data: { orgId, taskId: task.id, type: "COMPLETED", actorId, actingAs: actor.actingAs, facts },
    });
    await auditTaskInTx(tx, {
      orgId,
      actorId,
      actor,
      task,
      eventType: "TASK_COMPLETED",
      objectVersion: input.expectedRevision + 1,
      before: { state: "CLAIMED", levelId: current?.levelId ?? null, assignmentVersion: current?.version ?? 0 },
      after: {
        state: "COMPLETED",
        outcome,
        levelId: effect.write.levelId,
        assignmentVersion,
        selfFulfilled: actorId === task.beneficiaryId,
        ...facts,
      },
      reason: null,
      correlationId,
    });
    return {
      taskId: task.id,
      state: "COMPLETED",
      revision: input.expectedRevision + 1,
      outcome,
      assignmentVersion,
      replayed: false,
    };
  });
}
```

- [ ] **Step 4: Vérifier (cinq fois : deux tests de concurrence)**

Run: `for i in 1 2 3 4 5; do npx vitest run tests/unit/access-db/fulfilment-server.test.ts | grep -E "Tests |FAIL"; done && npx tsc --noEmit`
Expected: cinq fois `Tests  36 passed (36)`, aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/fulfilment-server.ts tests/unit/access-db/fulfilment-server.test.ts
git commit -m "feat(access): confirmer une tâche — affectation courante atomique, rejeu idempotent, remplacement en deux temps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9 : Lots — réclamer et confirmer

**Files:**
- Modify: `lib/access/fulfilment-server.ts` (import + ajout en fin de fichier)
- Test: `tests/unit/access-db/fulfilment-server.test.ts`

**Interfaces:**
- Consumes: `claimTask`, `completeTask`, `CompleteTaskInput`, `FulfilmentError`, `FulfilmentErrorCode`.
- Produces:
  - `interface BatchItemResult { taskId: string; ok: boolean; error: string | null; code: FulfilmentErrorCode | null }`
  - `interface BatchResultDTO { correlationId: string; results: BatchItemResult[] }`
  - `claimTasksBatch(orgId, actorId, items: { taskId: string; expectedRevision: number }[]): Promise<BatchResultDTO>`
  - `completeTasksBatch(orgId, actorId, items: (Omit<CompleteTaskInput, "partialRemovalOnly"> & { taskId: string })[]): Promise<BatchResultDTO>`

Pas d'entité `Batch` persistante (D-13) : un appel = un `correlationId` (uuid) écrit dans l'audit de chaque élément réussi. La limite de 100 éléments est portée par les schémas Zod (Tâche 2).

- [ ] **Step 1: Écrire les tests**

Dans `tests/unit/access-db/fulfilment-server.test.ts`, ajouter `claimTasksBatch` et `completeTasksBatch` à l'import de `@/lib/access/fulfilment-server`, puis ajouter à la fin du fichier :

```ts

describe("fulfilment-server — lots (D-13, FP:252/254, A17)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("batch");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  async function readyTaskId(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return { emp, taskId: (await taskForVersion(final.id)).id };
  }

  it("réclamer en lot : résultat par élément, un élément hors périmètre n'empêche pas les autres, correlationId commun dans l'audit", async () => {
    const a = await readyTaskId("BatchA");
    const b = await readyTaskId("BatchB");
    const res = await claimTasksBatch(fx.orgId, fx.users.owner, [
      { taskId: a.taskId, expectedRevision: 1 },
      { taskId: "id-inexistant", expectedRevision: 1 },
      { taskId: b.taskId, expectedRevision: 1 },
    ]);
    expect(res.results).toEqual([
      { taskId: a.taskId, ok: true, error: null, code: null },
      { taskId: "id-inexistant", ok: false, error: "Tâche introuvable", code: "NOT_FOUND" },
      { taskId: b.taskId, ok: true, error: null, code: null },
    ]);
    const audits = await prisma.accessAuditEvent.findMany({ where: { orgId: fx.orgId, eventType: "TASK_CLAIMED" } });
    expect(audits.map((x) => x.correlationId)).toEqual([res.correlationId, res.correlationId]);
  });

  it("confirmer en lot : chaque élément porte sa propre preuve ; un échec n'annule pas les succès ; un nouvel essai ne duplique rien", async () => {
    const a = await readyTaskId("DoneA");
    const b = await readyTaskId("DoneB");
    await claimTasksBatch(fx.orgId, fx.users.owner, [
      { taskId: a.taskId, expectedRevision: 1 },
      { taskId: b.taskId, expectedRevision: 1 },
    ]);
    const completedAt = new Date(Date.now() - 1_000);
    const items = [
      { taskId: a.taskId, completedAt, reference: "REF-A", note: null, expectedRevision: 2 },
      { taskId: b.taskId, completedAt, reference: "REF-B", note: null, expectedRevision: 99 },
    ];
    const first = await completeTasksBatch(fx.orgId, fx.users.owner, items);
    expect(first.results.map((r) => [r.ok, r.code])).toEqual([[true, null], [false, "STALE"]]);
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: a.taskId } })).completionReference).toBe("REF-A");

    // Nouvel essai de tout le lot, B corrigé : A est rejouée sans écriture, B aboutit.
    const retry = await completeTasksBatch(fx.orgId, fx.users.owner, [items[0], { ...items[1], expectedRevision: 2 }]);
    expect(retry.results.every((r) => r.ok)).toBe(true);
    expect(await prisma.accessAssignmentEvent.count({ where: { orgId: fx.orgId, userId: a.emp } })).toBe(1);
    expect(await prisma.accessAssignmentEvent.count({ where: { orgId: fx.orgId, userId: b.emp } })).toBe(1);
    const completedAudits = await prisma.accessAuditEvent.findMany({ where: { orgId: fx.orgId, eventType: "TASK_COMPLETED" } });
    expect(completedAudits.map((x) => x.correlationId).sort()).toEqual([first.correlationId, retry.correlationId].sort());
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts`
Expected: FAIL — `claimTasksBatch`, `completeTasksBatch` non exportés.

- [ ] **Step 3: Implémenter dans `lib/access/fulfilment-server.ts`**

(a) Ajouter en première ligne d'import :

```ts
import { randomUUID } from "node:crypto";
```

(b) Ajouter à la fin du fichier :

```ts

// ── Lots (D-13) ──────────────────────────────────────────────────────────

export interface BatchItemResult {
  taskId: string;
  ok: boolean;
  error: string | null;
  code: FulfilmentErrorCode | null;
}

export interface BatchResultDTO {
  correlationId: string;
  results: BatchItemResult[];
}

function toBatchFailure(taskId: string, err: unknown): BatchItemResult {
  if (err instanceof FulfilmentError) return { taskId, ok: false, error: err.message, code: err.code };
  return { taskId, ok: false, error: "Erreur inattendue", code: null };
}

/**
 * Chaque élément est indépendant (FP:252) : une transaction par élément, un
 * échec n'affecte aucun autre élément. Un `correlationId` commun à l'appel
 * est écrit dans l'audit de chaque élément (FP:348).
 */
export async function claimTasksBatch(
  orgId: string,
  actorId: string,
  items: { taskId: string; expectedRevision: number }[]
): Promise<BatchResultDTO> {
  const correlationId = randomUUID();
  const results: BatchItemResult[] = [];
  for (const item of items) {
    try {
      await claimTask(orgId, actorId, item.taskId, item.expectedRevision, { correlationId });
      results.push({ taskId: item.taskId, ok: true, error: null, code: null });
    } catch (err) {
      results.push(toBatchFailure(item.taskId, err));
    }
  }
  return { correlationId, results };
}

export async function completeTasksBatch(
  orgId: string,
  actorId: string,
  items: (Omit<CompleteTaskInput, "partialRemovalOnly"> & { taskId: string })[]
): Promise<BatchResultDTO> {
  const correlationId = randomUUID();
  const results: BatchItemResult[] = [];
  for (const { taskId, ...input } of items) {
    try {
      await completeTask(orgId, actorId, taskId, input, { correlationId });
      results.push({ taskId, ok: true, error: null, code: null });
    } catch (err) {
      results.push(toBatchFailure(taskId, err));
    }
  }
  return { correlationId, results };
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-db/fulfilment-server.test.ts && npx tsc --noEmit`
Expected: PASS (38 tests), aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/fulfilment-server.ts tests/unit/access-db/fulfilment-server.test.ts
git commit -m "feat(access): réclamer et confirmer en lot, résultat par élément et corrélation d'audit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10 : Lecture des tâches — liste « mes actifs » et supervision

**Files:**
- Create: `lib/access/fulfilment-read-server.ts`
- Test: `tests/unit/access-db/fulfilment-read-server.test.ts`

**Interfaces:**
- Consumes: `getFulfilmentAssetIds`, `revalidateTask`, `FulfilmentError` (Tâches 3, 6) ; `fulfilmentNavFlags`, `ownerRoleFor`, `readOldRemovedAt`, `shortTaskReference`, `OPEN_TASK_STATES`, `CLOSED_TASK_STATES`, `EXPIRY_OWNER_REASON` (Tâche 2) ; `getEffectiveRoleHolders(orgId, userId)` (`roles-server.ts`) ; `getOwnedAssetIds(orgId, userId)` (`register-server.ts`) ; `resolveReadScopes(userId, roles, ownedAssetIds)` (`scope.ts`).
- Produces:
  - `interface FulfilmentTaskDTO` (tous les champs ci-dessous, dates en chaîne ISO), `TaskEventDTO`, `ApprovalSummaryItem`, `ViewerActions { claim, complete, block, resume, handover, reconcile }`
  - `interface FulfilmentNav { hasMine: boolean; canOversee: boolean }` ; `getFulfilmentNav(orgId, userId): Promise<FulfilmentNav>`
  - `interface TaskListQuery { view: "mine" | "oversight"; state: "open" | "history"; assetId?: string; page: number; pageSize: number }`
  - `listFulfilmentTasks(viewer: { orgId; userId }, query: TaskListQuery, now?: Date): Promise<{ rows: FulfilmentTaskDTO[]; total: number }>` — hors portée → `FulfilmentError("NOT_FOUND")`.

- [ ] **Step 1: Écrire les tests**

```ts
// tests/unit/access-db/fulfilment-read-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { decideStage, submitRequest } from "@/lib/access/requests-server";
import { FulfilmentError } from "@/lib/access/fulfilment-server";
import { getFulfilmentNav, listFulfilmentTasks, type TaskListQuery } from "@/lib/access/fulfilment-read-server";
import {
  approvedReduction,
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  giveAccess,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

const open: TaskListQuery = { view: "mine", state: "open", page: 1, pageSize: 25 };

async function expectNotFound(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(FulfilmentError);
  await expect(p).rejects.toMatchObject({ code: "NOT_FOUND" });
}

describe("fulfilment-read-server — visibilité des tâches (D-6, D-14, A05)", () => {
  let fx: FulfilmentFixture;

  beforeAll(async () => {
    fx = await createFulfilmentFixture("read");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("A05 : une demande en attente n'apparaît jamais chez le propriétaire, ni dans le total ; après approbation, oui", async () => {
    const emp = await newEmployee(fx, "A05");
    const pending = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "en attente",
    });
    const before = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, open);
    expect(before.rows.some((r) => r.beneficiaryId === emp)).toBe(false);
    const totalBefore = before.total;

    // Approbation : chef puis CISO (la version en attente devient autorisée).
    const afterHead = await decideStage(fx.orgId, fx.users.deptHead, pending.stages[0].id, "APPROVE", null);
    await decideStage(fx.orgId, fx.users.ciso, afterHead.stages[1].id, "APPROVE", null);

    const after = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, open);
    expect(after.total).toBe(totalBefore + 1);
    const row = after.rows.find((r) => r.beneficiaryId === emp)!;
    expect(row).toMatchObject({
      state: "READY",
      action: "GRANT",
      beneficiaryName: "A05",
      assetName: "Asset read",
      toLevelName: "Reader",
      fromLevelName: null,
      ownerReason: "en attente",
      viewerRole: "ASSET_OWNER",
      hasOwner: true,
      staleReason: null,
    });
    expect(row.departmentName).toBe("Dept read");
    expect(row.viewerCan).toEqual({ claim: true, complete: false, block: false, resume: false, handover: false, reconcile: false });
    // Résumé d'approbation : rôle, décision, date — jamais de motif interne.
    expect(row.approvalSummary.map((s) => [s.role, s.decision])).toEqual([["DEPARTMENT_HEAD", "APPROVE"], ["CISO", "APPROVE"]]);
    expect(Object.keys(row.approvalSummary[0]).sort()).toEqual(["decidedAt", "decision", "role"]);
    expect(row.reference).toMatch(/^EX-[A-Z0-9]{6}$/);
  });

  it("le suppléant voit la même tâche (rôle suppléant) ; un tiers → 404 ; un filtre d'actif hors périmètre → 404", async () => {
    const emp = await newEmployee(fx, "Backup");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    const task = await taskForVersion(final.id);
    const backupView = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.backup }, open);
    expect(backupView.rows.find((r) => r.id === task.id)?.viewerRole).toBe("ASSET_OWNER_BACKUP");
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.stranger }, open));
    const other = await prisma.accessAsset.create({ data: { orgId: fx.orgId, name: "Autre appli" } });
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, { ...open, assetId: other.id }));
    await prisma.accessAsset.delete({ where: { id: other.id } });
  });

  it("supervision : CISO/COO voient tout en lecture seule, y compris « aucun propriétaire » ; le propriétaire n'y a pas accès", async () => {
    const orphan = await prisma.accessAsset.create({ data: { orgId: fx.orgId, name: "Sans propriétaire", requestsEnabled: true } });
    const orphanLevel = await prisma.accessLevel.create({ data: { assetId: orphan.id, name: "Base", priority: 1, isAdmin: false } });
    // Exception COO : autorisée d'emblée, sans étape.
    const coo = await submitRequest(fx.orgId, fx.users.coo, {
      beneficiaryId: fx.users.coo, assetId: orphan.id, targetLevelId: orphanLevel.id, justification: "COO",
    });
    expect(coo.state).toBe("READY_FOR_FULFILMENT");
    const oversight = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.ciso }, { ...open, view: "oversight" });
    const row = oversight.rows.find((r) => r.assetId === orphan.id)!;
    expect(row).toMatchObject({ hasOwner: false, viewerRole: null, approvalException: "COO_SELF_REQUEST" });
    expect(Object.values(row.viewerCan).every((v) => v === false)).toBe(true);
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, { ...open, view: "oversight" }));
    await expectNotFound(listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.ciso }, open));
  });

  it("Review Focus #3 — une tâche de retrait sur un actif ARCHIVÉ reste visible et réclamable par le propriétaire (FP:110)", async () => {
    const emp = await newEmployee(fx, "Archive");
    await giveAccess(fx, emp, fx.levels.reader);
    const final = await approvedReduction(fx, emp, null);
    const task = await taskForVersion(final.id);
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: new Date() } });
    const view = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, open);
    const row = view.rows.find((r) => r.id === task.id)!;
    await prisma.accessAsset.update({ where: { id: fx.assetId }, data: { archivedAt: null } });
    expect(row).toMatchObject({ action: "REVOKE", assetArchived: true, staleReason: null });
    expect(row.viewerCan.claim).toBe(true);
  });

  it("getFulfilmentNav : propriétaire (à faire), CISO (supervision), tiers (rien)", async () => {
    expect(await getFulfilmentNav(fx.orgId, fx.users.owner)).toEqual({ hasMine: true, canOversee: false });
    expect(await getFulfilmentNav(fx.orgId, fx.users.ciso)).toEqual({ hasMine: false, canOversee: true });
    expect(await getFulfilmentNav(fx.orgId, fx.users.stranger)).toEqual({ hasMine: false, canOversee: false });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-read-server.test.ts`
Expected: FAIL — module `@/lib/access/fulfilment-read-server` introuvable.

- [ ] **Step 3: Créer `lib/access/fulfilment-read-server.ts`**

```ts
// lib/access/fulfilment-read-server.ts
// Lecture des tâches d'exécution (phase 3b, D-6, D-14, D-15). Portée
// recalculée en base à chaque appel, filtrée AVANT pagination et totaux
// (FP:98). Hors portée → FulfilmentError NOT_FOUND (404), jamais une liste
// vide qui laisserait deviner l'existence de tâches.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAvailable } from "./roles";
import { getEffectiveRoleHolders } from "./roles-server";
import { getOwnedAssetIds } from "./register-server";
import { resolveReadScopes } from "./scope";
import {
  CLOSED_TASK_STATES,
  EXPIRY_OWNER_REASON,
  OPEN_TASK_STATES,
  fulfilmentNavFlags,
  ownerRoleFor,
  readOldRemovedAt,
  shortTaskReference,
  type OwnerRole,
  type TaskAction,
  type TaskState,
} from "./fulfilment";
import { FulfilmentError, getFulfilmentAssetIds, revalidateTask } from "./fulfilment-server";

export interface TaskEventDTO {
  type: string;
  actorName: string | null;
  actingAs: string | null;
  toUserName: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface ApprovalSummaryItem {
  role: string;
  decision: string;
  decidedAt: string | null;
}

export interface ViewerActions {
  claim: boolean;
  complete: boolean;
  block: boolean;
  resume: boolean;
  handover: boolean;
  reconcile: boolean;
}

/**
 * DTO propriétaire (D-6, D-16) : uniquement du travail AUTORISÉ, jamais une
 * version en attente/rejetée ni un compte de celles-ci (A05, FP:255). Aucun
 * motif interne d'approbation (résumé = rôle, décision, date), aucun fait
 * interne de blocage (seul le motif). `ownerReason` est le seul texte de
 * justification exposé. Dates en chaîne ISO (frontière Server → Client).
 */
export interface FulfilmentTaskDTO {
  id: string;
  reference: string;
  revision: number;
  state: TaskState;
  action: TaskAction;
  assetId: string;
  assetName: string;
  assetArchived: boolean;
  hasOwner: boolean;
  beneficiaryId: string;
  beneficiaryName: string;
  departmentName: string | null;
  fromLevelName: string | null;
  toLevelName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  releasedAt: string;
  approvalSummary: ApprovalSummaryItem[];
  approvalException: string | null;
  ownerReason: string;
  claimantId: string | null;
  claimantName: string | null;
  blockedReason: string | null;
  oldRemovedAt: string | null;
  cancelRequested: boolean;
  staleReason: string | null;
  completedAt: string | null;
  completionReference: string | null;
  completionNote: string | null;
  completionMethod: string | null;
  outcome: string | null;
  events: TaskEventDTO[];
  viewerRole: OwnerRole | null;
  viewerCan: ViewerActions;
  handoverCandidates: { id: string; name: string }[];
}

export interface FulfilmentNav {
  hasMine: boolean;
  canOversee: boolean;
}

export async function getFulfilmentNav(orgId: string, userId: string): Promise<FulfilmentNav> {
  const [roles, ownedAssetIds, fulfilmentAssetIds] = await Promise.all([
    getEffectiveRoleHolders(orgId, userId),
    getOwnedAssetIds(orgId, userId),
    getFulfilmentAssetIds(prisma, orgId, userId),
  ]);
  const flags = fulfilmentNavFlags(resolveReadScopes(userId, roles, ownedAssetIds), fulfilmentAssetIds);
  return { hasMine: flags.hasMineView, canOversee: flags.canOversee };
}

export interface TaskListQuery {
  view: "mine" | "oversight";
  state: "open" | "history";
  assetId?: string;
  page: number;
  pageSize: number;
}

const LIST_INCLUDE = {
  asset: {
    select: { id: true, name: true, ownerId: true, backupOwnerId: true, archivedAt: true, catalogueVersion: true },
  },
  requestVersion: { include: { stages: { orderBy: { sequence: "asc" } } } },
  events: { orderBy: { occurredAt: "asc" } },
} satisfies Prisma.AccessFulfilmentTaskInclude;

const NO_ACTIONS: ViewerActions = {
  claim: false,
  complete: false,
  block: false,
  resume: false,
  handover: false,
  reconcile: false,
};

const NOT_FOUND = () => new FulfilmentError("NOT_FOUND", "Introuvable");

export async function listFulfilmentTasks(
  viewer: { orgId: string; userId: string },
  query: TaskListQuery,
  now: Date = new Date()
): Promise<{ rows: FulfilmentTaskDTO[]; total: number }> {
  const { orgId, userId } = viewer;

  let scope: Prisma.AccessFulfilmentTaskWhereInput;
  if (query.view === "mine") {
    const assetIds = await getFulfilmentAssetIds(prisma, orgId, userId);
    if (assetIds.length === 0) throw NOT_FOUND();
    if (query.assetId && !assetIds.includes(query.assetId)) throw NOT_FOUND();
    scope = { assetId: { in: query.assetId ? [query.assetId] : assetIds } };
  } else {
    const roles = await getEffectiveRoleHolders(orgId, userId);
    if (!resolveReadScopes(userId, roles, []).some((s) => s.kind === "ALL")) throw NOT_FOUND();
    scope = query.assetId ? { assetId: query.assetId } : {};
  }

  const states = query.state === "open" ? [...OPEN_TASK_STATES] : [...CLOSED_TASK_STATES];
  const where: Prisma.AccessFulfilmentTaskWhereInput = { orgId, AND: [scope, { state: { in: states } }] };
  const orderBy: Prisma.AccessFulfilmentTaskOrderByWithRelationInput[] =
    query.state === "open" ? [{ releasedAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }];

  const [total, tasks] = await prisma.$transaction([
    prisma.accessFulfilmentTask.count({ where }),
    prisma.accessFulfilmentTask.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: LIST_INCLUDE,
    }),
  ]);

  const userIds = new Set<string>();
  const levelIds = new Set<string>();
  for (const t of tasks) {
    userIds.add(t.beneficiaryId);
    for (const id of [t.claimantId, t.asset.ownerId, t.asset.backupOwnerId]) if (id) userIds.add(id);
    for (const e of t.events) {
      if (e.actorId) userIds.add(e.actorId);
      if (e.toUserId) userIds.add(e.toUserId);
    }
    for (const id of [t.fromLevelId, t.toLevelId]) if (id) levelIds.add(id);
  }
  const [users, levels] = await Promise.all([
    prisma.user.findMany({
      where: { orgId, id: { in: [...userIds] } },
      select: {
        id: true,
        name: true,
        isActive: true,
        accessProfile: { select: { lifecycle: true, primaryDepartment: { select: { name: true } } } },
      },
    }),
    prisma.accessLevel.findMany({ where: { id: { in: [...levelIds] } }, select: { id: true, name: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const levelNameById = new Map(levels.map((l) => [l.id, l.name]));
  const nameOf = (id: string | null) => (id ? userById.get(id)?.name ?? null : null);
  const available = (id: string) => {
    const u = userById.get(id);
    return !!u && isAvailable({ userId: id, isActive: u.isActive, lifecycle: u.accessProfile?.lifecycle ?? null });
  };

  const rows = await Promise.all(
    tasks.map(async (t): Promise<FulfilmentTaskDTO> => {
      const open = t.state === "READY" || t.state === "CLAIMED" || t.state === "BLOCKED";
      const staleReason = open ? await revalidateTask(prisma, t, now) : null;
      const oldRemovedAt = readOldRemovedAt(t.progress);
      const cancelRequested = t.requestVersion?.cancelRequestedAt != null;
      const viewerRole = query.view === "mine" ? ownerRoleFor(t.asset, userId) : null;
      const handoverCandidates = [t.asset.ownerId, t.asset.backupOwnerId]
        .filter((id): id is string => id !== null && id !== t.claimantId && available(id))
        .map((id) => ({ id, name: nameOf(id) ?? "?" }));
      const isClaimant = t.claimantId === userId;
      // Confort d'affichage seulement : chaque service revérifie tout.
      const viewerCan: ViewerActions = viewerRole
        ? {
            claim: t.state === "READY" && staleReason === null,
            complete: t.state === "CLAIMED" && isClaimant,
            block: t.state === "CLAIMED" && isClaimant,
            resume: t.state === "BLOCKED",
            handover: (t.state === "CLAIMED" || t.state === "BLOCKED") && handoverCandidates.length > 0,
            reconcile:
              (t.state === "CLAIMED" || t.state === "BLOCKED") &&
              isClaimant &&
              oldRemovedAt === null &&
              (cancelRequested || staleReason !== null),
          }
        : NO_ACTIONS;
      const beneficiary = userById.get(t.beneficiaryId);
      return {
        id: t.id,
        reference: shortTaskReference(t.id),
        revision: t.revision,
        state: t.state,
        action: t.action,
        assetId: t.assetId,
        assetName: t.asset.name,
        assetArchived: t.asset.archivedAt !== null,
        hasOwner: t.asset.ownerId !== null || t.asset.backupOwnerId !== null,
        beneficiaryId: t.beneficiaryId,
        beneficiaryName: beneficiary?.name ?? "?",
        departmentName: beneficiary?.accessProfile?.primaryDepartment?.name ?? null,
        fromLevelName: t.fromLevelId ? levelNameById.get(t.fromLevelId) ?? "?" : null,
        toLevelName: t.toLevelId ? levelNameById.get(t.toLevelId) ?? "?" : null,
        periodStart: t.periodStart?.toISOString() ?? null,
        periodEnd: t.periodEnd?.toISOString() ?? null,
        releasedAt: t.releasedAt.toISOString(),
        approvalSummary: (t.requestVersion?.stages ?? [])
          .filter((s) => s.decision !== null)
          .map((s) => ({ role: s.role, decision: s.decision as string, decidedAt: s.decidedAt?.toISOString() ?? null })),
        approvalException: t.requestVersion?.exceptionReason ?? null,
        ownerReason: t.requestVersion ? t.requestVersion.justification : EXPIRY_OWNER_REASON,
        claimantId: t.claimantId,
        claimantName: nameOf(t.claimantId),
        blockedReason: t.blockedReason,
        oldRemovedAt,
        cancelRequested,
        staleReason,
        completedAt: t.completedAt?.toISOString() ?? null,
        completionReference: t.completionReference,
        completionNote: t.completionNote,
        completionMethod: t.completionMethod,
        outcome: t.outcome,
        events: t.events.map((e) => ({
          type: e.type,
          actorName: nameOf(e.actorId),
          actingAs: e.actingAs,
          toUserName: nameOf(e.toUserId),
          reason: e.reason,
          occurredAt: e.occurredAt.toISOString(),
        })),
        viewerRole,
        viewerCan,
        handoverCandidates,
      };
    })
  );

  return { rows, total };
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-db/fulfilment-read-server.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/fulfilment-read-server.ts tests/unit/access-db/fulfilment-read-server.test.ts
git commit -m "feat(access): lecture des tâches d'exécution — mes actifs et supervision, filtrées par portée" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11 : Processeur 5 minutes

**Files:**
- Create: `lib/access/access-processor.ts`
- Test: `tests/unit/access-db/access-processor.test.ts`

**Interfaces:**
- Consumes: `releaseTaskInTx`, `SYSTEM_ACTOR` (Tâche 3) ; `EXPIRED_BEFORE_FULFILMENT_REASON` (Tâche 2) ; `recordAuditInTx` ; `log.child(scope)` (`lib/log.ts` : `logger.error(message, fields?, error?)`) ; pour les tests : `claimTask`, `completeTask`, `listFulfilmentTasks`, `reviseRequest`.
- Produces:
  - `PROCESSOR_BATCH_SIZE = 200`
  - `interface ProcessorReport { released: number; repaired: number; expired: number; revisionRequired: number; errors: number }`
  - `runAccessProcessor(now?: Date, options?: { orgIds?: string[] }): Promise<ProcessorReport>`

Écart assumé avec la spec §6 (`runAccessProcessor(now)`) : second paramètre optionnel `{ orgIds }`, utilisé par les tests seulement — les fichiers de test tournent en parallèle sur la même base, un passage global toucherait les organisations des autres fichiers.

- [ ] **Step 1: Écrire les tests**

```ts
// tests/unit/access-db/access-processor.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { reviseRequest, submitRequest, decideStage } from "@/lib/access/requests-server";
import { claimTask, completeTask } from "@/lib/access/fulfilment-server";
import { listFulfilmentTasks } from "@/lib/access/fulfilment-read-server";
import { runAccessProcessor } from "@/lib/access/access-processor";
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  currentAssignment,
  giveAccess,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("access-processor — processeur 5 minutes (D-11, FP:229/231, A19)", () => {
  let fx: FulfilmentFixture;
  const run = (now: Date) => runAccessProcessor(now, { orgIds: [fx.orgId] });

  beforeAll(async () => {
    fx = await createFulfilmentFixture("processor");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("1. libère une version AUTHORIZED_WAITING_START à periodStart (acteur SYSTEM), une seule fois", async () => {
    const emp = await newEmployee(fx, "Start");
    const periodStart = new Date(Date.now() + HOUR);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodStart });
    expect(final.state).toBe("AUTHORIZED_WAITING_START");

    expect((await run(new Date())).released).toBe(0);
    const later = new Date(Date.now() + 2 * HOUR);
    expect(await run(later)).toMatchObject({ released: 1, errors: 0 });
    expect(await run(later)).toMatchObject({ released: 0, repaired: 0 });

    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("READY_FOR_FULFILMENT");
    const task = await taskForVersion(final.id);
    expect(task.state).toBe("READY");
    expect(await prisma.accessTaskEvent.findFirst({ where: { taskId: task.id, type: "RELEASED" } })).toMatchObject({ actorId: null, actingAs: "SYSTEM" });
    expect(
      await prisma.accessAuditEvent.findFirst({ where: { orgId: fx.orgId, eventType: "REQUEST_RELEASED", objectId: final.id } })
    ).toMatchObject({ actorId: "SYSTEM" });
  });

  it("2. auto-réparation : une version READY sans tâche (antérieure à la phase 3b) reçoit sa tâche, une seule fois", async () => {
    const emp = await newEmployee(fx, "Repair");
    const request = await prisma.accessRequest.create({ data: { orgId: fx.orgId, beneficiaryId: emp, assetId: fx.assetId } });
    const version = await prisma.accessRequestVersion.create({
      data: {
        requestId: request.id, versionNumber: 1, kind: "GRANT", initiatorId: emp, targetLevelId: fx.levels.reader,
        justification: "prête avant 3b", periodStart: new Date(Date.now() - DAY), departmentSnapshot: fx.departmentId,
        assignmentVersion: 0, catalogueVersion: 1, state: "READY_FOR_FULFILMENT",
      },
    });
    expect((await run(new Date())).repaired).toBe(1);
    expect((await run(new Date())).repaired).toBe(0);
    expect(await prisma.accessFulfilmentTask.count({ where: { requestVersionId: version.id } })).toBe(1);
  });

  it("3. expiration idempotente : 2 passages = 1 tâche de retrait ; niveau et version conservés ; rien n'est retiré", async () => {
    const emp = await newEmployee(fx, "Expire");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    const first = await run(new Date());
    const second = await run(new Date());
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);

    const after = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ status: "EXPIRED_REMOVAL_PENDING", levelId: fx.levels.reader, version: a.version });
    const tasks = await prisma.accessFulfilmentTask.findMany({ where: { sourceAssignmentId: a.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      action: "EXPIRY_REMOVAL", state: "READY", idempotencyKey: `EXP:${a.id}:${a.version}`, expectedAssignmentVersion: a.version,
    });
    expect(await prisma.accessAssignmentEvent.findFirst({ where: { assignmentId: a.id } })).toMatchObject({
      sourceType: "EXPIRY", actorId: null, beforeLevelId: fx.levels.reader, afterLevelId: fx.levels.reader,
    });
    const view = await listFulfilmentTasks({ orgId: fx.orgId, userId: fx.users.owner }, { view: "mine", state: "open", page: 1, pageSize: 100 });
    expect(view.rows.find((r) => r.id === tasks[0].id)).toMatchObject({
      action: "EXPIRY_REMOVAL", ownerReason: "Fin de période temporaire", approvalSummary: [],
    });
  });

  it("4. tâche READY à période échue → CANCELLED, version REVISION_REQUIRED, le demandeur peut réviser ; une tâche réclamée n'est pas touchée", async () => {
    const emp = await newEmployee(fx, "Overdue");
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() + HOUR) });
    const empClaimed = await newEmployee(fx, "OverdueClaimed");
    const claimedFinal = await approvedSelfRequest(fx, empClaimed, fx.levels.reader, { periodEnd: new Date(Date.now() + HOUR) });
    await claimTask(fx.orgId, fx.users.owner, (await taskForVersion(claimedFinal.id)).id, 1);

    expect((await run(new Date(Date.now() + 2 * HOUR))).revisionRequired).toBe(1);
    const task = await taskForVersion(final.id);
    expect(task).toMatchObject({ state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT" });
    expect((await prisma.accessRequestVersion.findUniqueOrThrow({ where: { id: final.id } })).state).toBe("REVISION_REQUIRED");
    expect((await taskForVersion(claimedFinal.id)).state).toBe("CLAIMED");

    const revised = await reviseRequest(fx.orgId, emp, final.id, { periodEnd: new Date(Date.now() + 30 * DAY) });
    expect(revised.state).toBe("PENDING_APPROVAL");
  });

  it("A19 — accès temporaire expiré puis renouvelé (octroi, D-23) : l'expiration non réclamée est supplantée", async () => {
    const emp = await newEmployee(fx, "Renewed");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    await run(new Date());
    const expiry = await prisma.accessFulfilmentTask.findFirstOrThrow({ where: { sourceAssignmentId: a.id } });

    const newEnd = new Date(Date.now() + 60 * DAY);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader, { periodEnd: newEnd });
    expect(final.kind).toBe("GRANT");
    const taskId = (await taskForVersion(final.id)).id;
    await claimTask(fx.orgId, fx.users.owner, taskId, 1);
    await completeTask(fx.orgId, fx.users.owner, taskId, { completedAt: new Date(), reference: "RENEW-1", note: null, expectedRevision: 2 });

    const after = await currentAssignment(fx, emp);
    expect(after).toMatchObject({ status: "ACTIVE", levelId: fx.levels.reader, version: a.version + 1 });
    expect(after?.periodEnd?.getTime()).toBe(newEnd.getTime());
    expect(await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: expiry.id } })).toMatchObject({
      state: "CANCELLED", outcome: "SUPERSEDED",
    });
    // Le passage suivant ne recrée rien : la nouvelle période n'est pas échue.
    expect((await run(new Date())).expired).toBe(0);
  });

  it("A19 — expiration déjà RÉCLAMÉE : le renouvellement est refusé et doit être réconcilié", async () => {
    const emp = await newEmployee(fx, "RenewLate");
    const a = await giveAccess(fx, emp, fx.levels.reader, { periodEnd: new Date(Date.now() - HOUR) });
    await run(new Date());
    const expiry = await prisma.accessFulfilmentTask.findFirstOrThrow({ where: { sourceAssignmentId: a.id } });
    await claimTask(fx.orgId, fx.users.backup, expiry.id, 1);

    const v = await submitRequest(fx.orgId, emp, {
      beneficiaryId: emp, assetId: fx.assetId, targetLevelId: fx.levels.reader, justification: "renouvellement",
      periodEnd: new Date(Date.now() + 60 * DAY),
    });
    const afterHead = await decideStage(fx.orgId, fx.users.deptHead, v.stages[0].id, "APPROVE", null);
    const final = await decideStage(fx.orgId, fx.users.ciso, afterHead.stages[1].id, "APPROVE", null);
    const taskId = (await taskForVersion(final.id)).id;
    await expect(claimTask(fx.orgId, fx.users.owner, taskId, 1)).rejects.toMatchObject({
      code: "STALE",
      message: "Un retrait est en cours — à réconcilier",
    });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/access-processor.test.ts`
Expected: FAIL — module `@/lib/access/access-processor` introuvable.

- [ ] **Step 3: Créer `lib/access/access-processor.ts`**

```ts
// lib/access/access-processor.ts
// Processeur 5 minutes de la gestion des accès (phase 3b, D-11, FP:229).
// Quatre devoirs idempotents, par organisation active, bornés à
// PROCESSOR_BATCH_SIZE lignes par devoir et par passage ; une transaction
// par ligne (un échec n'arrête pas le reste). Aucun appel externe, aucune
// notification (A25). Chevauchement de passages : les clés uniques
// (idempotencyKey, index partiels) et les `updateMany` conditionnels
// suffisent, pas de verrou consultatif.
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { recordAuditInTx } from "./audit-server";
import { EXPIRED_BEFORE_FULFILMENT_REASON } from "./fulfilment";
import { SYSTEM_ACTOR, releaseTaskInTx } from "./fulfilment-server";

const logger = log.child("access-processor");

export const PROCESSOR_BATCH_SIZE = 200;

export interface ProcessorReport {
  /** 1. AUTHORIZED_WAITING_START arrivées à `periodStart` → READY + tâche. */
  released: number;
  /** 2. READY_FOR_FULFILMENT sans tâche → tâche (auto-réparation, rattrapage). */
  repaired: number;
  /** 3. Affectations temporaires échues → EXPIRED_REMOVAL_PENDING + tâche de retrait. */
  expired: number;
  /** 4. Tâches READY dont la période est échue → version REVISION_REQUIRED. */
  revisionRequired: number;
  errors: number;
}

async function eachRow<T>(
  rows: T[],
  report: ProcessorReport,
  duty: string,
  fn: (row: T) => Promise<boolean>
): Promise<number> {
  let done = 0;
  for (const row of rows) {
    try {
      if (await fn(row)) done++;
    } catch (err) {
      report.errors++;
      logger.error("row failed", { duty }, err);
    }
  }
  return done;
}

async function releaseWaitingVersions(orgId: string, now: Date, report: ProcessorReport): Promise<void> {
  const versions = await prisma.accessRequestVersion.findMany({
    where: { state: "AUTHORIZED_WAITING_START", periodStart: { lte: now }, request: { orgId, closedAt: null } },
    include: { request: true },
    orderBy: { periodStart: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.released += await eachRow(versions, report, "release", (v) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.accessRequestVersion.updateMany({
        where: { id: v.id, state: "AUTHORIZED_WAITING_START" },
        data: { state: "READY_FOR_FULFILMENT", revision: { increment: 1 } },
      });
      if (count === 0) return false;
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ACCESS_REQUEST",
        scopeId: v.requestId,
        eventType: "REQUEST_RELEASED",
        objectType: "AccessRequestVersion",
        objectId: v.id,
        objectVersion: v.versionNumber,
        beneficiaryId: v.request.beneficiaryId,
        before: { state: "AUTHORIZED_WAITING_START" },
        after: { state: "READY_FOR_FULFILMENT" },
        reason: null,
        outcome: "SUCCESS",
        correlationId: null,
      });
      await releaseTaskInTx(tx, { orgId, actorId: SYSTEM_ACTOR, version: v, request: v.request });
      return true;
    })
  );
}

async function repairMissingTasks(orgId: string, report: ProcessorReport): Promise<void> {
  const versions = await prisma.accessRequestVersion.findMany({
    where: { state: "READY_FOR_FULFILMENT", fulfilmentTasks: { none: {} }, request: { orgId } },
    include: { request: true },
    orderBy: { updatedAt: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.repaired += await eachRow(versions, report, "repair", (v) =>
    prisma.$transaction(async (tx) => {
      const { created } = await releaseTaskInTx(tx, { orgId, actorId: SYSTEM_ACTOR, version: v, request: v.request });
      return created;
    })
  );
}

/**
 * FP:229 : à l'échéance, EXPIRED_REMOVAL_PENDING + UNE tâche de retrait par
 * version d'affectation (clé `EXP:<assignmentId>:<version>`). Le niveau
 * courant est conservé jusqu'à confirmation du retrait, et `version` n'est
 * PAS incrémentée (le niveau ne change pas) : un renouvellement approuvé sur
 * cette même version peut ensuite supplanter l'expiration (FP:231, D-23).
 */
async function expireTemporaryAssignments(orgId: string, now: Date, report: ProcessorReport): Promise<void> {
  const assignments = await prisma.accessAssignment.findMany({
    where: { orgId, status: "ACTIVE", periodEnd: { lte: now } },
    orderBy: { periodEnd: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.expired += await eachRow(assignments, report, "expire", (a) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.accessAssignment.updateMany({
        where: { id: a.id, status: "ACTIVE", version: a.version },
        data: { status: "EXPIRED_REMOVAL_PENDING" },
      });
      if (count === 0) return false;
      const idempotencyKey = `EXP:${a.id}:${a.version}`;
      const inserted = await tx.accessFulfilmentTask.createMany({
        data: [
          {
            orgId,
            assetId: a.assetId,
            beneficiaryId: a.userId,
            action: "EXPIRY_REMOVAL",
            sourceAssignmentId: a.id,
            sourceAssignmentVersion: a.version,
            fromLevelId: a.levelId,
            toLevelId: null,
            periodStart: a.periodStart,
            periodEnd: a.periodEnd,
            expectedAssignmentVersion: a.version,
            idempotencyKey,
          },
        ],
        skipDuplicates: true,
      });
      const task = await tx.accessFulfilmentTask.findUniqueOrThrow({ where: { idempotencyKey }, select: { id: true } });
      await tx.accessAssignmentEvent.create({
        data: {
          orgId,
          assignmentId: a.id,
          userId: a.userId,
          assetId: a.assetId,
          beforeLevelId: a.levelId,
          afterLevelId: a.levelId,
          actorId: null,
          actorRole: null,
          sourceType: "EXPIRY",
          sourceId: task.id,
          outcome: "EXPIRED_REMOVAL_PENDING",
        },
      });
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ASSET",
        scopeId: a.assetId,
        eventType: "ASSIGNMENT_EXPIRED",
        objectType: "AccessAssignment",
        objectId: a.id,
        objectVersion: a.version,
        beneficiaryId: a.userId,
        before: { status: "ACTIVE" },
        after: { status: "EXPIRED_REMOVAL_PENDING", taskId: task.id },
        reason: null,
        outcome: "SUCCESS",
        correlationId: null,
      });
      if (inserted.count === 1) {
        await tx.accessTaskEvent.create({
          data: { orgId, taskId: task.id, type: "RELEASED", actorId: null, actingAs: "SYSTEM" },
        });
        await recordAuditInTx(tx, {
          orgId,
          actorId: SYSTEM_ACTOR,
          actorRole: null,
          primaryCoveredId: null,
          scopeType: "ASSET",
          scopeId: a.assetId,
          eventType: "TASK_RELEASED",
          objectType: "AccessFulfilmentTask",
          objectId: task.id,
          objectVersion: 1,
          beneficiaryId: a.userId,
          before: null,
          after: { action: "EXPIRY_REMOVAL", state: "READY", idempotencyKey },
          reason: null,
          outcome: "SUCCESS",
          correlationId: null,
        });
      }
      return true;
    })
  );
}

/**
 * FP:231 : une demande dont la fin temporaire est passée doit être révisée
 * avant exécution. Seulement les tâches NON réclamées ; une tâche réclamée
 * est refusée à la confirmation (revérification) et se réconcilie.
 */
async function sendOverdueReadyTasksToRevision(orgId: string, now: Date, report: ProcessorReport): Promise<void> {
  const tasks = await prisma.accessFulfilmentTask.findMany({
    where: {
      orgId,
      state: "READY",
      requestVersionId: { not: null },
      action: { in: ["GRANT", "CHANGE_LEVEL", "RENEW"] },
      periodEnd: { lte: now },
    },
    orderBy: { periodEnd: "asc" },
    take: PROCESSOR_BATCH_SIZE,
  });
  report.revisionRequired += await eachRow(tasks, report, "revision", (t) =>
    prisma.$transaction(async (tx) => {
      // Même ordre de verrouillage que claimTask : version, puis tâche.
      const version = await tx.accessRequestVersion.updateMany({
        where: { id: t.requestVersionId as string, state: "READY_FOR_FULFILMENT" },
        data: { state: "REVISION_REQUIRED", revision: { increment: 1 } },
      });
      if (version.count === 0) return false;
      const task = await tx.accessFulfilmentTask.updateMany({
        where: { id: t.id, state: "READY" },
        data: { state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT", revision: { increment: 1 } },
      });
      if (task.count === 0) throw new Error("Tâche modifiée pendant le renvoi en révision");
      await tx.accessTaskEvent.create({
        data: {
          orgId,
          taskId: t.id,
          type: "CANCELLED",
          actorId: null,
          actingAs: "SYSTEM",
          reason: EXPIRED_BEFORE_FULFILMENT_REASON,
        },
      });
      await recordAuditInTx(tx, {
        orgId,
        actorId: SYSTEM_ACTOR,
        actorRole: null,
        primaryCoveredId: null,
        scopeType: "ASSET",
        scopeId: t.assetId,
        eventType: "TASK_CANCELLED",
        objectType: "AccessFulfilmentTask",
        objectId: t.id,
        objectVersion: t.revision + 1,
        beneficiaryId: t.beneficiaryId,
        before: { state: "READY" },
        after: { state: "CANCELLED", outcome: "EXPIRED_BEFORE_FULFILMENT", versionState: "REVISION_REQUIRED" },
        reason: EXPIRED_BEFORE_FULFILMENT_REASON,
        outcome: "SUCCESS",
        correlationId: null,
      });
      return true;
    })
  );
}

/**
 * `options.orgIds` restreint le passage à certaines organisations (tests :
 * les fichiers de test tournent en parallèle sur la même base). La route
 * cron l'appelle sans option.
 */
export async function runAccessProcessor(
  now: Date = new Date(),
  options: { orgIds?: string[] } = {}
): Promise<ProcessorReport> {
  const orgs = await prisma.organization.findMany({
    where: { isActive: true, ...(options.orgIds ? { id: { in: options.orgIds } } : {}) },
    select: { id: true },
  });
  const report: ProcessorReport = { released: 0, repaired: 0, expired: 0, revisionRequired: 0, errors: 0 };
  for (const org of orgs) {
    await releaseWaitingVersions(org.id, now, report);
    await repairMissingTasks(org.id, report);
    await expireTemporaryAssignments(org.id, now, report);
    await sendOverdueReadyTasksToRevision(org.id, now, report);
  }
  return report;
}
```

- [ ] **Step 4: Vérifier**

Run: `npx vitest run tests/unit/access-db/access-processor.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add lib/access/access-processor.ts tests/unit/access-db/access-processor.test.ts
git commit -m "feat(access): processeur 5 minutes — débuts futurs, expirations idempotentes, révisions forcées" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12 : Routes API des tâches

**Files:**
- Create: `lib/access/fulfilment-http.ts`
- Create: `app/api/access/tasks/route.ts`
- Create: `app/api/access/tasks/[taskId]/claim/route.ts`, `…/handover/route.ts`, `…/block/route.ts`, `…/resume/route.ts`, `…/complete/route.ts`, `…/reconcile/route.ts`
- Create: `app/api/access/tasks/claim-batch/route.ts`, `app/api/access/tasks/complete-batch/route.ts`
- Test: `tests/unit/access-db/fulfilment-routes.test.ts`

**Interfaces:**
- Consumes: schémas Zod (Tâche 2) ; `claimTask`, `handoverTask`, `blockTask`, `resumeTask`, `completeTask`, `reconcileTask`, `claimTasksBatch`, `completeTasksBatch`, `FulfilmentError`, `fulfilmentErrorStatus` (Tâches 3, 6–9) ; `listFulfilmentTasks` (Tâche 10) ; `auth()` (`@/lib/auth`).
- Produces: `unauthenticated()`, `validationError(details)`, `readJson(request)`, `fulfilmentErrorResponse(err)` ; les 9 routes de la spec §7. Succès `{ data }` (liste : `{ data, total, page, pageSize }`) ; erreurs `{ error, code }` en 400/404/409 ; 401 `{ error: "Non authentifié" }`. Les routes de lot répondent 200 avec un résultat par élément.

- [ ] **Step 1: Écrire les tests**

```ts
// tests/unit/access-db/fulfilment-routes.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// vi.mock est hissé au-dessus des imports : le mock doit être créé par vi.hoisted.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: () => sessionMock() }));

import { GET as listTasks } from "@/app/api/access/tasks/route";
import { POST as claim } from "@/app/api/access/tasks/[taskId]/claim/route";
import { POST as handover } from "@/app/api/access/tasks/[taskId]/handover/route";
import { POST as block } from "@/app/api/access/tasks/[taskId]/block/route";
import { POST as resume } from "@/app/api/access/tasks/[taskId]/resume/route";
import { POST as complete } from "@/app/api/access/tasks/[taskId]/complete/route";
import { POST as reconcile } from "@/app/api/access/tasks/[taskId]/reconcile/route";
import { POST as claimBatch } from "@/app/api/access/tasks/claim-batch/route";
import { POST as completeBatch } from "@/app/api/access/tasks/complete-batch/route";
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

type TaskRoute = (request: Request, ctx: { params: Promise<{ taskId: string }> }) => Promise<Response>;

describe("routes /api/access/tasks/** — 401 / 400 / 404 / 409", () => {
  let fx: FulfilmentFixture;

  function as(userId: string | null) {
    sessionMock.mockResolvedValue(userId ? { user: { id: userId, orgId: fx.orgId } } : null);
  }
  function post(route: TaskRoute, taskId: string, body: unknown) {
    const request = new Request(`http://localhost/api/access/tasks/${taskId}/x`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return route(request, { params: Promise.resolve({ taskId }) });
  }
  function postBatch(route: (request: Request) => Promise<Response>, body: unknown) {
    return route(
      new Request("http://localhost/api/access/tasks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }
  async function readyTaskId(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return (await taskForVersion(final.id)).id;
  }
  const evidence = () => ({ completedAt: new Date().toISOString(), reference: "REF-1" });

  beforeAll(async () => {
    fx = await createFulfilmentFixture("routes");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("401 sans session sur chaque route", async () => {
    as(null);
    const taskId = "peu-importe";
    const routes: TaskRoute[] = [claim, handover, block, resume, complete, reconcile];
    for (const route of routes) {
      const res = await post(route, taskId, { expectedRevision: 1 });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Non authentifié" });
    }
    expect((await listTasks(new Request("http://localhost/api/access/tasks"))).status).toBe(401);
    expect((await postBatch(claimBatch, { items: [] })).status).toBe(401);
    expect((await postBatch(completeBatch, { items: [] })).status).toBe(401);
  });

  it("400 sur corps invalide, avec code VALIDATION (Review Focus #5 : preuve vide, date future)", async () => {
    as(fx.users.owner);
    const taskId = await readyTaskId("Bad");
    const bad: [TaskRoute, unknown][] = [
      [claim, {}],
      [resume, { expectedRevision: 0 }],
      [handover, { toUserId: fx.users.backup, reason: "x", expectedRevision: 1 }],
      [block, { reason: "", expectedRevision: 1 }],
      [reconcile, { expectedRevision: 1 }],
      [complete, { completedAt: new Date().toISOString(), reference: "  ", note: "", expectedRevision: 1 }],
      [complete, { completedAt: new Date(Date.now() + 3_600_000).toISOString(), reference: "R", expectedRevision: 1 }],
    ];
    for (const [route, body] of bad) {
      const res = await post(route, taskId, body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION");
    }
    const notJson = await claim(
      new Request("http://localhost/x", { method: "POST", body: "pas du json" }),
      { params: Promise.resolve({ taskId }) }
    );
    expect(notJson.status).toBe(400);
    expect((await postBatch(claimBatch, { items: [] })).status).toBe(400);
    expect((await postBatch(completeBatch, { items: [{ taskId, expectedRevision: 1, completedAt: new Date().toISOString() }] })).status).toBe(400);
    expect((await listTasks(new Request("http://localhost/api/access/tasks?view=tout"))).status).toBe(400);
  });

  it("404 hors périmètre : un tiers ne voit ni ne touche une tâche ; tâche inexistante", async () => {
    const taskId = await readyTaskId("Scope");
    as(fx.users.stranger);
    expect((await listTasks(new Request("http://localhost/api/access/tasks?view=mine"))).status).toBe(404);
    expect((await listTasks(new Request("http://localhost/api/access/tasks?view=oversight"))).status).toBe(404);
    const routes: [TaskRoute, unknown][] = [
      [claim, { expectedRevision: 1 }],
      [resume, { expectedRevision: 1 }],
      [handover, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 1 }],
      [block, { reason: "bloqué", expectedRevision: 1 }],
      [reconcile, { reason: "rien fait", expectedRevision: 1 }],
      [complete, { ...evidence(), expectedRevision: 1 }],
    ];
    for (const [route, body] of routes) {
      const res = await post(route, taskId, body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Tâche introuvable", code: "NOT_FOUND" });
    }
    as(fx.users.owner);
    expect((await post(claim, "tache-inexistante", { expectedRevision: 1 })).status).toBe(404);
  });

  it("409 : révision périmée (STALE) et transition invalide (INVALID_TRANSITION), codes distinguables", async () => {
    as(fx.users.owner);
    const taskId = await readyTaskId("Conflict");
    const stale = await post(claim, taskId, { expectedRevision: 5 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "La tâche a changé, rechargez", code: "STALE" });

    const invalid: [TaskRoute, unknown][] = [
      [resume, { expectedRevision: 1 }],
      [block, { reason: "bloqué", expectedRevision: 1 }],
      [handover, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 1 }],
      [reconcile, { reason: "rien fait", expectedRevision: 1 }],
      [complete, { ...evidence(), expectedRevision: 1 }],
    ];
    for (const [route, body] of invalid) {
      const res = await post(route, taskId, body);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("INVALID_TRANSITION");
    }
  });

  it("200 : parcours complet par les routes (liste, réclamer, bloquer, reprendre, passer la main, confirmer)", async () => {
    const taskId = await readyTaskId("Happy");
    as(fx.users.owner);
    const list = await listTasks(new Request("http://localhost/api/access/tasks?view=mine&state=open&pageSize=100"));
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody).toMatchObject({ page: 1, pageSize: 100 });
    expect(listBody.data.some((t: { id: string }) => t.id === taskId)).toBe(true);

    expect((await (await post(claim, taskId, { expectedRevision: 1 })).json()).data).toEqual({ taskId, state: "CLAIMED", revision: 2 });
    expect((await post(block, taskId, { reason: "attente fournisseur", expectedRevision: 2 })).status).toBe(200);
    expect((await post(resume, taskId, { expectedRevision: 3 })).status).toBe(200);
    expect((await post(handover, taskId, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 4 })).status).toBe(200);

    as(fx.users.backup);
    const done = await post(complete, taskId, { ...evidence(), expectedRevision: 5 });
    expect(done.status).toBe(200);
    expect((await done.json()).data).toMatchObject({ state: "COMPLETED", outcome: "PROVISIONED", replayed: false });
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } })).completedById).toBe(fx.users.backup);
  });

  it("lots : 200 avec un résultat par élément et un correlationId", async () => {
    as(fx.users.owner);
    const a = await readyTaskId("LotA");
    const res = await postBatch(claimBatch, { items: [{ taskId: a, expectedRevision: 1 }, { taskId: "inconnue", expectedRevision: 1 }] });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.results.map((r: { ok: boolean; code: string | null }) => [r.ok, r.code])).toEqual([[true, null], [false, "NOT_FOUND"]]);

    const done = await postBatch(completeBatch, { items: [{ taskId: a, ...evidence(), expectedRevision: 2 }] });
    expect(done.status).toBe(200);
    expect((await done.json()).data.results).toEqual([{ taskId: a, ok: true, error: null, code: null }]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-db/fulfilment-routes.test.ts`
Expected: FAIL — modules de routes introuvables.

- [ ] **Step 3: Créer l'aide HTTP**

```ts
// lib/access/fulfilment-http.ts
// Réponses HTTP communes aux routes /api/access/tasks/** (phase 3b, D-8,
// D-22) : messages en français et `code` distinguable (FP:337) —
// NOT_FOUND → 404, STALE / INVALID_TRANSITION → 409, VALIDATION → 400.
import { FulfilmentError, fulfilmentErrorStatus } from "./fulfilment-server";

export function unauthenticated(): Response {
  return Response.json({ error: "Non authentifié" }, { status: 401 });
}

export function validationError(details: unknown): Response {
  return Response.json({ error: "Données invalides", code: "VALIDATION", details }, { status: 400 });
}

/** Corps JSON, ou `null` s'il est absent ou illisible (→ 400 par le schéma Zod). */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function fulfilmentErrorResponse(err: unknown): Response {
  if (err instanceof FulfilmentError) {
    return Response.json({ error: err.message, code: err.code }, { status: fulfilmentErrorStatus(err.code) });
  }
  throw err;
}
```

- [ ] **Step 4: Créer la route de liste**

```ts
// app/api/access/tasks/route.ts
// Lecture des tâches d'exécution (phase 3b). La portée est recalculée en base
// par listFulfilmentTasks ; hors portée → 404, jamais 403.
import { auth } from "@/lib/auth";
import { taskListQuerySchema } from "@/lib/validations/access";
import { listFulfilmentTasks } from "@/lib/access/fulfilment-read-server";
import { fulfilmentErrorResponse, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthenticated();

  const url = new URL(request.url);
  const parsed = taskListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const { page, pageSize } = parsed.data;
  try {
    const result = await listFulfilmentTasks({ orgId: session.user.orgId, userId: session.user.id }, parsed.data);
    return Response.json({ data: result.rows, total: result.total, page, pageSize });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

- [ ] **Step 5: Créer les six routes d'action**

```ts
// app/api/access/tasks/[taskId]/claim/route.ts
import { auth } from "@/lib/auth";
import { taskRevisionSchema } from "@/lib/validations/access";
import { claimTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = taskRevisionSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await claimTask(session.user.orgId, session.user.id, taskId, parsed.data.expectedRevision);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

```ts
// app/api/access/tasks/[taskId]/resume/route.ts
import { auth } from "@/lib/auth";
import { taskRevisionSchema } from "@/lib/validations/access";
import { resumeTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = taskRevisionSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await resumeTask(session.user.orgId, session.user.id, taskId, parsed.data.expectedRevision);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

```ts
// app/api/access/tasks/[taskId]/handover/route.ts
import { auth } from "@/lib/auth";
import { handoverTaskSchema } from "@/lib/validations/access";
import { handoverTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = handoverTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await handoverTask(session.user.orgId, session.user.id, taskId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

```ts
// app/api/access/tasks/[taskId]/block/route.ts
import { auth } from "@/lib/auth";
import { blockTaskSchema } from "@/lib/validations/access";
import { blockTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = blockTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await blockTask(session.user.orgId, session.user.id, taskId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

```ts
// app/api/access/tasks/[taskId]/reconcile/route.ts
import { auth } from "@/lib/auth";
import { reconcileTaskSchema } from "@/lib/validations/access";
import { reconcileTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = reconcileTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await reconcileTask(session.user.orgId, session.user.id, taskId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

```ts
// app/api/access/tasks/[taskId]/complete/route.ts
import { auth } from "@/lib/auth";
import { completeTaskSchema } from "@/lib/validations/access";
import { completeTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = completeTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await completeTask(session.user.orgId, session.user.id, taskId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
```

- [ ] **Step 6: Créer les deux routes de lot**

```ts
// app/api/access/tasks/claim-batch/route.ts
import { auth } from "@/lib/auth";
import { claimBatchSchema } from "@/lib/validations/access";
import { claimTasksBatch } from "@/lib/access/fulfilment-server";
import { readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

// Résultat par élément (FP:252) : la route répond 200 même si des éléments
// échouent — chaque échec porte son message et son code.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthenticated();

  const parsed = claimBatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const data = await claimTasksBatch(session.user.orgId, session.user.id, parsed.data.items);
  return Response.json({ data });
}
```

```ts
// app/api/access/tasks/complete-batch/route.ts
import { auth } from "@/lib/auth";
import { completeBatchSchema } from "@/lib/validations/access";
import { completeTasksBatch } from "@/lib/access/fulfilment-server";
import { readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

// Résultat par élément (FP:252, FP:254) : chaque élément porte sa propre
// preuve ; la route répond 200 même si des éléments échouent.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthenticated();

  const parsed = completeBatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const data = await completeTasksBatch(session.user.orgId, session.user.id, parsed.data.items);
  return Response.json({ data });
}
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run tests/unit/access-db/fulfilment-routes.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), aucune erreur de type.

- [ ] **Step 8: Commit**

```bash
git add lib/access/fulfilment-http.ts app/api/access/tasks tests/unit/access-db/fulfilment-routes.test.ts
git commit -m "feat(access): routes API des tâches d'exécution — codes d'erreur distinguables" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13 : Route cron et crontab

**Files:**
- Create: `app/api/cron/access-processor/route.ts`
- Modify: `cron/crontab`
- Test: `tests/unit/access-processor-route.test.ts`

**Interfaces:**
- Consumes: `runAccessProcessor(now)` (Tâche 11) ; `verifyCronSecret(request: NextRequest): boolean` (`lib/cron.ts`) ; `log.child` (`lib/log.ts`).
- Produces: `GET /api/cron/access-processor` → 401 sans secret ; 200 `{ ok: true, released, repaired, expired, revisionRequired, errors }` ; 500 `{ error: "Erreur interne" }`.

`vercel.json` n'est **pas** modifié (D-11 : le conteneur cron Docker est l'ordonnanceur réel ; l'offre Vercel Hobby interdit les 5 minutes).

- [ ] **Step 1: Écrire le test**

```ts
// tests/unit/access-processor-route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Le processeur réel parcourt toutes les organisations actives de la base :
// on le remplace ici pour ne tester que la route (secret, forme de réponse).
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("@/lib/access/access-processor", () => ({ runAccessProcessor: runMock }));

import { GET } from "@/app/api/cron/access-processor/route";

function makeRequest(authHeader: string | null): NextRequest {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/cron/access-processor", { headers });
}

describe("GET /api/cron/access-processor", () => {
  const ORIGINAL = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-with-some-length-1234567890";
    runMock.mockReset();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it("401 sans secret ou avec un mauvais secret, sans lancer le processeur", async () => {
    expect((await GET(makeRequest(null))).status).toBe(401);
    expect((await GET(makeRequest("Bearer mauvais-secret"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200 avec le secret : lance le processeur et renvoie son rapport", async () => {
    runMock.mockResolvedValue({ released: 1, repaired: 0, expired: 2, revisionRequired: 0, errors: 0 });
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: 1, repaired: 0, expired: 2, revisionRequired: 0, errors: 0 });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("500 si le processeur échoue, sans détail interne dans la réponse", async () => {
    runMock.mockRejectedValue(new Error("connexion base perdue"));
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Erreur interne" });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/unit/access-processor-route.test.ts`
Expected: FAIL — module de route introuvable.

- [ ] **Step 3: Créer la route**

```ts
// app/api/cron/access-processor/route.ts
import { NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron";
import { log } from "@/lib/log";
import { runAccessProcessor } from "@/lib/access/access-processor";

const logger = log.child("cron/access-processor");

/**
 * GET /api/cron/access-processor
 * Toutes les 5 minutes (cron/crontab). Libère les demandes arrivées à leur
 * date de début, répare les tâches manquantes, marque les accès temporaires
 * échus et crée leur tâche de retrait, renvoie en révision les demandes dont
 * la période est passée avant exécution. Idempotent ; aucun appel externe,
 * aucune notification. Protégé par CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  try {
    const report = await runAccessProcessor(new Date());
    logger.info("run complete", { ...report });
    return Response.json({ ok: true, ...report });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Erreur interne" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Ajouter la ligne au crontab**

À la fin de `cron/crontab`, ajouter (le fichier doit se terminer par un saut de ligne) :

```
# Processeur accès (débuts de période, expirations) : toutes les 5 minutes — idempotent, aucune notification
*/5 * * * * . /etc/cron.env; wget -qO- --header="Authorization: Bearer $CRON_SECRET" http://app:3000/api/cron/access-processor > /dev/null 2>&1
```

Au déploiement, le conteneur `cron` doit être recréé pour relire le fichier (monté en lecture seule).

- [ ] **Step 5: Vérifier**

Run: `npx vitest run tests/unit/access-processor-route.test.ts tests/unit/cron.test.ts && npx tsc --noEmit && tail -2 cron/crontab`
Expected: PASS (3 tests + ceux de `cron.test.ts`) ; les deux dernières lignes du crontab sont celles ajoutées. Une ligne de journal `"level":"error"… connexion base perdue` dans la sortie est attendue (test du 500).

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/access-processor/route.ts cron/crontab tests/unit/access-processor-route.test.ts
git commit -m "feat(access): route cron du processeur d'accès, toutes les 5 minutes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14 : Écran « Exécution »

**Files:**
- Create: `components/access/FulfilmentTaskCard.tsx`
- Create: `components/access/FulfilmentTaskList.tsx`
- Create: `app/(dashboard)/access/fulfilment/page.tsx`
- Create: `app/(dashboard)/access/fulfilment/loading.tsx`

**Interfaces:**
- Consumes: `FulfilmentTaskDTO`, `getFulfilmentNav`, `listFulfilmentTasks` (Tâche 10) ; `FulfilmentError` (Tâche 3) ; `TASK_ACTION_LABELS`, `TASK_STATE_LABELS` (Tâche 2) ; routes `POST /api/access/tasks/[taskId]/{claim,handover,block,resume,complete,reconcile}`, `POST /api/access/tasks/{claim-batch,complete-batch}` (Tâche 12) ; `AdminPageHeader` (`components/admin/AdminPageHeader.tsx`), `Skeleton` (`components/ui/Skeleton.tsx`).
- Produces: page `/access/fulfilment` (onglets `?tab=todo|history|oversight`, `?state=history` en supervision, `?page=`) ; composants `FulfilmentTaskCard`, `FulfilmentTaskList` ; `nowForDateTimeInput()`.

Pas de test unitaire de composant dans ce dépôt (même convention que les phases 2b/3a) : la logique testable est dans les services (Tâches 6–10) ; l'écran est vérifié par types, lint, build, puis au navigateur en Tâche 16. Les boutons affichés viennent de `viewerCan` (confort) — le serveur revérifie tout. États : chargement (`loading.tsx`), vide (message), erreur (message de l'API affiché dans la carte ; `app/(dashboard)/error.tsx` existant pour le reste), lecture seule (supervision).

- [ ] **Step 1: Créer la carte d'une tâche**

```tsx
// components/access/FulfilmentTaskCard.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TASK_ACTION_LABELS, TASK_STATE_LABELS } from "@/lib/access/fulfilment";
import type { FulfilmentTaskDTO } from "@/lib/access/fulfilment-read-server";

type Mode = "complete" | "block" | "handover" | "reconcile" | null;

const STAGE_ROLE_LABELS: Record<string, string> = {
  DEPARTMENT_HEAD: "Chef de département",
  CISO: "CISO",
  COO: "COO",
};

const EVENT_LABELS: Record<string, string> = {
  RELEASED: "Libérée",
  CLAIMED: "Réclamée",
  HANDED_OVER: "Passée à",
  BLOCKED: "Bloquée",
  RESUMED: "Reprise",
  PARTIAL_REMOVAL: "Ancien niveau retiré",
  COMPLETED: "Exécutée",
  RECONCILED: "Réconciliée — aucune modification",
  CANCELLED: "Annulée",
};

const STATE_BADGE: Record<string, string> = {
  READY: "bg-teal-lt text-teal-dk",
  CLAIMED: "bg-gold-lt text-dark",
  BLOCKED: "bg-red-lt text-dark",
  COMPLETED: "bg-green-lt text-dark",
  CANCELLED: "bg-gray-lt text-izi-gray",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo", dateStyle: "short", timeStyle: "short" });
}

/** Valeur d'un champ datetime-local pour « maintenant » (heure locale du navigateur). */
export function nowForDateTimeInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputClass =
  "izi-form-input w-full rounded-[6px] border border-teal-md bg-white px-2 py-2 text-[13px] text-dark";
const primaryButton =
  "rounded-[6px] bg-teal px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-dk disabled:opacity-50";
const secondaryButton =
  "rounded-[6px] border border-teal-md bg-white px-3 py-2 text-[13px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50";

interface Props {
  task: FulfilmentTaskDTO;
  readOnly: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}

export function FulfilmentTaskCard({ task, readOnly, selectable, selected, onToggle }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedAtLocal, setCompletedAtLocal] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<"DIRECT" | "REMOVE_THEN_GRANT">("DIRECT");
  const [partialRemovalOnly, setPartialRemovalOnly] = useState(false);
  const [reason, setReason] = useState("");
  const [facts, setFacts] = useState("");
  const [toUserId, setToUserId] = useState(task.handoverCandidates[0]?.id ?? "");

  const can = readOnly ? null : task.viewerCan;
  const needsMethod = task.action === "CHANGE_LEVEL" && task.oldRemovedAt === null;

  function open(next: Mode) {
    setError(null);
    setReason("");
    if (next === "complete" && !completedAtLocal) setCompletedAtLocal(nowForDateTimeInput());
    setMode(next);
  }

  async function send(path: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/tasks/${task.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedRevision: task.revision }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Échec de l'opération");
      }
      setMode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function submitComplete() {
    if (!completedAtLocal || (!reference.trim() && !note.trim())) {
      setError("Indiquez la date réelle et une référence ou une note");
      return;
    }
    void send("complete", {
      completedAt: new Date(completedAtLocal).toISOString(),
      reference,
      note,
      ...(task.action === "CHANGE_LEVEL" ? { method: needsMethod ? method : "REMOVE_THEN_GRANT" } : {}),
      partialRemovalOnly: needsMethod && method === "REMOVE_THEN_GRANT" && partialRemovalOnly,
    });
  }

  return (
    <article className="rounded-[10px] border border-border-soft bg-white p-4" aria-label={`Tâche ${task.reference}`}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Sélectionner la tâche ${task.reference}`}
            className="mt-1 h-5 w-5 shrink-0 accent-teal"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-dark">{task.beneficiaryName}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_BADGE[task.state]}`}>
              {TASK_STATE_LABELS[task.state]}
            </span>
            <span className="font-mono text-[11px] text-izi-gray">{task.reference}</span>
          </div>
          <p className="text-[13px] text-izi-gray">{task.departmentName ?? "Département non renseigné"}</p>

          <p className="mt-2 text-[15px] text-dark">
            <span className="font-medium">{TASK_ACTION_LABELS[task.action]}</span> · {task.assetName}
            {task.assetArchived && <span className="ml-1 text-[11px] text-izi-gray">(archivée)</span>}
          </p>
          <p className="text-[13px] text-dark-md">
            {task.fromLevelName ?? "Aucun accès"} → {task.toLevelName ?? "Aucun accès"}
          </p>
          <p className="text-[13px] text-izi-gray">
            {task.periodEnd
              ? `Temporaire jusqu'au ${formatDay(task.periodEnd)}`
              : task.periodStart
                ? `Sans date de fin, à partir du ${formatDay(task.periodStart)}`
                : "Période non renseignée"}
            {" · "}libérée le {formatDay(task.releasedAt)}
          </p>

          {!task.hasOwner && (
            <p className="mt-2 rounded-[6px] bg-red-lt px-2 py-1 text-[13px] text-dark">
              Aucun propriétaire — à affecter
            </p>
          )}
          {task.claimantName && (
            <p className="mt-1 text-[13px] text-dark-md">Prise en charge par {task.claimantName}</p>
          )}
          {task.blockedReason && (
            <p className="mt-2 rounded-[6px] bg-red-lt px-2 py-1 text-[13px] text-dark">Blocage : {task.blockedReason}</p>
          )}
          {task.cancelRequested && (
            <p className="mt-2 rounded-[6px] bg-gold-lt px-2 py-1 text-[13px] text-dark">
              Le demandeur a demandé l&apos;annulation — réconciliez ou confirmez ce qui a réellement été fait.
            </p>
          )}
          {task.staleReason && (
            <p className="mt-2 rounded-[6px] bg-gold-lt px-2 py-1 text-[13px] text-dark">À revoir : {task.staleReason}</p>
          )}

          <p className="mt-2 text-[13px] text-dark-md">
            <span className="text-izi-gray">Motif : </span>
            {task.ownerReason}
          </p>
          {(task.approvalSummary.length > 0 || task.approvalException) && (
            <p className="text-[13px] text-izi-gray">
              {task.approvalException === "COO_SELF_REQUEST"
                ? "Exception : demande personnelle du COO"
                : task.approvalSummary
                    .map((s) => `${STAGE_ROLE_LABELS[s.role] ?? s.role}${s.decidedAt ? ` (${formatDay(s.decidedAt)})` : ""}`)
                    .join(" → ")}
            </p>
          )}
          {task.completedAt && (
            <p className="mt-1 text-[13px] text-dark-md">
              Exécutée le {formatDateTime(task.completedAt)}
              {task.completionReference ? ` · réf. ${task.completionReference}` : ""}
              {task.completionNote ? ` · ${task.completionNote}` : ""}
            </p>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-teal-dk">Historique ({task.events.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {task.events.map((e, i) => (
                <li key={i} className="text-[13px] text-dark-md">
                  <span className="font-mono text-[11px] text-izi-gray">{formatDateTime(e.occurredAt)}</span>{" "}
                  {EVENT_LABELS[e.type] ?? e.type}
                  {e.toUserName ? ` ${e.toUserName}` : ""}
                  {e.actorName ? ` — ${e.actorName}` : e.actingAs === "SYSTEM" ? " — système" : ""}
                  {e.reason ? ` : ${e.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>

          {error && (
            <p role="alert" className="mt-2 text-[13px] text-red">
              {error}
            </p>
          )}

          {can && mode === null && (
            <div className="mt-3 flex flex-wrap gap-2">
              {can.claim && (
                <button type="button" disabled={busy} onClick={() => send("claim", {})} className={primaryButton}>
                  Réclamer
                </button>
              )}
              {can.complete && (
                <button type="button" disabled={busy} onClick={() => open("complete")} className={primaryButton}>
                  Confirmer
                </button>
              )}
              {can.resume && (
                <button type="button" disabled={busy} onClick={() => send("resume", {})} className={primaryButton}>
                  Reprendre
                </button>
              )}
              {can.block && (
                <button type="button" disabled={busy} onClick={() => open("block")} className={secondaryButton}>
                  Signaler un blocage
                </button>
              )}
              {can.handover && (
                <button type="button" disabled={busy} onClick={() => open("handover")} className={secondaryButton}>
                  Passer la main
                </button>
              )}
              {can.reconcile && (
                <button type="button" disabled={busy} onClick={() => open("reconcile")} className={secondaryButton}>
                  Réconcilier
                </button>
              )}
            </div>
          )}

          {mode === "complete" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <label className="text-[13px] text-dark">
                Date et heure réelles
                <input
                  type="datetime-local"
                  value={completedAtLocal}
                  onChange={(e) => setCompletedAtLocal(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="text-[13px] text-dark">
                Référence (compte, ticket)
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={inputClass} />
              </label>
              <label className="text-[13px] text-dark">
                Note d&apos;exécution
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className={inputClass} />
              </label>
              <p className="text-[11px] text-izi-gray">
                Référence ou note obligatoire. N&apos;écrivez jamais de mot de passe ni de secret.
              </p>
              {needsMethod && (
                <fieldset className="text-[13px] text-dark">
                  <legend className="mb-1">Méthode de remplacement</legend>
                  <label className="mr-4 inline-flex items-center gap-1">
                    <input type="radio" name={`method-${task.id}`} checked={method === "DIRECT"} onChange={() => setMethod("DIRECT")} />
                    Remplacement direct
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name={`method-${task.id}`}
                      checked={method === "REMOVE_THEN_GRANT"}
                      onChange={() => setMethod("REMOVE_THEN_GRANT")}
                    />
                    Retrait puis octroi
                  </label>
                  {method === "REMOVE_THEN_GRANT" && (
                    <label className="mt-1 flex items-center gap-1">
                      <input type="checkbox" checked={partialRemovalOnly} onChange={(e) => setPartialRemovalOnly(e.target.checked)} />
                      Seul l&apos;ancien niveau a été retiré
                    </label>
                  )}
                </fieldset>
              )}
              {task.oldRemovedAt && (
                <p className="text-[13px] text-dark-md">
                  Ancien niveau retiré le {formatDateTime(task.oldRemovedAt)} — confirmez l&apos;octroi du nouveau niveau.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={submitComplete} className={primaryButton}>
                  Enregistrer
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}

          {mode === "block" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <label className="text-[13px] text-dark">
                Motif du blocage (visible du demandeur)
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
              </label>
              <label className="text-[13px] text-dark">
                Faits constatés (internes — ce qui a été tenté ou déjà fait)
                <textarea value={facts} onChange={(e) => setFacts(e.target.value)} maxLength={2000} rows={2} className={inputClass} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => send("block", { reason, facts })}
                  className={primaryButton}
                >
                  Bloquer
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}

          {mode === "handover" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <label className="text-[13px] text-dark">
                Nouveau détenteur
                <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} className={inputClass}>
                  {task.handoverCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[13px] text-dark">
                Motif
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !toUserId || reason.trim().length < 3}
                  onClick={() => send("handover", { toUserId, reason })}
                  className={primaryButton}
                >
                  Passer la main
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}

          {mode === "reconcile" && (
            <div className="mt-3 flex flex-col gap-2 rounded-[8px] bg-gray-lt p-3">
              <p className="text-[13px] text-dark">
                Déclare qu&apos;<strong>aucune modification n&apos;a été effectuée</strong> dans l&apos;application. La tâche et la
                demande seront annulées.
              </p>
              <label className="text-[13px] text-dark">
                Motif
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => send("reconcile", { reason })}
                  className={primaryButton}
                >
                  Aucune modification effectuée
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={secondaryButton}>
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Créer la liste (sélection multiple et lots)**

```tsx
// components/access/FulfilmentTaskList.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FulfilmentTaskDTO } from "@/lib/access/fulfilment-read-server";
import { FulfilmentTaskCard, nowForDateTimeInput } from "./FulfilmentTaskCard";

interface BatchItemResult {
  taskId: string;
  ok: boolean;
  error: string | null;
}

interface Evidence {
  reference: string;
  note: string;
  method: "DIRECT" | "REMOVE_THEN_GRANT";
}

const EMPTY_EVIDENCE: Evidence = { reference: "", note: "", method: "DIRECT" };

const inputClass =
  "izi-form-input w-full rounded-[6px] border border-teal-md bg-white px-2 py-2 text-[13px] text-dark";
const primaryButton =
  "rounded-[6px] bg-teal px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-dk disabled:opacity-50";
const secondaryButton =
  "rounded-[6px] border border-teal-md bg-white px-3 py-2 text-[13px] font-medium text-dark hover:bg-teal-lt disabled:opacity-50";

interface Props {
  rows: FulfilmentTaskDTO[];
  /** Supervision CISO/COO : aucune action. */
  readOnly: boolean;
  /** Onglet « À faire » : sélection multiple pour réclamer / confirmer en lot. */
  selectable: boolean;
  emptyMessage: string;
}

export function FulfilmentTaskList({ rows, readOnly, selectable, emptyMessage }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [completedAtLocal, setCompletedAtLocal] = useState("");
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);

  const chosen = rows.filter((r) => selected[r.id]);
  const claimable = chosen.filter((r) => r.viewerCan.claim);
  const completable = chosen.filter((r) => r.viewerCan.complete);
  const referenceOf = (taskId: string) => rows.find((r) => r.id === taskId)?.reference ?? taskId;
  const evidenceOf = (taskId: string) => evidence[taskId] ?? EMPTY_EVIDENCE;
  const setEvidenceOf = (taskId: string, patch: Partial<Evidence>) =>
    setEvidence((all) => ({ ...all, [taskId]: { ...(all[taskId] ?? EMPTY_EVIDENCE), ...patch } }));

  async function sendBatch(path: "claim-batch" | "complete-batch", items: unknown[]) {
    if (busy || items.length === 0) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/access/tasks/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Échec du lot");
      setResults(payload.data.results as BatchItemResult[]);
      setSelected({});
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  function claimSelection() {
    void sendBatch(
      "claim-batch",
      claimable.map((r) => ({ taskId: r.id, expectedRevision: r.revision }))
    );
  }

  function completeSelection() {
    if (!completedAtLocal) {
      setError("Indiquez la date réelle d'exécution");
      return;
    }
    const missing = completable.find((r) => !evidenceOf(r.id).reference.trim() && !evidenceOf(r.id).note.trim());
    if (missing) {
      setError(`Référence ou note manquante pour ${missing.reference}`);
      return;
    }
    const completedAt = new Date(completedAtLocal).toISOString();
    void sendBatch(
      "complete-batch",
      completable.map((r) => {
        const e = evidenceOf(r.id);
        return {
          taskId: r.id,
          expectedRevision: r.revision,
          completedAt,
          reference: e.reference,
          note: e.note,
          ...(r.action === "CHANGE_LEVEL" ? { method: r.oldRemovedAt ? "REMOVE_THEN_GRANT" : e.method } : {}),
        };
      })
    );
  }

  if (rows.length === 0 && !results) {
    return (
      <div className="rounded-[10px] border border-border-soft bg-white p-6 text-center">
        <p className="text-[15px] text-izi-gray">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {results && (
        <div className="mb-3 rounded-[10px] border border-border-soft bg-white p-3" role="status">
          <p className="text-[13px] font-medium text-dark">
            Résultat du lot : {results.filter((r) => r.ok).length} réussie(s), {results.filter((r) => !r.ok).length} en échec
          </p>
          <ul className="mt-1 space-y-0.5">
            {results.map((r) => (
              <li key={r.taskId} className={`text-[13px] ${r.ok ? "text-dark-md" : "text-red"}`}>
                {referenceOf(r.taskId)} — {r.ok ? "fait" : r.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-2 text-[13px] text-red">
          {error}
        </p>
      )}

      {selectable && chosen.length > 0 && !confirming && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-teal-md bg-teal-lt p-3">
          <span className="text-[13px] text-dark">{chosen.length} sélectionnée(s)</span>
          <button type="button" disabled={busy || claimable.length === 0} onClick={claimSelection} className={primaryButton}>
            Réclamer la sélection ({claimable.length})
          </button>
          <button
            type="button"
            disabled={busy || completable.length === 0}
            onClick={() => {
              setError(null);
              setCompletedAtLocal(nowForDateTimeInput());
              setConfirming(true);
            }}
            className={primaryButton}
          >
            Confirmer la sélection ({completable.length})
          </button>
        </div>
      )}

      {confirming && (
        <div className="mb-3 flex flex-col gap-3 rounded-[10px] border border-teal-md bg-white p-3">
          <h2 className="font-serif text-[18px] text-dark">Confirmer {completable.length} tâche(s)</h2>
          <label className="text-[13px] text-dark">
            Date et heure réelles (communes)
            <input
              type="datetime-local"
              value={completedAtLocal}
              onChange={(e) => setCompletedAtLocal(e.target.value)}
              className={inputClass}
            />
          </label>
          <p className="text-[11px] text-izi-gray">
            Chaque tâche porte sa propre référence ou note. N&apos;écrivez jamais de mot de passe ni de secret.
          </p>
          {completable.map((r) => (
            <fieldset key={r.id} className="rounded-[8px] bg-gray-lt p-2">
              <legend className="text-[13px] font-medium text-dark">
                {r.reference} · {r.beneficiaryName} · {r.assetName}
              </legend>
              <label className="text-[13px] text-dark">
                Référence
                <input
                  value={evidenceOf(r.id).reference}
                  onChange={(e) => setEvidenceOf(r.id, { reference: e.target.value })}
                  maxLength={200}
                  className={inputClass}
                />
              </label>
              <label className="text-[13px] text-dark">
                Note
                <input
                  value={evidenceOf(r.id).note}
                  onChange={(e) => setEvidenceOf(r.id, { note: e.target.value })}
                  maxLength={2000}
                  className={inputClass}
                />
              </label>
              {r.action === "CHANGE_LEVEL" && !r.oldRemovedAt && (
                <label className="text-[13px] text-dark">
                  Méthode de remplacement
                  <select
                    value={evidenceOf(r.id).method}
                    onChange={(e) => setEvidenceOf(r.id, { method: e.target.value as Evidence["method"] })}
                    className={inputClass}
                  >
                    <option value="DIRECT">Remplacement direct</option>
                    <option value="REMOVE_THEN_GRANT">Retrait puis octroi (les deux faits)</option>
                  </select>
                </label>
              )}
            </fieldset>
          ))}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={completeSelection} className={primaryButton}>
              Enregistrer les confirmations
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButton}>
              Fermer
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((task) => (
          <FulfilmentTaskCard
            key={`${task.id}:${task.revision}`}
            task={task}
            readOnly={readOnly}
            selectable={selectable && (task.viewerCan.claim || task.viewerCan.complete)}
            selected={selected[task.id] ?? false}
            onToggle={() => setSelected((s) => ({ ...s, [task.id]: !s[task.id] }))}
          />
        ))}
      </div>
    </div>
  );
}
```

(La clé `id:revision` réinitialise l'état local d'une carte dès que la tâche change côté serveur.)

- [ ] **Step 3: Créer la page et son état de chargement**

```tsx
// app/(dashboard)/access/fulfilment/page.tsx
// Écran « Exécution » (phase 3b, D-15) : tâches autorisées des actifs dont le
// lecteur est propriétaire/suppléant, leur historique, et la supervision en
// lecture seule pour CISO/COO. Hors portée → notFound(), comme le registre.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { FulfilmentTaskList } from "@/components/access/FulfilmentTaskList";
import { FulfilmentError } from "@/lib/access/fulfilment-server";
import { getFulfilmentNav, listFulfilmentTasks } from "@/lib/access/fulfilment-read-server";

const PAGE_SIZE = 25;

type Tab = "todo" | "history" | "oversight";

const TAB_LABELS: Record<Tab, string> = { todo: "À faire", history: "Historique", oversight: "Supervision" };

const EMPTY_MESSAGES: Record<Tab, string> = {
  todo: "Aucune tâche à exécuter pour l'instant.",
  history: "Aucune tâche terminée.",
  oversight: "Aucune tâche dans cette vue.",
};

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function FulfilmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, orgId } = session.user;

  const nav = await getFulfilmentNav(orgId, userId);
  if (!nav.hasMine && !nav.canOversee) notFound();

  const params = await searchParams;
  const tabs: Tab[] = [...(nav.hasMine ? (["todo", "history"] as Tab[]) : []), ...(nav.canOversee ? (["oversight"] as Tab[]) : [])];
  // Paramètre invalide ou onglet non autorisé → premier onglet autorisé.
  const requested = first(params.tab) as Tab | undefined;
  const tab: Tab = requested && tabs.includes(requested) ? requested : tabs[0];
  const oversightState = first(params.state) === "history" ? "history" : "open";
  const page = Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1);

  let result;
  try {
    result = await listFulfilmentTasks(
      { orgId, userId },
      {
        view: tab === "oversight" ? "oversight" : "mine",
        state: tab === "history" ? "history" : tab === "oversight" ? oversightState : "open",
        page,
        pageSize: PAGE_SIZE,
      }
    );
  } catch (err) {
    if (err instanceof FulfilmentError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hrefFor = (p: number) => {
    const q = new URLSearchParams({ tab });
    if (tab === "oversight" && oversightState === "history") q.set("state", "history");
    if (p > 1) q.set("page", String(p));
    return `/access/fulfilment?${q.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Exécution"
        subtitle={`${result.total} tâche${result.total > 1 ? "s" : ""} · ${TAB_LABELS[tab].toLowerCase()}`}
      />

      <nav aria-label="Vues des tâches d'exécution" className="mb-3 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/access/fulfilment?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-[8px] px-3 py-2 text-[13px] font-medium no-underline ${
              t === tab ? "bg-teal text-white" : "border border-border-soft bg-white text-dark hover:bg-teal-lt"
            }`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {tab === "oversight" && (
        <div className="mb-3 flex gap-3 text-[13px]">
          <Link
            href="/access/fulfilment?tab=oversight"
            aria-current={oversightState === "open" ? "page" : undefined}
            className={oversightState === "open" ? "font-semibold text-dark" : "text-teal-dk"}
          >
            Ouvertes
          </Link>
          <Link
            href="/access/fulfilment?tab=oversight&state=history"
            aria-current={oversightState === "history" ? "page" : undefined}
            className={oversightState === "history" ? "font-semibold text-dark" : "text-teal-dk"}
          >
            Terminées
          </Link>
          <span className="text-izi-gray">Lecture seule</span>
        </div>
      )}

      <FulfilmentTaskList
        rows={result.rows}
        readOnly={tab === "oversight"}
        selectable={tab === "todo"}
        emptyMessage={EMPTY_MESSAGES[tab]}
      />

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px]">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className="text-teal-dk">
              ← Précédent
            </Link>
          ) : (
            <span />
          )}
          <span className="font-mono text-izi-gray">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={hrefFor(page + 1)} className="text-teal-dk">
              Suivant →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
```

```tsx
// app/(dashboard)/access/fulfilment/loading.tsx
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="mb-3 flex gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-[10px] border border-border-soft bg-white p-4">
            <Skeleton className="h-4 w-1/2 mb-2" />
            <Skeleton className="h-3 w-1/3 mb-3" />
            <Skeleton className="h-3 w-3/4 mb-2" />
            <Skeleton className="h-9 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier**

Run: `npx tsc --noEmit && npx eslint components/access/FulfilmentTaskCard.tsx components/access/FulfilmentTaskList.tsx "app/(dashboard)/access/fulfilment" && npm run build`
Expected: aucune erreur de type, aucune erreur ni avertissement ESLint sur ces fichiers, build réussi avec `/access/fulfilment` dans la liste des routes.

- [ ] **Step 5: Commit**

```bash
git add components/access/FulfilmentTaskCard.tsx components/access/FulfilmentTaskList.tsx "app/(dashboard)/access/fulfilment"
git commit -m "feat(access): écran Exécution — tâches à faire, historique, supervision, lots" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15 : « Mes demandes » — libellés, annulation après réclamation ; lien de navigation

**Files:**
- Create: `lib/access/request-labels.ts`
- Modify: `app/(dashboard)/requests/mine/page.tsx`
- Modify: `components/access/MyRequestActions.tsx`
- Modify: `app/(dashboard)/layout.tsx`
- Modify: `components/layout/DashboardShell.tsx`
- Modify: `components/layout/Sidebar.tsx`
- Test: `tests/unit/access-request-labels.test.ts`

**Interfaces:**
- Consumes: `RequestSummaryDTO` étendu (Tâche 5 : `completedAt`, `cancelRequestedAt`, `taskReason`) ; `getFulfilmentAssetIds(client, orgId, userId)` (Tâche 3) ; `fulfilmentNavFlags(scopes, fulfilmentAssetIds)` (Tâche 2) ; `resolveReadScopes`, `registerNavFlags` (existants, déjà utilisés dans `layout.tsx`).
- Produces: `requestStateLabel(input: RequestStateLabelInput): string`, `REQUEST_KIND_LABELS`, `cancelActionFor(state, cancelRequested): "CANCEL" | "REQUEST_CANCEL" | null` ; prop `canViewFulfilment` sur `DashboardShell` (requise) et `Sidebar` (optionnelle) ; lien « Exécution » → `/access/fulfilment`.

Le lien « Exécution » suit la même règle que les liens de la phase 2b : condition calculée **côté serveur** dans `layout.tsx` à partir des portées (`resolveReadScopes`) et des actifs d'exécution — jamais devinée côté client. Masquer le lien n'est qu'un confort : page et API refusent de toute façon (Tâches 10, 12, 14).

- [ ] **Step 1: Écrire le test des libellés**

```ts
// tests/unit/access-request-labels.test.ts
import { describe, it, expect } from "vitest";
import { cancelActionFor, requestStateLabel, type RequestStateLabelInput } from "@/lib/access/request-labels";

function input(over: Partial<RequestStateLabelInput>): RequestStateLabelInput {
  return { state: "PENDING_APPROVAL", periodStart: "2026-10-05T10:00:00.000Z", completedAt: null, taskReason: null, cancelRequested: false, ...over };
}

describe("requestStateLabel", () => {
  it("libellés des états d'exécution (spec 3b §8)", () => {
    expect(requestStateLabel(input({ state: "AUTHORIZED_WAITING_START" }))).toBe("Autorisée — début le 05/10/2026");
    expect(requestStateLabel(input({ state: "READY_FOR_FULFILMENT" }))).toBe("Prête — en attente du propriétaire");
    expect(requestStateLabel(input({ state: "IN_PROGRESS" }))).toBe("En cours d'exécution");
    expect(requestStateLabel(input({ state: "BLOCKED", taskReason: "Compte verrouillé" }))).toBe("Bloquée : Compte verrouillé");
    expect(requestStateLabel(input({ state: "BLOCKED" }))).toBe("Bloquée : motif non précisé");
    expect(requestStateLabel(input({ state: "COMPLETED", completedAt: "2026-10-07T09:00:00.000Z" }))).toBe("Exécutée le 07/10/2026");
    expect(requestStateLabel(input({ state: "CANCELLED" }))).toBe("Annulée");
  });

  it("signale une annulation demandée pendant l'exécution", () => {
    expect(requestStateLabel(input({ state: "IN_PROGRESS", cancelRequested: true }))).toBe("En cours d'exécution · annulation demandée");
  });

  it("états d'approbation et état inconnu", () => {
    expect(requestStateLabel(input({ state: "PENDING_APPROVAL" }))).toBe("En attente d'approbation");
    expect(requestStateLabel(input({ state: "REVISION_REQUIRED" }))).toBe("À réviser");
    expect(requestStateLabel(input({ state: "FUTUR_ETAT" }))).toBe("FUTUR_ETAT");
  });
});

describe("cancelActionFor (D-19)", () => {
  it("annulation avant réclamation, demande d'annulation après, rien une fois terminée ou déjà demandée", () => {
    expect(cancelActionFor("READY_FOR_FULFILMENT", false)).toBe("CANCEL");
    expect(cancelActionFor("PENDING_APPROVAL", false)).toBe("CANCEL");
    expect(cancelActionFor("IN_PROGRESS", false)).toBe("REQUEST_CANCEL");
    expect(cancelActionFor("BLOCKED", false)).toBe("REQUEST_CANCEL");
    expect(cancelActionFor("BLOCKED", true)).toBeNull();
    expect(cancelActionFor("COMPLETED", false)).toBeNull();
    expect(cancelActionFor("CANCELLED", false)).toBeNull();
    expect(cancelActionFor("REJECTED", false)).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/access-request-labels.test.ts`
Expected: FAIL — module `@/lib/access/request-labels` introuvable.

- [ ] **Step 2: Créer `lib/access/request-labels.ts`**

```ts
// lib/access/request-labels.ts
// Libellés français des états d'une demande pour « Mes demandes » (phase 3b,
// spec §8). Logique pure : utilisable côté serveur comme côté client.

export interface RequestStateLabelInput {
  state: string;
  periodStart: string;
  completedAt: string | null;
  taskReason: string | null;
  cancelRequested: boolean;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}

export function requestStateLabel(input: RequestStateLabelInput): string {
  const suffix = input.cancelRequested ? " · annulation demandée" : "";
  switch (input.state) {
    case "PENDING_APPROVAL":
      return "En attente d'approbation";
    case "CLARIFICATION_REQUIRED":
      return "Clarification demandée";
    case "REVISION_REQUIRED":
      return "À réviser";
    case "AUTHORIZED_WAITING_START":
      return `Autorisée — début le ${day(input.periodStart)}`;
    case "READY_FOR_FULFILMENT":
      return "Prête — en attente du propriétaire";
    case "IN_PROGRESS":
      return `En cours d'exécution${suffix}`;
    case "BLOCKED":
      return `Bloquée : ${input.taskReason ?? "motif non précisé"}${suffix}`;
    case "COMPLETED":
      return input.completedAt ? `Exécutée le ${day(input.completedAt)}` : "Exécutée";
    case "REJECTED":
      return "Rejetée";
    case "CANCELLED":
      return "Annulée";
    default:
      return input.state;
  }
}

export const REQUEST_KIND_LABELS: Record<string, string> = {
  GRANT: "Octroi",
  UPGRADE: "Montée de niveau",
  RENEW: "Renouvellement",
  REDUCE: "Réduction",
  REVOKE: "Révocation",
};

/**
 * Action d'annulation offerte à l'initiateur (D-19) : annulation effective
 * avant réclamation, simple demande après, plus rien une fois demandée ou
 * la demande terminée.
 */
export function cancelActionFor(state: string, cancelRequested: boolean): "CANCEL" | "REQUEST_CANCEL" | null {
  if (
    state === "PENDING_APPROVAL" ||
    state === "CLARIFICATION_REQUIRED" ||
    state === "REVISION_REQUIRED" ||
    state === "AUTHORIZED_WAITING_START" ||
    state === "READY_FOR_FULFILMENT"
  ) {
    return "CANCEL";
  }
  if ((state === "IN_PROGRESS" || state === "BLOCKED") && !cancelRequested) return "REQUEST_CANCEL";
  return null;
}
```

Run: `npx vitest run tests/unit/access-request-labels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Modifier `app/(dashboard)/requests/mine/page.tsx`**

(a) Après `import { getEffectiveRoleHolders } from "@/lib/access/roles-server";`, ajouter :

```ts
import { REQUEST_KIND_LABELS, requestStateLabel } from "@/lib/access/request-labels";
```

(b) Dans `serializedRequests`, après `periodEnd: r.periodEnd ? r.periodEnd.toISOString() : null,`, ajouter :

```ts
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    cancelRequestedAt: r.cancelRequestedAt ? r.cancelRequestedAt.toISOString() : null,
```

(c) Remplacer `<td className="py-1">{r.kind}</td>` par :

```tsx
                  <td className="py-1">{REQUEST_KIND_LABELS[r.kind] ?? r.kind}</td>
```

(d) Dans la cellule « Statut », remplacer la ligne `{r.state}` par :

```tsx
                    {requestStateLabel({
                      state: r.state,
                      periodStart: r.periodStart,
                      completedAt: r.completedAt,
                      taskReason: r.taskReason,
                      cancelRequested: r.cancelRequestedAt !== null,
                    })}
```

(e) Dans les props `row={{ … }}` de `MyRequestActions`, après `state: r.state,`, ajouter :

```tsx
                        cancelRequested: r.cancelRequestedAt !== null,
```

- [ ] **Step 4: Modifier `components/access/MyRequestActions.tsx`**

(a) Après `import { useRouter } from "next/navigation";`, ajouter :

```ts
import { cancelActionFor } from "@/lib/access/request-labels";
```

(b) Dans `interface RequestRow`, après `state: string;`, ajouter `cancelRequested: boolean;`.

(c) Supprimer la constante `CANCELLABLE_STATES` (tout le tableau).

(d) Remplacer `const canCancel = CANCELLABLE_STATES.includes(row.state);` par :

```ts
  // Phase 3b (D-19) : annulation effective avant réclamation, simple demande
  // d'annulation une fois la tâche réclamée par le propriétaire.
  const cancelAction = cancelActionFor(row.state, row.cancelRequested);
```

(e) Remplacer le bloc `{canCancel && ( … )}` par :

```tsx
      {cancelAction && (
        <button
          type="button"
          disabled={busy}
          onClick={cancel}
          className="text-[10px] text-red underline text-left"
        >
          {cancelAction === "CANCEL" ? "Annuler la demande" : "Demander l'annulation"}
        </button>
      )}
      {row.cancelRequested && (row.state === "IN_PROGRESS" || row.state === "BLOCKED") && (
        <p className="text-[10px] text-izi-gray">Annulation demandée — en attente du propriétaire</p>
      )}
```

(la fonction `cancel()` et la route `POST /api/access/requests/[requestId]/cancel` sont inchangées : le service décide entre annulation et demande d'annulation.)

- [ ] **Step 5: Calculer le drapeau côté serveur dans `app/(dashboard)/layout.tsx`**

(a) Après `import { registerNavFlags } from "@/lib/access/register";`, ajouter :

```ts
import { getFulfilmentAssetIds } from "@/lib/access/fulfilment-server";
import { fulfilmentNavFlags } from "@/lib/access/fulfilment";
```

(b) Remplacer `const [products, departments, unresolvedAlertCount, myNotificationCount, accessRoles, ownedAssetIds] = await Promise.all([` par :

```ts
  const [
    products,
    departments,
    unresolvedAlertCount,
    myNotificationCount,
    accessRoles,
    ownedAssetIds,
    fulfilmentAssetIds,
  ] = await Promise.all([
```

(c) Dans ce même `Promise.all`, après `getOwnedAssetIds(orgId, userId),`, ajouter :

```ts
    getFulfilmentAssetIds(prisma, orgId, userId),
```

(d) Remplacer `const registerFlags = registerNavFlags(resolveReadScopes(userId, accessRoles, ownedAssetIds));` par :

```ts
  const readScopes = resolveReadScopes(userId, accessRoles, ownedAssetIds);
  const registerFlags = registerNavFlags(readScopes);
  // Écran « Exécution » (phase 3b, D-15) : au moins un actif d'exécution
  // (archivés compris) ou la portée ALL — calculé côté serveur, comme ci-dessus.
  const fulfilmentFlags = fulfilmentNavFlags(readScopes, fulfilmentAssetIds);
```

(e) Dans `<DashboardShell … />`, après `canViewOwnedAssetsAccess={registerFlags.hasOwnedAssetsView}`, ajouter :

```tsx
      canViewFulfilment={fulfilmentFlags.hasFulfilmentView}
```

- [ ] **Step 6: Transmettre la prop dans `components/layout/DashboardShell.tsx`**

Trois ajouts, chacun juste après la ligne homologue de `canViewOwnedAssetsAccess` :
- dans `interface DashboardShellProps` : `canViewFulfilment: boolean;`
- dans la déstructuration des props : `canViewFulfilment,`
- dans `<Sidebar … />` : `canViewFulfilment={canViewFulfilment}`

- [ ] **Step 7: Ajouter le lien dans `components/layout/Sidebar.tsx`**

(a) Dans `interface SidebarProps`, après `canViewOwnedAssetsAccess?: boolean;`, ajouter `canViewFulfilment?: boolean;` ; dans la déstructuration des props, après `canViewOwnedAssetsAccess,`, ajouter `canViewFulfilment,`.

(b) Juste après le bloc `{canViewOwnedAssetsAccess && ( … Mes actifs … )}`, ajouter :

```tsx
              {canViewFulfilment && (
                <Link
                  href="/access/fulfilment"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/fulfilment"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  Exécution
                </Link>
              )}
```

(Les classes, dont `text-[#7dd8d8]`, sont copiées à l'identique des liens voisins de la section « Accès » — aucune nouvelle couleur en dur n'est introduite.)

- [ ] **Step 8: Vérifier**

Run: `npx vitest run tests/unit/access-request-labels.test.ts tests/unit/access-fulfilment.test.ts && npx tsc --noEmit && npx eslint lib/access/request-labels.ts "app/(dashboard)/requests/mine/page.tsx" components/access/MyRequestActions.tsx "app/(dashboard)/layout.tsx" components/layout/DashboardShell.tsx components/layout/Sidebar.tsx && npm run build`
Expected: tests verts (dont `fulfilmentNavFlags`, Tâche 2) ; aucune erreur de type ; ESLint : aucune erreur (deux avertissements préexistants `'products'` / `'departments'` inutilisés dans `Sidebar.tsx` sont acceptables) ; build réussi.

- [ ] **Step 9: Commit**

```bash
git add lib/access/request-labels.ts tests/unit/access-request-labels.test.ts "app/(dashboard)/requests/mine/page.tsx" components/access/MyRequestActions.tsx "app/(dashboard)/layout.tsx" components/layout/DashboardShell.tsx components/layout/Sidebar.tsx
git commit -m "feat(access): mes demandes — états d'exécution et demande d'annulation ; lien Exécution calculé côté serveur" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16 : Vérification finale de la phase 3b

**Files:** aucun fichier nouveau — vérification globale (corrections éventuelles dans les fichiers des tâches précédentes).

- [ ] **Step 1: Suite de tests complète**

Run: `npm test`
Expected: tous les fichiers passent, dont `tests/unit/access-fulfilment.test.ts`, `access-fulfilment-validation.test.ts`, `access-request-labels.test.ts`, `access-processor-route.test.ts` et, sous `tests/unit/access-db/`, `access-constraints`, `requests-server`, `requests-read-server`, `fulfilment-server`, `fulfilment-read-server`, `access-processor`, `fulfilment-routes`. Relancer deux fois de plus : les tests de concurrence ne doivent jamais échouer.

- [ ] **Step 2: Types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lint ciblé**

Run: `npx eslint lib/access lib/validations/access.ts app/api/access app/api/cron/access-processor "app/(dashboard)/access" "app/(dashboard)/requests" "app/(dashboard)/layout.tsx" components/access components/layout/Sidebar.tsx components/layout/DashboardShell.tsx tests/unit/access-db tests/unit/access-fulfilment.test.ts tests/unit/access-fulfilment-validation.test.ts tests/unit/access-request-labels.test.ts tests/unit/access-processor-route.test.ts`
Expected: 0 erreur ; seuls avertissements tolérés : les deux préexistants de `Sidebar.tsx`.

- [ ] **Step 4: Build de production**

Run: `npm run build`
Expected: build réussi ; la sortie liste `/access/fulfilment`, `/api/access/tasks`, `/api/access/tasks/[taskId]/{claim,handover,block,resume,complete,reconcile}`, `/api/access/tasks/claim-batch`, `/api/access/tasks/complete-batch`, `/api/cron/access-processor`.

- [ ] **Step 5: Migrations et dérive**

Run: `npx prisma migrate status && npx prisma migrate diff --from-url "$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null`
Expected: `Database schema is up to date!` ; aucun changement sur une table `access_*` (la dérive locale `mobile_refresh_tokens` est hors périmètre). Avant la mise en production, rejouer les deux migrations sur une copie des données de production (D-21 : pas de rattrapage SQL, mais l'index `one_open_request_per_pair` échouerait si deux demandes existaient déjà pour un même couple — impossible avec l'unique 3a, à constater quand même).

- [ ] **Step 6: Revue des cinq points du Review Focus**

Confirmer pour chacun qu'un test réel existe et passe (`npx vitest run <fichier> -t "<extrait du nom>"`) :
1. Propriétaire remplacé après réclamation — `fulfilment-server.test.ts`, « Review Focus #1 ».
2. Propriétaire bénéficiaire de sa propre demande — `fulfilment-server.test.ts`, « Review Focus #2 ».
3. Actif archivé — `fulfilment-server.test.ts`, « Review Focus #3 » ; `fulfilment-read-server.test.ts`, « Review Focus #3 ».
4. Annulation et réclamation simultanées — `fulfilment-server.test.ts`, « Review Focus #4 ».
5. Preuve vide / date future — `access-fulfilment.test.ts` et `access-fulfilment-validation.test.ts`, « Review Focus #5 » ; `fulfilment-routes.test.ts`, « 400 sur corps invalide ».

Si un point n'a pas de test vert, l'ajouter dans la tâche propriétaire avant de clore la phase.

- [ ] **Step 7: Passage navigateur sur un build de production local (port 3005)**

Préparation (données locales uniquement — ne jamais viser la préproduction ni la production) :

```bash
npm run build
NEXTAUTH_URL=http://localhost:3005 npx next start -p 3005 > /tmp/izipilot-3b.log 2>&1 &
```

Connexion : e-mail + mot de passe (`password123` pour les comptes du seed `@izichange.com`), puis code OTP à 6 chiffres lu dans le journal : `grep "code de connexion" /tmp/izipilot-3b.log | tail -1`. Si un compte exige un changement de mot de passe : `docker compose exec db psql -U izipilot -d izipilot -c "UPDATE users SET \"mustChangePassword\" = false WHERE email = '<email>';"`.

Jeu de données local (la base locale peut être préparée directement par `psql` ou par l'interface — jamais une base distante) : choisir quatre comptes du seed — **demandeur** (employé avec un département principal résolu dans `/access/roles`), **propriétaire**, **suppléant**, **CISO** (rôle attribué dans `/access/roles` par le CEO ; un COO doit aussi exister). Dans `/access/assets`, créer ou choisir une application ouverte aux demandes avec deux niveaux (priorités 1 et 5), propriétaire et suppléant renseignés. Le chef du département du demandeur doit être un cinquième compte (ou le suppléant de chef configuré en phase 3a).

Parcours à vérifier (largeur mobile 390 px puis bureau) :

| Compte | Vérification |
|---|---|
| Demandeur | `/requests/mine` : soumettre une demande (niveau 1). Statut « En attente d'approbation ». Pas de lien « Exécution » dans la barre latérale ; `/access/fulfilment` en URL directe → 404. |
| Propriétaire | Avant approbation : onglet « À faire » **sans** cette demande (A05). |
| Chef puis CISO | `/requests/approvals` : approuver. |
| Demandeur | Statut « Prête — en attente du propriétaire » ; bouton « Annuler la demande ». |
| Propriétaire | Lien « Exécution » visible. Carte : employé, département, application, « Accorder », « Aucun accès → niveau », motif, résumé d'approbation, historique « Libérée ». **Réclamer** → « En cours ». |
| Demandeur | Statut « En cours d'exécution » ; bouton « Demander l'annulation » → statut « … · annulation demandée ». |
| Propriétaire | Bandeau « Le demandeur a demandé l'annulation » ; bouton « Réconcilier » présent. Ne pas réconcilier : **Signaler un blocage** (motif) → carte « Bloquée ». |
| Demandeur | Statut « Bloquée : <motif> » (les faits internes n'apparaissent pas). |
| Suppléant | Voit la tâche bloquée ; **Reprendre** (devient détenteur) ; **Passer la main** au propriétaire avec motif. |
| Propriétaire | **Confirmer** : sans référence ni note → message d'erreur ; avec référence → tâche dans « Historique », « Exécutée le … ». Double-cliquer « Enregistrer » ne crée pas de doublon. |
| Demandeur | Statut « Exécutée le … » ; `/access/me` affiche le nouvel accès. |
| Propriétaire | `/access/owned-assets` affiche l'accès (source demande, confirmé). |
| Demandeur | Nouvelle demande vers le niveau 5 (montée), approuvée. |
| Propriétaire | Confirmer avec « Retrait puis octroi » + « Seul l'ancien niveau a été retiré » → carte « Bloquée », `/access/me` du demandeur n'affiche plus l'accès ; Reprendre → Confirmer → niveau 5. |
| Propriétaire | Deux autres demandes approuvées (deux employés) : cocher les deux, « Réclamer la sélection », puis « Confirmer la sélection » avec une référence par tâche → résultat par élément affiché. |
| CISO | `/access/fulfilment` : seul l'onglet « Supervision », lecture seule (aucun bouton), « Ouvertes / Terminées » ; une tâche sur une application sans propriétaire affiche « Aucun propriétaire — à affecter ». |
| Processeur | Donner un accès temporaire échu : `docker compose exec db psql -U izipilot -d izipilot -c "UPDATE access_assignments SET \"periodEnd\" = now() - interval '1 hour' WHERE id = '<id>';"`, puis `curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET' .env | cut -d= -f2- | tr -d '"')" http://localhost:3005/api/cron/access-processor` → `{"ok":true,…,"expired":1,…}` ; relancer → `"expired":0`. Chez le propriétaire : tâche « Retirer — fin de période », motif « Fin de période temporaire ». Sans en-tête : 401. |
| Tous | `/access/audit` (lecteur d'audit) : événements `TASK_RELEASED`, `TASK_CLAIMED`, `TASK_BLOCKED`, `TASK_RESUMED`, `TASK_HANDED_OVER`, `TASK_COMPLETED`, `TASK_PARTIAL_REMOVAL`, `REQUEST_CANCEL_REQUESTED`, `ASSIGNMENT_EXPIRED` présents. |

Arrêter le serveur : `kill %1` (ou `lsof -ti:3005 | xargs kill`).

- [ ] **Step 8: Commit final si des ajustements ont été faits**

```bash
git add -A -- lib app components tests prisma cron
git commit -m "chore(access): vérification finale de la phase 3b (tests, types, lint, build, navigateur)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Si aucun ajustement n'était nécessaire, ne rien committer à cette étape.

---

## Couverture de la spec (auto-revue)

| Spec | Tâche(s) |
|---|---|
| D-1, D-3, D-20, D-21, §4 (modèle, index partiels, deux migrations) | 1 |
| §5 machines à états, tableau d'effets ; §6 fonctions pures ; §7 validation Zod | 2 |
| D-2 (libération, 3 sites + idempotence), D-5 (`getFulfilmentAssetIds`), D-8 (erreurs typées) | 3, 4 |
| D-4, D-4a (fermeture, historique, index partiel, `listMyRequests`) | 1, 4, 5 |
| D-19 (annulation avant/après réclamation) | 4, 7 |
| D-9, D-12 (revérifications), réclamer, passer la main | 6 |
| Bloquer, reprendre, réconcilier (§5) | 7 |
| D-9 (confirmation), D-10 (remplacement), D-23 (supplantation), D-7 (`selfFulfilled`), A16–A18 | 8 |
| D-13 (lots, `correlationId`) | 9 |
| D-6, D-14, D-16 (DTO propriétaire, supervision, confidentialité), A05 | 5, 10 |
| D-11 (processeur, 4 devoirs, acteur SYSTEM), A19 | 11, 13 |
| D-8, D-22, §7 (routes, codes) | 12, 13 |
| D-15, §8 (écran, libellés, barre latérale) | 14, 15 |
| D-18 (types d'audit) | 3, 4, 6–9, 11 |
| D-17 (IZIPILOT), entité `Batch`, réactions proactives, export, notifications | hors périmètre (spec §2) |
| §10 vérification finale | 16 |
