# Gestion des accès — Phase 3b : exécution des demandes (conception)

Date : 2026-09-30 · Statut : décisions prises par l'agent (l'utilisateur a demandé « complete without stop ») — chaque décision est marquée **D-n** et justifiée · Chemin d'analyse : architectural

Sources : `/Users/mariusokouin/Downloads/FEATURE-PROMPT.md` (« FP:ligne », v1 faisant autorité), `/Users/mariusokouin/Downloads/REFINEMENT-QUESTIONS.md` (« RQ:ligne »), spec 3a `docs/superpowers/specs/2026-09-29-access-management-phase3a-requests-design.md`, recherche `.superpowers/sdd/phase3b-research/research.md`.

## 1. Contexte et intention

La phase 3a s'arrête quand une version de demande atteint `READY_FOR_FULFILMENT` ou `AUTHORIZED_WAITING_START` : aucun accès réel ne change, aucune tâche n'existe. Aujourd'hui une demande approuvée ne va donc nulle part.

La phase 3b fait le pont entre « approuvé » et « accès enregistré » (FP:43 : « Approval is not provisioning. Update current access only after owner confirmation ») :

- une **tâche d'exécution** est libérée pour le propriétaire/suppléant de l'actif dès qu'une version est autorisée ;
- le propriétaire la **réclame**, fait le changement **à la main** dans l'application cible, puis **confirme** avec une date réelle et une référence ou une note (FP:239) ; il peut **signaler un blocage**, **reprendre**, **passer la main** ;
- la confirmation met à jour l'**affectation courante** (`AccessAssignment`) et son historique, de façon atomique et idempotente ;
- un **processeur toutes les 5 minutes** libère les demandes à début futur et crée le travail de retrait des accès temporaires expirés (FP:229) ;
- les propriétaires peuvent **réclamer et confirmer en lot** (FP:254).

**Critères de réussite**

- Une demande approuvée apparaît chez le propriétaire/suppléant de l'actif, et seulement chez eux (et en lecture pour CISO/COO) ; jamais avant son autorisation (FP:44, A05).
- Après confirmation, « Mes accès », la vue département et « Mes actifs » (phase 2b) affichent le nouvel état ; l'historique garde l'ancien niveau.
- Deux confirmations concurrentes ne créent jamais deux niveaux courants (A16) ; rejouer une confirmation ne duplique rien (A17).
- Un remplacement raté après retrait de l'ancien niveau enregistre « aucun accès » et un travail bloqué, jamais un faux succès (A18).
- L'expiration est idempotente et ne retire rien elle-même (A19).
- Aucun appel externe, aucune notification (A25).

## 2. Périmètre

**Inclus** : modèle de tâche et d'événements de tâche ; libération des tâches ; réclamer / passer la main / bloquer / reprendre / confirmer / réconcilier ; lots réclamer/confirmer ; processeur 5 minutes ; annulation tenant compte du claim ; conservation de l'historique des demandes (correction 3a, D-4) ; écran « Exécution » propriétaires + supervision CISO/COO ; états nouveaux visibles dans « Mes demandes ».

**Exclus** (phases suivantes) : onboarding RH et départs (phase 4), transferts (phase 5), référence d'actif IZIPILOT et tâches création/désactivation de compte (D-17, phase 4), entité `Batch` persistante (D-13), réactions proactives aux changements de rôle/département/priorité (D-12 : couvertes par les revérifications au claim/à la confirmation), export CSV des tâches, notifications.

## 3. Décisions

