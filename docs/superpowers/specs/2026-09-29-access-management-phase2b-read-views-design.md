# Gestion des accès — Phase 2b : vues de lecture du registre (conception)

Date : 2026-09-29 · Statut : en attente de relecture · Chemin d'analyse : architectural

## 1. Contexte et intention

Les phases 1 (PR #71, fondations) et 2 (PR #73, import) sont fusionnées. Le registre contient désormais les accès de départ importés (`AccessAssignment`, `verification: IMPORTED_UNREVIEWED`), mais **personne ne peut les consulter** : la phase 2 (§1 de sa conception) a reporté les vues de lecture. Le résolveur de portée `lib/access/scope.ts` existe et est testé, mais n'est appelé par aucun code serveur.

Cette phase rend le registre lisible par les bonnes personnes, et seulement par elles. Source de vérité : `/Users/mariusokouin/Downloads/FEATURE-PROMPT.md` §2 (tableau des rôles), §3 (« Department history and visibility »), §12 (écrans).

**Critères de réussite**

- Chaque employé voit ses propres accès courants.
- Un chef de département (ou son suppléant actif) voit les accès courants des employés de son département **actuel**.
- Un propriétaire ou suppléant d'actif voit toutes les attributions des actifs qu'il possède, tous départements confondus.
- Le CISO et le COO voient n'importe quel département, ou tous.
- Aucune donnée hors portée n'est visible — ni dans une liste, ni dans un total, ni via un lien direct, ni via l'API.

## 2. Périmètre

**Inclus**

- Correction du résolveur de portée (§3).
- Trois écrans en lecture seule : « Mes accès », « Accès du département », « Mes actifs » (§4).
- Un service de lecture unique et une route API `GET /api/access/assignments` (§5).
- Liens de navigation conditionnels.

**Exclus**

- Toute mutation : demandes, réductions, retraits, confirmation propriétaire (phase 3+).
- Historique par attribution (timeline) : seul l'événement d'import existe aujourd'hui ; il viendra avec la phase 3.
- Export CSV (la spec ne l'exige que pour le journal d'audit).
- Visibilité des transferts (phase 5) et des demandes (phase 3).
- Ouverture du registre au rôle IziPilot `MANAGEMENT` : le COO reste un rôle **explicite** du module (un titulaire + suppléant, attribué dans `/access/roles`). Décision du 2026-09-29.

## 3. Correction du résolveur de portée

**Constat** : `resolveReadScopes` n'émet `OWNED_ASSETS` que pour le rôle `ASSET_ADMINISTRATOR`. Or la spec (§2) attribue la vue « attributions des actifs possédés » au **propriétaire / suppléant d'actif** (`AccessAsset.ownerId` / `backupOwnerId`) et réserve à l'administrateur des actifs le catalogue, les niveaux et l'import — pas les attributions d'autrui. En l'état, un propriétaire non administrateur ne verrait rien.

**Décision (2026-09-29)** :

- `OWNED_ASSETS` est émis dès que `ownedAssetIds` est non vide, **indépendamment des rôles du module**.
- `ownedAssetIds` = actifs de l'organisation avec `ownerId = userId` **ou** `backupOwnerId = userId`, et `archivedAt IS NULL`.
- Le suppléant d'actif voit toujours l'actif : il n'existe pas d'indicateur « titulaire indisponible » sur les actifs (contrairement aux rôles de département), et la spec nomme « Owner / Backup » ensemble.
- `ASSET_ADMINISTRATOR` n'émet plus aucune portée de lecture sur les attributions.
- Les tests `tests/unit/access-scope.test.ts` (cas lignes ~44 et ~66) sont mis à jour en conséquence.

La signature reste `resolveReadScopes(userId, effectiveRoles, ownedAssetIds)`. Le calcul de `ownedAssetIds` est fait côté serveur (§5).

Les autres portées sont inchangées : `DEPARTMENT` pour chaque rôle `DEPARTMENT_HEAD` effectif (dérivé de `Department.ownerId`, suppléant inclus quand le titulaire est marqué indisponible — déjà implémenté dans `lib/access/roles-server.ts`), `ALL` pour CISO/COO effectifs, `AUDIT` pour le lecteur d'audit.

## 4. Écrans

Tous en lecture seule, en français, avec le style de tableau de `/access/assets` (badges de statut, format de date IziPilot, pagination de 25 lignes comme `/access/audit`).

| Route | Accès | Contenu |
|---|---|---|
| `/access/me` — « Mes accès » | Tout utilisateur connecté de l'organisation | Ses attributions courantes : actif, niveau, période (début–fin, ou « en cours »), provenance (`Import` ; plus tard `Demande`), vérification (« Importé — non vérifié »), badge « Retrait en attente » si applicable. |
| `/access/department` — « Accès du département » | Chef de département et suppléant actif ; CISO ; COO | Employés du département et leurs accès courants, groupés par employé. Sélecteur de département si le lecteur a plusieurs portées `DEPARTMENT` ; option « Toutes » pour les porteurs de `ALL`. Filtres : actif, recherche par nom d'employé. |
| `/access/owned-assets` — « Mes actifs » | Propriétaire ou suppléant d'au moins un actif non archivé | Une section par actif possédé : titulaires de l'accès (tous départements), niveau, période. Filtres : actif, niveau. |

**Navigation** : « Mes accès » est toujours visible dans la section Accès de la barre latérale. « Accès du département » et « Mes actifs » n'apparaissent que si le lecteur a la portée correspondante (le layout calcule déjà les rôles effectifs ; on y ajoute « possède au moins un actif »). Le masquage n'est qu'un confort : pages et API refusent de toute façon (§6).

**Contenu sérialisé** : nom et département de l'employé, actif, niveau, statut, vérification, source, période, cycle de vie de l'employé. Jamais d'e-mail ni de champ RH.

## 5. Données et service

### Définition de « accès courant »

`status IN (ACTIVE, EXPIRED_REMOVAL_PENDING)`. Un accès en attente de retrait existe encore, il est donc affiché (avec badge). `REVOKED` est exclu.

### Constructeur de filtre — `lib/access/register.ts` (pur)

`scopeToAssignmentWhere(orgId, scope): Prisma.AccessAssignmentWhereInput`

| Portée | Clause |
|---|---|
| `SELF` | `{ orgId, userId }` |
| `DEPARTMENT` | `{ orgId, user: { accessProfile: { primaryDepartmentId: departmentId } } }` |
| `OWNED_ASSETS` | `{ orgId, assetId: { in: assetIds } }` |
| `ALL` | `{ orgId }` |
| `AUDIT`, `NONE` | clause qui ne correspond à rien (`{ id: { in: [] } }`) |

`DEPARTMENT` utilise le département principal **actuel** (`AccessProfile.primaryDepartmentId`), conformément à la spec §3 (« Current access follows the employee's current primary department »).

`authorizeView(view, scopes): ReadScope | null` — vérifie que la vue demandée est couverte :

| Vue demandée | Portée requise |
|---|---|
| `{ kind: "SELF" }` | `SELF` (toujours présente) |
| `{ kind: "DEPARTMENT", departmentId: X }` | `DEPARTMENT` avec `departmentId = X`, **ou** `ALL` |
| `{ kind: "DEPARTMENT", departmentId: "ALL" }` | `ALL` |
| `{ kind: "ASSET" }` | `OWNED_ASSETS` |
| `{ kind: "ASSET", assetId: Y }` | `OWNED_ASSETS` contenant `Y` |

Retourne la portée effective à appliquer (pour `ASSET` avec `assetId`, une `OWNED_ASSETS` réduite à `[Y]`), ou `null`.

`buildAssignmentQuery(orgId, scope, filters)` — `AND` de la clause de portée, du filtre « accès courant » et des filtres utilisateur (actif, niveau, recherche nom insensible à la casse). Les filtres sont **toujours ajoutés en `AND`** : ils ne peuvent qu'affiner la portée, jamais l'élargir.

### Service — `lib/access/register-server.ts`

`listAssignments({ viewer: { userId, orgId }, view, filters, pagination })` :

1. Recalcule depuis la base les rôles effectifs via `getEffectiveRoleHolders(orgId, userId)` (`lib/access/roles-server.ts`, déjà utilisée par les gardes audit et actifs) et `ownedAssetIds`.
2. `resolveReadScopes` puis `authorizeView` ; `null` → erreur `NOT_FOUND`.
3. `buildAssignmentQuery`, puis `count` et `findMany` (tri : nom d'employé puis nom d'actif ; `skip`/`take`) dans une même transaction.
4. Retourne des DTO simples, dates en chaîne ISO (convention des phases 1–2).

`getRegisterNav(viewer)` — pour le layout : `{ hasDepartmentView, hasOwnedAssetsView, departments: {id, name}[], canSeeAll }`.

### API — `GET /api/access/assignments`

Paramètres validés par Zod : `view` (`me` | `department` | `owned-assets`), `departmentId` (cuid ou `ALL`), `assetId`, `levelId`, `q` (≤ 100 caractères), `page`, `pageSize` (1–100, défaut 25). Réponse `200 { data, total, page, pageSize }`, même forme que `/api/access/audit`. Auth : session NextAuth (`auth()`), comme les autres routes du module ; pas de Bearer dans cette phase (`lib/api-auth` n'existe que sur la branche mobile non fusionnée, PR #43).

## 6. Erreurs et cas limites

- **Vue hors portée** (lien direct, `departmentId` modifié à la main, département d'une autre organisation) : `notFound()` côté page, `404` côté API — ne confirme pas l'existence du département ou de l'actif. **Écart volontaire** avec `/access/audit`, qui redirige (page) et répond `403` (API) : là, l'existence de l'écran n'est pas secrète ; ici, un `departmentId` ou `assetId` valide ne doit pas être distinguable d'un identifiant inexistant.
- **Paramètre invalide** : `400` avec détails Zod côté API ; côté page, retour à la vue par défaut sans erreur.
- **Aucun résultat** : état vide avec une phrase propre à la vue (« Aucun accès enregistré pour vous », « Aucun employé de ce département n'a d'accès enregistré », etc.).
- **Erreur base** : error boundary existant `app/(dashboard)/error.tsx` (message + réessayer).
- **Utilisateur sans `AccessProfile` ou sans département principal** : visible dans « Mes accès » ; absent des vues département ; regroupé sous « Sans département » dans la vue « Toutes » du CISO/COO.
- **Employé `OFFBOARDING` / `DEPARTED`** : affiché avec badge de cycle de vie tant qu'il a des accès courants.
- **Actif archivé** : ses attributions restent visibles dans « Mes accès » et la vue département ; il sort de « Mes actifs » (la portée ne compte que les actifs non archivés).

## 7. Tests

**Unitaires (Vitest, purs)**

- Résolveur : propriétaire → `OWNED_ASSETS` ; suppléant d'actif → `OWNED_ASSETS` ; `ASSET_ADMINISTRATOR` seul → uniquement `SELF`.
- `scopeToAssignmentWhere` : chaque portée ; `orgId` présent dans toutes les clauses ; `AUDIT`/`NONE` ne correspondent à rien.
- `authorizeView` : département A refusé au chef du département B ; « Toutes » refusé à un chef ; « Toutes » et tout département accordés au CISO ; `assetId` non possédé refusé.
- `buildAssignmentQuery` : les filtres sont combinés en `AND` et n'élargissent jamais la portée ; `REVOKED` exclu.

**Routes API** (même harnais que les tests de routes existants du module) : `404` sur vue non autorisée ; `404` sur `departmentId` d'une autre organisation ; `total` égal au nombre de lignes de la portée filtrée avant pagination.

**E2E (Playwright)** : un parcours par écran sur données seedées ; pour un employé simple, le lien « Accès du département » est absent **et** l'URL directe renvoie une 404.

## 8. Risques et points ouverts

- **Rôles effectifs recalculés à chaque requête** : quelques requêtes supplémentaires par page ; acceptable pour 20–30 utilisateurs. Pas de cache.
- **Recherche par nom** : `contains` insensible à la casse sur `User.name` ; suffisant au volume actuel (~476 attributions).
- Aucun changement de schéma Prisma ni migration dans cette phase.
