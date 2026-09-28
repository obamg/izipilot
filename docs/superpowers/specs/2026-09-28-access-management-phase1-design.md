# Gestion des accès — Phase 1 : fondations (conception)

Date : 2026-09-28 · Statut : en attente de relecture · Chemin d'analyse : architectural

## 1. Contexte et intention

IziPilot n'a aucun moyen de savoir **qui a accès à quelles applications de l'entreprise** (messagerie, CRM, back-office, outils cloud…). Le besoin est un module de suivi de ces accès, **indépendant des rôles internes d'IziPilot** (`CEO`, `PO`…), pour : savoir qui a accès à quoi, retirer les accès au départ d'un collaborateur, faire valider les changements d'accès, et tracer le tout.

Source de vérité fonctionnelle : la spec « version 1 » `/Users/mariusokouin/Downloads/FEATURE-PROMPT.md`. Décision du 2026-09-28 : **cette v1 gouverne**. Les revues périodiques d'accès et les modèles d'accès à l'arrivée, demandés au départ, sont exclus par la spec et reportés en v2.

La v1 est trop grosse pour un seul cycle (10 rôles avec suppléants, 3 workflows, environ 11 écrans, 25 scénarios d'acceptation). Elle est découpée en 5 phases, chacune avec sa spec, son plan et ses PRs :

| Phase | Contenu |
| --- | --- |
| **1 — Fondations (ce document)** | Modèle de données, rôles et suppléants, catalogue, journal d'audit, écrans d'administration |
| 2 — Registre visible | Import (catalogue, puis accès de départ) et vues « Mes accès / Département / Actifs » |
| 3 — Demandes | Demandes, approbations, exécution manuelle par les propriétaires, expiration (job toutes les 5 min), lots |
| 4 — Arrivées et départs | Onboarding RH, départs avec approbation réciproque RH/CISO |
| 5 — Transferts | Transferts de département avec double signature |

**Critère de réussite de la phase 1** : un administrateur peut attribuer les rôles du module (avec suppléants et disponibilité), maintenir le catalogue des applications et de leurs niveaux d'accès, et un Audit Viewer peut consulter et exporter un journal d'audit fiable. Le résolveur de portée et les tables du registre existent et sont testés, prêts à recevoir les données de la phase 2.

## 2. Périmètre

**Inclus** : migrations additives, services (`lib/access/`), API et trois écrans (§7).

**Hors phase 1** : import et vues du registre (phase 2), demandes et approbations (3), arrivées/départs (4), transferts (5), tout ce que la spec v1 exclut (GLPI, provisionnement automatique, notifications, campagnes de recertification, comptes externes ou partagés, coûts de licences, modèles d'accès).

## 3. Constat sur l'existant (vérifié dans le code)

- Rôles : enum `UserRole` de 5 valeurs, un seul par utilisateur. `/admin` est réservé à `CEO` (`app/(dashboard)/admin/layout.tsx`).
- Contrôles d'accès codés en dur via `requireAccess({ roles })` dans `lib/auth-guard.ts`. Isolation multi-entreprises par `orgId`.
- **N'existent pas** : liste d'actifs, journal d'audit, circuit d'approbation, rôles CISO/COO/RH, département principal.
- « Demandes internes » (`SupportRequest`) est un système de tickets avec SLA. La catégorie `ACCESS` existe déjà, sans registre derrière. Son rôle une fois le module en place sera décidé en phase 3.
- Département : `Department.ownerId` est le chef ; `DepartmentMember` est multiple.
- Crons actuels : quotidiens ou hebdomadaires, via un conteneur cron qui appelle `/api/cron/*`.

La spec dit de « réutiliser l'existant » : cela se limite aux utilisateurs, départements et chefs, à l'authentification et à la page d'administration des utilisateurs. Le reste est créé.

## 4. Architecture

1. **Rôles du module dans une table dédiée** (`AccessRoleAssignment`), pas dans l'enum `UserRole` : l'enum ne porte ni suppléant, ni portée, ni disponibilité. Le `CEO` est l'« administrateur de plateforme » : il gère les rôles, les suppléants hors actifs, la disponibilité et le département principal, mais n'a **aucun** droit d'audit, de gestion d'actifs ni d'approbation tant qu'un rôle ne lui est pas attribué (conforme à la spec).
2. **Résolveur de portée central** (`lib/access/scope.ts`) par lequel passent toutes les lectures. Il filtre avant la pagination, les totaux, la recherche et l'export (scénario A06). La logique pure est séparée de Prisma, comme `lib/evaluation.ts` / `lib/evaluation-server.ts`.
3. **Audit dans la même transaction que la mutation** : helper `recordAudit(tx, …)`. Le journal est en ajout seul côté application ; aucun code de modification ou suppression n'est exposé.

## 5. Modèle de données

Conventions du schéma actuel : ids `cuid`, `orgId` relié à `Organization` avec cascade, tables en snake_case via `@@map`, commentaires en français. Toute nouvelle table porte `orgId`.

### Enums

- `AccessModuleRole` : `IT_ACCESS_OPERATOR`, `HR`, `CISO`, `COO`, `ASSET_ADMINISTRATOR`, `AUDIT_VIEWER`, `DEPARTMENT_HEAD`.
- `AccessLifecycle` : `ACTIVE`, `OFFBOARDING`, `DEPARTED`.
- `AccessAssignmentStatus` : `ACTIVE`, `EXPIRED_REMOVAL_PENDING`, `REVOKED`.
- `AccessVerification` : `IMPORTED_UNREVIEWED`, `OWNER_CONFIRMED`. La spec ne nomme que la première ; la seconde est ajoutée pour l'accès accordé nativement (phase 3).
- `AccessAssignmentSource` : `LEGACY_IMPORT`, `REQUEST`.

### Tables

**`AccessProfile`** (`access_profiles`) — profil d'accès de l'employé.
`userId` (unique), `primaryDepartmentId` (nullable, FK `Department`, `SetNull`), `lifecycle` (défaut `ACTIVE`), `revision`. Index `(orgId, lifecycle)`.

**`AccessRoleAssignment`** (`access_role_assignments`) — rôle du module.
`role`, `userId` (titulaire, nul uniquement pour `DEPARTMENT_HEAD`), `departmentId` (renseigné uniquement pour `DEPARTMENT_HEAD`), `backupUserId` (nullable), `primaryUnavailable` (défaut faux), `revision`.
- Le chef d'un département reste `Department.ownerId` ; une ligne `DEPARTMENT_HEAD` ne porte que le suppléant et la disponibilité, rattachés au département : ils survivent à un changement de chef.
- Contraintes : `CHECK` de cohérence `userId` / `departmentId` selon le rôle ; `CHECK` suppléant distinct du titulaire (pour `DEPARTMENT_HEAD`, le service vérifie contre `Department.ownerId`) ; unique `(orgId, role, userId)` ; unique `(orgId, departmentId)` ; **index unique partiel `(orgId, role)` pour `CISO` et `COO`** (un seul titulaire principal chacun).
- Un titulaire désactivé ou en départ compte comme indisponible : c'est calculé à la résolution (`User.isActive`, `AccessProfile.lifecycle`), pas stocké.

**`AccessAsset`** (`access_assets`) — application.
`name`, `description`, `ownerId` (nullable), `backupOwnerId` (nullable), `requestsEnabled` (défaut faux), `catalogueVersion` (défaut 1), `revision` (concurrence, défaut 1), `archivedAt`, `sourceLabel` (provenance, renseignée par l'import de la phase 2).
Unique `(orgId, name)`. `CHECK` suppléant distinct du propriétaire. Un actif n'est jamais supprimé, seulement archivé.

**`AccessLevel`** (`access_levels`) — niveau d'accès.
`assetId`, `name`, `priority` (nullable), `isAdmin` (nullable), `enabled` (défaut vrai), `revision` (concurrence, défaut 1), `archivedAt`, `sourceLabel`.
Unique `(assetId, name)`. `CHECK` `priority` nul ou > 0. **Index unique partiel `(assetId, priority)`** pour les niveaux activés et non archivés. `priority` et `isAdmin` vides sont autorisés : ce sont les brouillons issus de l'import.

**`AccessAssignment`** (`access_assignments`) — accès courant.
`userId`, `assetId`, `levelId` (nul = aucun accès courant), `status`, `verification`, `source`, `periodStart`, `periodEnd` (nul = accès permanent), `grantedAt` et `revokedAt` (dates réelles, nulles si inconnues), `version`.
**Unique `(userId, assetId)`** : une seule ligne par employé et par actif, garantie en base. Index `(orgId, assetId)`, `(orgId, userId)`, `(orgId, status)`. Vide en phase 1.

**`AccessAssignmentEvent`** (`access_assignment_events`) — ajout seul.
`assignmentId`, `userId`, `assetId`, `beforeLevelId`, `afterLevelId`, `actorId` (nul pour un traitement système), `actorRole`, `sourceType`, `sourceId`, `outcome`, `occurredAt`. Vide en phase 1.

**`AccessAuditEvent`** (`access_audit_events`) — ajout seul.
`occurredAt` (UTC), `actorId`, `actorRole` (rôle représenté), `primaryCoveredId`, `scopeType` / `scopeId`, `eventType`, `objectType`, `objectId`, `objectVersion`, `beneficiaryId`, `before` / `after` (JSON), `reason`, `outcome`, `correlationId`. Aucun secret n'est journalisé.
Index `(orgId, occurredAt)`, `(orgId, objectType, objectId)`, `(orgId, beneficiaryId)`, `(orgId, actorId)`, `(orgId, correlationId)`.

Les deux tables d'événements (`AccessAssignmentEvent` et `AccessAuditEvent`) stockent les identifiants d'utilisateurs en simples chaînes, **sans clé étrangère**, pour que l'historique survive à toute suppression future d'un utilisateur.

### Intégrité et concurrence

- Les index uniques partiels et les `CHECK` s'écrivent en SQL brut dans la migration, Prisma ne pouvant pas les exprimer. Les services les revalident.
- Prisma n'impose pas la cohérence d'organisation entre tables : les services vérifient que actif, niveau et employé partagent la même `orgId`, et l'`orgId` vient toujours de la session.
- Les tables modifiables portent `revision` / `version` ; une mise à jour concurrente périmée est rejetée avec une erreur explicite (`UPDATE … WHERE revision = ?`). **Correction post-revue finale (2026-09-29, Ruling L)** : la colonne existe et s'incrémente à chaque écriture, mais aucune route phase 1 ne vérifie encore une révision attendue avant d'écrire — le rejet explicite promis ici n'est pas encore implémenté. Reporté en phase 2 (voir §10).

## 6. Services et règles d'accès (`lib/access/`)

- `roles.ts` (pur) — qui peut agir pour un rôle. Le titulaire agit s'il est disponible ; sinon son suppléant actif. Le suppléant d'un actif agit toujours. Un titulaire ou suppléant désactivé ou en départ ne peut pas agir. Le suppléant d'un rôle n'hérite pas des exceptions personnelles du titulaire. La couverture d'audit exige une affectation explicite de suppléant Audit Viewer.
- `scope.ts` (pur) — à partir de l'utilisateur et de ses rôles ou suppléances résolus, calcule le filtre de lecture : employé = soi ; chef de département = son département ; propriétaire d'actif = ses actifs ; CISO et COO = tout ; Audit Viewer = le journal ; RH = champs d'annuaire limités. Les branches employé, département et propriétaire sont implémentées et testées ici, mais exercées par l'interface dès la phase 2.
- `catalogue.ts` (pur) — priorité unique par actif, `isAdmin` explicite (jamais déduit du rang ni du nom), condition « prêt aux demandes » (propriétaire renseigné, au moins un niveau sélectionnable, tous les niveaux sélectionnables avec priorité et `isAdmin`), montée de `catalogueVersion` à chaque changement de priorité ou de drapeau admin.
- `audit.ts` — `recordAudit(tx, …)`, appelé dans la transaction de chaque mutation. Il n'expose que l'insertion. **Correction post-revue finale (2026-09-29, Ruling K)** : en phase 1, les routes appellent l'écriture d'audit avec le client Prisma par défaut, après que la mutation a déjà validé — pas dans la même transaction. Un helper transactionnel (`recordAuditInTx`) existe mais n'est pas encore branché. Reporté en phase 2 (voir §10).
- `*-server.ts` — accès Prisma, sur le modèle de `evaluation-server.ts`.
- Garde d'accès serveur — l'acteur et la portée viennent toujours de la session et de la base, jamais d'un champ envoyé par le client. Validation Zod à toutes les frontières d'API.

Administrateur de plateforme = `session.user.role === "CEO"`, le garde `/admin` existant. Aucun second mécanisme de super-utilisateur n'est créé.

Événements d'audit de la phase 1 : attribution, modification ou retrait d'un rôle ; pose ou changement d'un suppléant ; changement de disponibilité ; choix du département principal ; création, modification ou archivage d'un actif ; changement de propriétaire ou de suppléant d'actif ; création, modification, réordonnancement ou archivage d'un niveau ; montée de version du catalogue ; export du journal ; tout changement d'attribution Audit Viewer.

## 7. Écrans

Français, composants et pagination existants, mobile d'abord, avec les états chargement / vide / erreur exigés par le projet. Nouvelle entrée de menu **Accès**, dont les liens ne s'affichent qu'à ceux qui y ont droit. L'API et les liens directs sont aussi protégés côté serveur.

| Route | Écran | Réservé à |
| --- | --- | --- |
| `/access/assets` | Administration des actifs : actifs, niveaux ordonnés avec drapeau admin, propriétaire et suppléant, archivage, indicateur « prêt aux demandes » | Asset Administrator (effectif) |
| `/access/roles` | Administration des rôles : attribution des 6 rôles et de leurs suppléants, bascule de disponibilité, correction en un clic des employés sans département principal | `CEO` |
| `/access/audit` | Journal d'audit : filtres (acteur, objet, bénéficiaire, période), pagination, export CSV avec échappement des formules, l'export étant lui-même journalisé | Audit Viewer (effectif) |

Les routes d'API sont sous `/api/access/…` ; leur découpage exact est fixé dans le plan d'implémentation.

## 8. Tests

- **Vitest, fonctions pures** : résolution rôle et suppléant (disponibilité, désactivé, en départ, suppléant d'actif permanent), portée par rôle, règles du catalogue, échappement CSV des formules.
- **Contraintes en base**, sur une vraie base locale plutôt que par des mocks : une seule ligne par employé et par actif, CISO/COO uniques, priorité unique par actif, `CHECK` de cohérence des rôles. **Correction post-revue finale (2026-09-29, Ruling K)** : « audit annulé si la mutation échoue » retiré de cette liste — ce test n'existe pas et ne pourrait pas passer tant que l'écriture d'audit n'est pas dans la même transaction que la mutation (voir §6 et §10).
- **Scénarios de la spec couverts** : A06 (portée, sur jeux de données de test), A09 (suppléants), A10 (Audit Viewer), A24 (export d'audit autorisé, échappé et journalisé), et la part catalogue de A23.
- **Vérification manuelle dans le navigateur** (build de production local) du chemin essentiel de chaque écran. Pas de test Playwright automatisé en phase 1 : le helper de connexion des tests E2E existants (`tests/e2e/helpers.ts`) date d'avant l'authentification à deux facteurs par email et ne gère pas le code OTP.

## 9. Migration et exploitation

- Migration additive uniquement. Aucun rôle du module n'est attribué automatiquement : après déploiement, le `CEO` attribue les rôles depuis `/access/roles`.
- Remplissage : un `AccessProfile` `ACTIVE` par utilisateur existant, avec `primaryDepartmentId` rempli **seulement si l'utilisateur appartient à exactement un département**. Sinon il reste vide et le `CEO` le choisit, comme la spec l'exige. Les nouveaux utilisateurs reçoivent leur profil dans la transaction de création.
- Toute migration avec remplissage est testée sur une copie des données de production avant fusion.
- Aucun cron en phase 1.

## 10. Risques et points ouverts

- **Fichiers référencés absents** : `REFINEMENT-QUESTIONS.md`, `CSV-IMPORT-NOTES.md` et `registre_acces_2026-08-27.csv` n'étaient pas dans `~/Downloads` au 2026-09-28. Cette conception se fonde sur `FEATURE-PROMPT.md` seul ; s'ils le contredisent, elle sera révisée. Ils sont indispensables avant la phase 2.
- **Prisma et le SQL brut** : les index partiels et `CHECK` écrits à la main peuvent être signalés comme dérive par `prisma migrate dev` en local. La production utilise `migrate deploy`, sans détection de dérive ; à vérifier dans le plan.
- **Création de profils** : tous les chemins qui créent un utilisateur (administration, seed, et l'onboarding RH de la phase 4) doivent créer le `AccessProfile`. L'inventaire de ces chemins est fait dans le plan.
- **Titulaires des rôles** : la phase 1 n'exige pas de savoir qui sont le COO, le CISO et les RH, mais les phases 3 et 4 en dépendent (le double contrôle bloque le routage sans personnes distinctes).
- **`AccessVerification.OWNER_CONFIRMED`** est une valeur ajoutée par rapport à la spec ; à confirmer en phase 3.
- **Tickets `ACCESS`** : le sort de cette catégorie de demandes internes est décidé en phase 3.
- La spec v1 interdit de déployer ou de modifier des accès réels pendant l'implémentation ; toute mise en production reste une décision explicite du propriétaire du projet.
- **Suppléant de chef de département** : reporté hors de l'écran `/access/roles` (ruling du 2026-09-28). Un département a toujours un chef (`Department.ownerId`, obligatoire) ; son suppléant/disponibilité n'a aucun consommateur fonctionnel avant les phases 3 (routage des approbations) et 5 (transferts). `getEffectiveRoleHolders` dérive déjà le chef effectif sans configuration ; à construire quand ça devient réellement bloquant.

### Limitations connues de la phase 1 (revue finale du 2026-09-29)

Ces points sont des écarts réels entre ce document et le code livré, identifiés par la revue finale de branche. Reportés en phase 2 plutôt que corrigés dans cette vague, le coût d'un refactor transversal tardif (sans nouveau cycle de revue) dépassant le bénéfice pour une phase de fondations utilisée par ~6 titulaires de rôle module :

- **Ruling K — Audit non transactionnel avec sa mutation.** Contredit la promesse du §6/§8. Corriger demande de faire accepter un `Prisma.TransactionClient` à chaque fonction `*-server.ts` mutante (11 fonctions) et d'envelopper chacune des 10 routes dans `prisma.$transaction`. Coût si l'écart n'est pas comblé en phase 2 : un échec de l'insertion d'audit juste après une mutation réussie laisse cette action sans trace — pas de corruption de données, seulement un trou d'observabilité, et aucun cas observé à ce jour.
- **Ruling L — Concurrence optimiste non appliquée.** Contredit la promesse du §5. La colonne `revision` existe et s'incrémente mais aucune route ne vérifie une révision attendue avant d'écrire. Coût si non comblé : deux administrateurs modifiant le même objet à quelques secondes d'intervalle peuvent s'écraser silencieusement — probabilité très faible vu le nombre de titulaires de rôle module (6) et l'absence de flux d'édition concurrente en phase 1.
- **Ruling M — Écarts d'interface découverts à l'assemblage complet** :
  - Le département principal n'est re-résolu qu'à la création du profil ; l'ajout d'une appartenance à un département après coup ne le recalcule pas, et le panneau `ConfigIssuesPanel` peut afficher un libellé imprécis pour ce cas. Le correctif manuel existant (Ruling C) reste disponible en attendant.
  - `requestsEnabled` peut être activé sur un actif qui n'est pas « prêt aux demandes » : sans conséquence tant que la phase 3 n'exploite pas ce drapeau.
  - L'écran `/access/assets` ne permet pas encore de modifier le propriétaire/suppléant d'un actif, de l'archiver, ni de réordonner ses niveaux — ces routes API existent mais aucune UI ne les appelle.
  - L'écran `/access/audit` n'expose pas encore les filtres (acteur, objet, bénéficiaire, période) promis au §7 ; l'API les supporte déjà.
  - Coût si non comblé avant la phase 2 : ces actions restent possibles par appel API direct (curl/Postman) pour les ~6 titulaires de rôle concernés ; aucune perte de données, juste moins de confort.