- **D-1 Modèle.** Nouveau modèle `AccessFulfilmentTask` (nom distinct de la `Task` Kanban existante) + journal append-only `AccessTaskEvent`. Une tâche a une **source** : une version de demande (`requestVersionId`, FK `Restrict`) ou une expiration (`sourceAssignmentId` + `sourceAssignmentVersion`). Clé d'idempotence unique (`REQ:<versionId>` ou `EXP:<assignmentId>:<version>`). Réutilisable par les phases 4/5.
- **D-2 Libération.** La tâche est créée **dans la même transaction** que le passage à `READY_FOR_FULFILMENT` (3 sites 3a : `submitRequest` exception COO, `decideStage` dernière approbation, `reviseRequest` sans étape) via un helper unique `releaseTaskInTx`. `AUTHORIZED_WAITING_START` n'a pas de tâche : le processeur la libère à `periodStart`. Le processeur recrée aussi toute tâche manquante pour une version `READY_FOR_FULFILMENT` (auto-réparation et rattrapage des demandes déjà prêtes en production) — l'unicité de la clé rend l'opération idempotente. Pas d'outbox : tout est dans la même base (FP:291 ne l'exige que pour un sous-système séparé).
- **D-3 États de demande.** Ajout à `AccessRequestState` : `IN_PROGRESS`, `BLOCKED`, `COMPLETED` (FP:279-281), dans une migration dédiée (`ALTER TYPE … ADD VALUE`). La version suit la tâche : claim → `IN_PROGRESS`, blocage → `BLOCKED`, reprise → `IN_PROGRESS`, confirmation → `COMPLETED` (+ `outcome`, `completedAt`), réconciliation « rien fait » → `CANCELLED`. Transitions uniquement dans le service d'exécution, dans la même transaction que la tâche.
- **D-4 Historique conservé (correction 3a).** Le code 3a **supprime** `AccessRequest` au rejet/à l'annulation et la cascade efface versions et étapes — contraire à FP:92/352 et au texte même de la spec 3a (:80). Correction : champ `AccessRequest.closedAt`, plus aucune suppression ; l'unicité « une demande non terminale par employé/actif » devient un **index unique partiel** `WHERE "closedAt" IS NULL` (SQL brut dans la migration, l'unique Prisma est retiré du schéma). Fermeture (`closedAt = now`) sur : rejet, annulation, confirmation, réconciliation. Les lectures 3a qui supposaient « toute demande existante est ouverte » sont revues (D-4a ci-dessous).
  - **D-4a** : `listMyApprovals` ne change pas (filtre par état). `listMyRequests` montre désormais l'historique (états terminaux compris) trié par date — comportement voulu. Toute recherche « demande ouverte » (soumission, `reducible`) filtre `closedAt: null`.
- **D-5 Propriétaire résolu en direct.** La tâche ne stocke pas de propriétaire : la visibilité et le droit d'agir se calculent depuis `AccessAsset.ownerId/backupOwnerId` au moment de l'action (FP:112 « reassign unfinished unclaimed tasks » est ainsi automatique). Le suppléant agit à tout moment (FP:83). L'acteur doit être disponible (`isAvailable`). Les actifs **archivés** restent dans le périmètre d'exécution (le retrait doit rester possible, FP:110) : nouveau helper `getFulfilmentAssetIds(client, orgId, userId)` (inclut archivés, accepte un `tx`), distinct de `getOwnedAssetIds` (registre, non archivés).
- **D-6 Ce que voit le propriétaire.** Uniquement des tâches (qui n'existent qu'une fois le travail autorisé) sur ses actifs : ouvertes (`READY`, `CLAIMED`, `BLOCKED`) et historique (`COMPLETED`, `CANCELLED`). Jamais de versions en attente/rejetées ni leurs comptes (A05, FP:255). Champs : employé, département, actif, action, niveau actuel → cible, période, référence courte, résumé d'approbation (rôle, décision, date — sans les motifs internes), justification de la demande, commentaires opérationnels (événements de tâche). Pour une tâche d'expiration : motif générique « Fin de période temporaire ».
- **D-7 Indépendance à l'exécution.** Aucune règle au-delà du périmètre (la spec n'en pose pas ; FP:39/RQ:22 : le propriétaire exécute même la demande personnelle du COO). L'audit marque `selfFulfilled: true` quand l'acteur est le bénéficiaire.
- **D-8 Services et API.** Fonctions `(orgId, actorId, …)` dans `lib/access/fulfilment-server.ts` ; erreurs typées `FulfilmentError` avec `code` : `NOT_FOUND` (hors périmètre compris) → 404, `STALE` et `INVALID_TRANSITION` → 409, `VALIDATION` → 400 (FP:337 : erreurs distinguables). Passation de main : vers l'autre propriétaire/suppléant disponible de l'actif uniquement, motif obligatoire ; peut être faite par le détenteur **ou** par tout propriétaire/suppléant courant (nécessaire quand le détenteur a perdu son périmètre, FP:241/FP:112).
- **D-9 Confirmation.** Une transaction : garde conditionnelle sur l'état de la tâche et son détenteur ; revérification (FP:245) de la version courante (état, `revision`), du périmètre de l'acteur, du cycle de vie du bénéficiaire (ACTIVE requis pour une attribution/renouvellement ; tout cycle accepté pour un retrait, FP:124), de l'actif/niveau (non archivé pour une attribution, `catalogueVersion` identique), de `assignment.version` identique à la valeur attendue par la tâche, et de `periodEnd` encore dans le futur pour une attribution temporaire. Puis écriture de l'affectation unique (`@@unique([userId, assetId])` : upsert), `version` +1, `AccessAssignmentEvent`, événements de tâche et d'audit, état de la version et fermeture de la demande. Échec de revérification → 409 `STALE` avec un message actionnable ; si l'owner a malgré tout fait un changement externe, il le déclare par « Signaler un blocage » (faits enregistrés, aucune écriture d'affectation), et la correction passe par une nouvelle demande (FP:245).
- **D-10 Remplacement de niveau** (`CHANGE_LEVEL`). À la confirmation, l'owner indique la méthode : `DIRECT` (remplacement natif) ou `REMOVE_THEN_GRANT`. En `REMOVE_THEN_GRANT`, il peut enregistrer l'étape 1 seule (« ancien niveau retiré, nouvel accès pas encore accordé ») : affectation → `levelId: null`, `status: REVOKED`, `version` +1, tâche et version → `BLOCKED` avec `progress.oldRemovedAt`, `expectedAssignmentVersion` mis à jour. Après reprise, la confirmation accorde le nouveau niveau. Jamais deux niveaux courants, jamais de succès sans les deux faits (FP:243, A18). Pas de champ catalogue « remplacement direct disponible » (FP:104 n'en prévoit pas) : l'owner le déclare.
- **D-11 Processeur 5 minutes.** Route `GET /api/cron/access-processor` protégée par `verifyCronSecret`, ligne `*/5 * * * *` dans `cron/crontab` (le conteneur cron Docker est l'ordonnanceur réel ; `vercel.json` n'est pas utilisé en production et le plan Vercel Hobby interdit les 5 minutes — non modifié). Quatre devoirs idempotents, par organisation active, bornés à 200 lignes par devoir et par passage :
  1. versions `AUTHORIZED_WAITING_START` avec `periodStart <= now` → `READY_FOR_FULFILMENT` + tâche ;
  2. versions `READY_FOR_FULFILMENT` sans tâche → tâche (auto-réparation) ;
  3. affectations `ACTIVE` avec `periodEnd <= now` → `EXPIRED_REMOVAL_PENDING` + tâche `EXPIRY_REMOVAL` (une par version d'affectation). Le niveau courant est conservé jusqu'à confirmation du retrait ; **`version` n'est pas incrémentée** par l'expiration (le niveau ne change pas), ce qui permet à un renouvellement approuvé de la supplanter (FP:231) ;
  4. tâches `READY` (non réclamées) dont la version a une `periodEnd <= now` → tâche `CANCELLED`, version `REVISION_REQUIRED` (motif « Fin de période dépassée avant exécution ») : la demande doit être révisée (FP:231).
  Acteur système : `actorId: "SYSTEM"` dans l'audit (colonne sans FK), `actorId: null` dans `AccessAssignmentEvent`. Chevauchement de passages : l'unicité des clés suffit, pas de verrou consultatif.
- **D-12 Changements concurrents** (rôle, département, priorité, propriétaire) : couverts par les revérifications au claim et à la confirmation (D-9) — une action périmée est refusée, jamais appliquée. Les réactions proactives (invalider/rerouter à l'avance) sont reportées à une phase de durcissement.
- **D-13 Lots.** Réclamer et confirmer en lot sans entité persistante : appels indépendants par élément (comme `decideBatch` en 3a), 100 éléments max, résultat par élément, un `correlationId` (uuid) par appel stocké dans l'audit (FP:348). Chaque élément de confirmation porte sa propre référence/note (FP:254). L'entité `Batch` de FP:272 est reportée à la phase 4 (lots de retraits RH).
- **D-14 Supervision.** « Mes demandes » affiche les nouveaux états et, pour une demande en exécution, l'état de la tâche et le motif de blocage (motif métier, pas les faits internes de l'owner). CISO/COO (portée `ALL`) voient toutes les tâches en lecture sur l'écran « Exécution » (onglet « Supervision »), y compris les tâches sur actifs **sans propriétaire** signalées « Aucun propriétaire — à affecter » (FP:216/312).
- **D-15 Écran.** Nouvelle page `/access/fulfilment` « Exécution », lien de barre latérale si l'utilisateur a au moins un actif d'exécution ou la portée `ALL`. Mobile d'abord (cartes empilées, actions en bas de carte), français, états chargement/vide/erreur.
- **D-16 Confidentialité.** Le DTO propriétaire a un champ explicite `ownerReason` (justification pour une demande, texte générique pour une expiration) ; aucun champ RH n'existe encore. Aucun secret dans les notes (message d'aide dans le formulaire).
- **D-17 IZIPILOT** : reporté (phase 4). L'énumération d'actions reste extensible.
- **D-18 Audit.** Types : `TASK_RELEASED`, `TASK_CLAIMED`, `TASK_HANDED_OVER`, `TASK_BLOCKED`, `TASK_RESUMED`, `TASK_COMPLETED`, `TASK_PARTIAL_REMOVAL`, `TASK_RECONCILED`, `TASK_CANCELLED`, `ASSIGNMENT_EXPIRED`, `REQUEST_CANCEL_REQUESTED`, `REQUEST_RELEASED`. Toujours `recordAuditInTx`. `objectType: "AccessFulfilmentTask"`, `scopeType: "ASSET"`, `scopeId: assetId`. `actorRole` reste `null` pour un propriétaire (pas de valeur d'énumération dédiée) ; `after.actingAs` = `"ASSET_OWNER"` ou `"ASSET_OWNER_BACKUP"`, `primaryCoveredId` = propriétaire principal quand le suppléant agit (FP:86).
- **D-19 Annulation.** `cancelRequest` (3a) devient sensible à l'exécution : avant claim (`PENDING_APPROVAL`, `CLARIFICATION_REQUIRED`, `REVISION_REQUIRED`, `AUTHORIZED_WAITING_START`, `READY_FOR_FULFILMENT`) → annulation effective, tâche `READY` → `CANCELLED`, demande fermée. Après claim (`IN_PROGRESS`, `BLOCKED`) → `cancelRequestedAt` posé sur la version, audit `REQUEST_CANCEL_REQUESTED`, rien d'autre : l'owner réconcilie (« aucune modification effectuée » → `CANCELLED`) ou confirme factuellement (FP:170).
- **D-20 Concurrence.** Idiome existant : `updateMany` conditionnel (état + `revision`) en Read Committed, comparaison-échange sur `assignment.version`, index uniques partiels : une tâche ouverte par version de demande, une tâche ouverte par (affectation, version) pour l'expiration.
- **D-21 Migrations.** Deux fichiers : (a) `ALTER TYPE "AccessRequestState" ADD VALUE …` seul ; (b) tables, colonnes, index partiels, suppression de l'unique 3a. Pas de rattrapage SQL de données (les tâches manquantes sont créées par le processeur, D-2) — donc pas de test sur copie de prod requis, mais le test sera fait quand même avant la mise en production.
- **D-22** Nouvelles routes en français (`"Non authentifié"`), codes d'erreur distinguables (D-8).
- **D-23 Renouvellement d'un accès expiré.** Le routage 3a classe une demande sur une affectation `EXPIRED_REMOVAL_PENDING` comme `GRANT`. On ne change pas le routage ; la confirmation d'une attribution sur une ligne existante gère le cas : si une tâche d'expiration **non réclamée** existe pour cette affectation, elle est annulée (`CANCELLED`, motif « Supplantée par un renouvellement ») dans la même transaction et l'affectation redevient `ACTIVE` avec la nouvelle période ; si elle est **réclamée**, la confirmation est refusée (`STALE`, « un retrait est en cours — à réconcilier ») (FP:231, A19).

## 4. Modèle de données

```prisma
enum AccessTaskAction { GRANT CHANGE_LEVEL RENEW REVOKE EXPIRY_REMOVAL }
enum AccessTaskState  { READY CLAIMED BLOCKED COMPLETED CANCELLED }
enum AccessTaskEventType { RELEASED CLAIMED HANDED_OVER BLOCKED RESUMED PARTIAL_REMOVAL COMPLETED RECONCILED CANCELLED }

model AccessFulfilmentTask {
  id                        String           @id @default(cuid())
  orgId                     String
  assetId                   String
  beneficiaryId             String
  action                    AccessTaskAction
  state                     AccessTaskState  @default(READY)
  requestVersionId          String?          // source demande (FK Restrict)
  sourceAssignmentId        String?          // source expiration
  sourceAssignmentVersion   Int?
  fromLevelId               String?          // niveau courant attendu à la libération
  toLevelId                 String?          // niveau cible (null pour retrait)
  periodStart               DateTime?
  periodEnd                 DateTime?
  expectedAssignmentVersion Int              // 0 = aucune affectation
  claimantId                String?
  claimedAt                 DateTime?
  blockedReason             String?          @db.Text
  progress                  Json?            // { oldRemovedAt?: ISO }
  completedAt               DateTime?        // date réelle déclarée
  completionReference       String?
  completionNote            String?          @db.Text
  completionMethod          String?          // DIRECT | REMOVE_THEN_GRANT
  completedById             String?
  outcome                   String?          // PROVISIONED | CHANGED | RENEWED | REVOKED | REMOVED | NOT_PERFORMED | SUPERSEDED | EXPIRED_BEFORE_FULFILMENT
  idempotencyKey            String           @unique
  revision                  Int              @default(1)
  releasedAt                DateTime         @default(now())
  createdAt                 DateTime         @default(now())
  updatedAt                 DateTime         @updatedAt
  // relations : org (Cascade), asset (Restrict), requestVersion (Restrict), events
  // index : [orgId, state], [orgId, assetId, state], [requestVersionId], [sourceAssignmentId]
  @@map("access_fulfilment_tasks")
}

model AccessTaskEvent {
  id         String              @id @default(cuid())
  orgId      String
  taskId     String
  type       AccessTaskEventType
  actorId    String?             // null = système
  actingAs   String?             // ASSET_OWNER | ASSET_OWNER_BACKUP | SYSTEM
  toUserId   String?             // passation
  reason     String?             @db.Text
  facts      Json?
  occurredAt DateTime            @default(now())
  // relation task (Cascade) ; index [taskId, occurredAt]
  @@map("access_task_events")
}
```

Colonnes ajoutées :
- `AccessRequest.closedAt DateTime?` ; l'`@@unique([orgId, beneficiaryId, assetId])` est retiré du schéma et remplacé en SQL par `CREATE UNIQUE INDEX "one_open_request_per_pair" ON "access_requests" ("orgId","beneficiaryId","assetId") WHERE "closedAt" IS NULL;` (l'ancien index `one_nonterminal_request_enforced_in_service` est supprimé).
- `AccessRequestVersion.outcome String?`, `completedAt DateTime?`, `cancelRequestedAt DateTime?`.

Index uniques partiels (SQL brut) :
- `one_open_task_per_version` : `("requestVersionId") WHERE "requestVersionId" IS NOT NULL AND "state" IN ('READY','CLAIMED','BLOCKED')` ;
- l'unicité de l'expiration est portée par `idempotencyKey` (`EXP:<assignmentId>:<version>`).

## 5. Machines à états

**Tâche** (FP:285) : `READY → CLAIMED` (claim) ; `CLAIMED → BLOCKED` (blocage, ou retrait partiel D-10) ; `BLOCKED → CLAIMED` (reprise par un owner autorisé ; le détenteur devient l'acteur) ; `CLAIMED → COMPLETED` (confirmation) ; `READY → CANCELLED` (annulation avant claim, processeur D-11.4, supplantation D-23) ; `CLAIMED|BLOCKED → CANCELLED` uniquement par **réconciliation** (« aucune modification effectuée », motif obligatoire) — autorisée si la demande a `cancelRequestedAt` ou si la revérification D-9 échoue. Passation : `CLAIMED|BLOCKED` gardent leur état, `claimantId` change. `COMPLETED` et `CANCELLED` sont immuables.

**Version de demande** : `READY_FOR_FULFILMENT → IN_PROGRESS → (BLOCKED ⇄ IN_PROGRESS) → COMPLETED` ; `READY_FOR_FULFILMENT → CANCELLED` (annulation) ; `READY_FOR_FULFILMENT → REVISION_REQUIRED` (processeur D-11.4) ; `IN_PROGRESS|BLOCKED → CANCELLED` (réconciliation).

**Affectation** (effet de la confirmation) :

| Action | Avant (attendu) | Après |
|---|---|---|
| `GRANT` | aucune ligne, ou ligne `REVOKED`, ou `EXPIRED_REMOVAL_PENDING` (D-23) | `ACTIVE`, `levelId = toLevelId`, période de la version, `grantedAt = completedAt`, `source: REQUEST`, `verification: OWNER_CONFIRMED` |
| `CHANGE_LEVEL` | `ACTIVE`, `levelId = fromLevelId` | `levelId = toLevelId`, période de la version |
| `RENEW` | `ACTIVE` ou `EXPIRED_REMOVAL_PENDING` | `ACTIVE`, `periodEnd` de la version (niveau inchangé) |
| `REVOKE`, `EXPIRY_REMOVAL` | `ACTIVE` ou `EXPIRED_REMOVAL_PENDING` | `REVOKED`, `levelId: null`, `revokedAt = completedAt` |

Chaque écriture : `version` +1, un `AccessAssignmentEvent` (`sourceType: "FULFILMENT"`, `sourceId: taskId`, avant/après niveau, `outcome`).

## 6. Services (`lib/access/fulfilment.ts` pur, `lib/access/fulfilment-server.ts`)

Pur : `taskActionForKind(kind, hasCurrentLevel)`, `canTransition(state, event)`, `assignmentEffect(action, current, task, completedAt)` (table §5), `outcomeFor(action)`, `validateCompletionInput(...)`, `ownerRoleFor(asset, userId)`.

Serveur :
- `releaseTaskInTx(tx, { version, request, assignment, actorId })` — utilisé par 3a et par le processeur ; idempotent (clé `REQ:<versionId>`).
- `listFulfilmentTasks(viewer, { view: "mine" | "oversight", state?, assetId?, page })` — filtré par portée **avant** pagination.
- `claimTask(orgId, actorId, taskId, expectedRevision)`
- `handoverTask(orgId, actorId, taskId, { toUserId, reason, expectedRevision })`
- `blockTask(orgId, actorId, taskId, { reason, facts?, expectedRevision })`
- `resumeTask(orgId, actorId, taskId, expectedRevision)`
- `completeTask(orgId, actorId, taskId, { completedAt, reference?, note?, method?, partialRemovalOnly?, expectedRevision })` — rejouée sur une tâche déjà `COMPLETED` par le même acteur avec les mêmes faits : renvoie le résultat enregistré sans mutation (FP:241).
- `reconcileTask(orgId, actorId, taskId, { reason, expectedRevision })`
- `claimTasksBatch` / `completeTasksBatch` (D-13).
- `runAccessProcessor(now)` (D-11).
- Modifications 3a : `submitRequest`, `decideStage`, `reviseRequest` appellent `releaseTaskInTx` au passage `READY_FOR_FULFILMENT` ; `cancelRequest` suit D-19 ; rejet/annulation ferment (`closedAt`) au lieu de supprimer (D-4).

## 7. API

| Route | Service |
|---|---|
| `GET /api/access/tasks?view=mine|oversight&state=&assetId=&page=` | `listFulfilmentTasks` |
| `POST /api/access/tasks/[taskId]/claim` | `claimTask` |
| `POST /api/access/tasks/[taskId]/handover` | `handoverTask` |
| `POST /api/access/tasks/[taskId]/block` | `blockTask` |
| `POST /api/access/tasks/[taskId]/resume` | `resumeTask` |
| `POST /api/access/tasks/[taskId]/complete` | `completeTask` |
| `POST /api/access/tasks/[taskId]/reconcile` | `reconcileTask` |
| `POST /api/access/tasks/claim-batch` | `claimTasksBatch` |
| `POST /api/access/tasks/complete-batch` | `completeTasksBatch` |
| `GET /api/cron/access-processor` | `runAccessProcessor` |

Corps validés par Zod (`lib/validations/access.ts`) : `completedAt` ISO ≤ maintenant + 5 min et ≥ `claimedAt` − 1 jour ; `reference` ≤ 200 car., `note` ≤ 2000 car., au moins l'un des deux ; `reason` 3–1000 car. ; `expectedRevision` entier ≥ 1. Réponses `{ data }` ; erreurs `{ error, code }` avec 400/404/409 (D-8).

## 8. Écrans

- **`/access/fulfilment` « Exécution »** : onglets « À faire » (READY/CLAIMED/BLOCKED sur mes actifs d'exécution), « Historique » (COMPLETED/CANCELLED), « Supervision » (CISO/COO, lecture seule, toutes les tâches, badge « Aucun propriétaire »). Cartes : employé, département, application, action (« Accorder », « Changer de niveau », « Renouveler », « Retirer », « Retirer — fin de période »), niveau actuel → cible, période, référence, résumé d'approbation, justification, événements. Actions selon état et droit : Réclamer, Confirmer (formulaire : date/heure réelle, référence ou note, méthode pour changement de niveau, case « Seul l'ancien niveau a été retiré »), Signaler un blocage, Reprendre, Passer la main (liste des autres owners disponibles + motif), Réconcilier (« Aucune modification effectuée » + motif). Sélection multiple : « Réclamer la sélection », « Confirmer la sélection » (formulaire listant chaque élément avec sa référence/note, date commune modifiable). Résultats par élément affichés après un lot.
- **`/requests/mine`** : libellés des états `AUTHORIZED_WAITING_START` (« Autorisée — début le … »), `READY_FOR_FULFILMENT` (« Prête — en attente du propriétaire »), `IN_PROGRESS` (« En cours d'exécution »), `BLOCKED` (« Bloquée : motif »), `COMPLETED` (« Exécutée le … »), `CANCELLED` + historique ; bouton Annuler libellé « Demander l'annulation » après claim.
- **Barre latérale** : lien « Exécution » (D-15).

## 9. Erreurs et cas limites

- Tâche hors périmètre ou inexistante → 404 ; révision périmée → 409 « La tâche a changé, rechargez » ; transition invalide → 409 ; revérification D-9 → 409 avec la raison (« Le niveau cible a été archivé », « La période est terminée — la demande doit être révisée », « L'affectation a changé depuis l'approbation », « L'employé n'est plus actif », « Un retrait est en cours — à réconcilier »).
- Actif sans propriétaire : la tâche est créée ; visible en supervision avec badge ; personne ne peut la réclamer tant qu'un propriétaire n'est pas défini (FP:312).
- Owner parti (indisponible) avec tâche réclamée : il ne peut plus agir ; tout owner/suppléant courant peut passer la main (D-8).
- Confirmation rejouée (double clic, retry réseau) : même résultat, aucune écriture.
- Deux owners confirment en même temps : un seul gagne (garde conditionnelle + `assignment.version`), l'autre reçoit 409.
- Processeur en retard (panne) : traite tout ce qui est `<= now`, par paquets de 200, sans doublons.

## 10. Tests

- **Pur** : table d'effets §5 ligne par ligne ; transitions valides/invalides ; `taskActionForKind` ; validation de confirmation.
- **Base réelle** (`tests/unit/access-db/fulfilment-server.test.ts`, `access-processor.test.ts`, mise à jour de `requests-server.test.ts`) : libération à l'approbation ; owner/suppléant voient, un tiers non (404) ; aucune version en attente visible (A05) ; claim concurrent (un seul gagnant) ; confirmation GRANT/CHANGE/RENEW/REVOKE → affectation correcte + événement + version ; rejeu idempotent (A17) ; deux confirmations concurrentes (A16) ; retrait partiel puis reprise (A18) ; revérifications (niveau archivé, catalogueVersion, assignment.version, bénéficiaire parti, période passée) → 409 ; annulation avant/après claim (D-19) ; historique conservé après rejet/annulation (D-4) ; processeur : libération à `periodStart`, expiration idempotente (2 passages = 1 tâche), renouvellement qui supplante une expiration non réclamée, refus si réclamée (A19), tâche READY à période dépassée → révision ; lots avec résultats par élément et `correlationId`.
- **Routes** : 401/404/409/400 sur chaque route de tâche ; cron 401 sans secret.
- **Vérification finale** : suite complète, types, lint, build, passage navigateur (owner, suppléant, CISO, employé demandeur).

## 11. Risques

- **Modification de code 3a** (suppression → fermeture, annulation) : couverte par la mise à jour des tests 3a existants.
- **Retrait d'un unique Prisma au profit d'un index partiel SQL** : `prisma migrate dev` peut signaler une dérive ; la production utilise `migrate deploy` (sans détection de dérive). Documenté dans la migration.
- **`listMyRequests` charge toutes les demandes de l'organisation** puis filtre en mémoire (dette 3a) ; l'historique conservé l'aggrave — la requête est réécrite pour filtrer par `initiatorId`/`beneficiaryId` en base.
- **Deux owners qui travaillent hors ligne** sur la même tâche : l'exclusivité du claim l'empêche ; pas de délai d'expiration du claim (FP:241).
