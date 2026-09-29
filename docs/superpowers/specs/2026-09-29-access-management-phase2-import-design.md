# Gestion des accès — Phase 2 : import (conception)

Date : 2026-09-29 · Statut : en attente de relecture · Chemin d'analyse : architectural

## 1. Contexte et intention

La phase 1 (`docs/superpowers/specs/2026-09-28-access-management-phase1-design.md`, PR #71 en revue) a livré les fondations du module de gestion des accès : schéma, rôles du module, catalogue d'actifs, journal d'audit, trois écrans d'administration. Le registre est vide — aucune donnée réelle n'y a encore été chargée.

Cette phase 2 amorce le registre à partir de l'existant réel de l'entreprise : un export brut de 476 lignes (`registre_acces_2026-08-27.csv`) décrivant qui a accès à quel logiciel avec quel niveau, préparé avant le début du projet. Source de vérité : `/Users/mariusokouin/Downloads/FEATURE-PROMPT.md` §11 (« Initial CSV migration »), affiné par `CSV-IMPORT-NOTES.md` et `REFINEMENT-QUESTIONS.md` — les trois fichiers étaient absents au moment de la phase 1 (spec §10) et ont été fournis le 2026-09-29.

**Correction du découpage** : la phase 1 (§1) plaçait par anticipation « Registre visible : import (catalogue, puis accès de départ) et vues *Mes accès / Département / Actifs* » en phase 2. Cette conception ne couvre que l'**import** — c'est tout ce qui a été instruit et validé dans cette session de conception. Les vues de lecture (« Mes accès », vue département, vue propriétaire d'actif) qui exploitent le résolveur de portée déjà construit et testé en phase 1 (`lib/access/scope.ts`) sont reportées à une phase ultérieure, avec sa propre conception. Rien n'est perdu : le résolveur existe déjà, seule l'interface reste à construire.

**Critère de réussite de la phase 2** : un Asset Administrator peut, depuis IziPilot, amorcer le catalogue à partir du CSV brut existant, puis charger une base d'affectations préparée séparément (identifiants stables), sans jamais fabriquer de rang, de propriétaire, de date ou de correspondance d'identité que la donnée source ne fournit pas.

## 2. Périmètre

**Inclus** : deux outils d'import indépendants réservés à l'Asset Administrator effectif, leur modèle de données, leurs écrans de prévisualisation/validation, leur traçabilité.

**Hors phase 2** :
- Réconciliation d'identité (« ne pas construire d'écran de correspondance ») — travail de préparation externe, en amont du fichier de baseline.
- Vues de lecture du registre pour les employés/chefs de département/propriétaires d'actif (reportées, voir §1).
- Tout ce que les phases 3 à 5 couvrent (demandes, approbations, arrivées/départs, transferts) et tout ce que la spec v1 exclut explicitement (import GLPI en direct, gabarits d'accès, upload CSV à chaud pour modifier un accès existant).

## 3. Constat sur les données sources (vérifié en lisant les fichiers réels)

Le fichier `registre_acces_2026-08-27.csv` (lu tel quel, inchangé) : 476 lignes de données, séparateur `;`, colonnes `utilisateur;nom_complet;departement;logiciel;niveau_acces`. 49 noms d'utilisateur distincts, 101 logiciels distincts, **186 paires logiciel/niveau distinctes**. Le niveau est un libellé composé propre au logiciel (ex. `AWS - DocumentDB-contributor`, `MICROSOFT OFFICE-reader`) — une chaîne opaque, jamais analysée. Le département vaut littéralement la chaîne `NULL` sur 7 lignes (4 utilisateurs concernés) ; 1 utilisateur a plusieurs valeurs de département dont `NULL`. Aucune ligne dupliquée à l'identique dans ce fichier. 2 paires utilisateur/logiciel portent plus d'un niveau d'accès — irréconciliable automatiquement, laissé à la préparation externe.

Les identifiants `utilisateur` de ce fichier **ne correspondent pas** aux comptes IziPilot actuels — la réconciliation se fait séparément, hors de cette fonctionnalité. Ce fichier brut ne sera donc jamais utilisé pour le mode « baseline assignments » (§5) ; il ne sert que pour le mode « catalogue seed » (§4).

## 4. Mode 1 — Catalogue seed

Accepte le CSV brut à 5 colonnes ci-dessus. Le serveur ignore les colonnes `utilisateur`, `nom_complet`, `departement` (aucun usage en catalogue seed) et ne retient que les paires distinctes `(logiciel, niveau_acces)`, nettoyées par `trim()`.

Pour chaque paire distincte :
- Correspondance exacte (après trim) avec un `AccessAsset.name`/`AccessLevel.name` non archivé existant → `MATCHED`, rien n'est créé.
- Sinon → `DRAFT_CREATED` : crée l'`AccessAsset` s'il n'existe pas (sans propriétaire, sans suppléant — configurés ensuite dans `/access/assets`, phase 1), puis l'`AccessLevel` avec `priority: null`, `isAdmin: null` (déjà autorisé par `access_levels_priority_positive_check`, phase 1 Tâche 2 — aucune migration de contrainte à toucher).

Aucune ligne employé n'apparaît nulle part dans ce flux — ni en prévisualisation, ni en base (spec : « do not import this raw sample as live employee assignments or build a mapping screen »).

**Prévisualisation** : tableau des paires distinctes avec leur statut prospectif, avant tout commit. **Commit** : crée les actifs/niveaux manquants, persiste `ImportBatch`+`ImportRow` (§6), marque `committedAt`. Ce mode n'a pas de notion de conflit — une paire est soit déjà là, soit elle est créée en brouillon ; il n'y a rien à bloquer.

## 5. Mode 2 — Baseline assignments

Accepte un CSV séparément préparé, UTF-8, séparateur `;`, en-tête obligatoire exact `user_id;asset_id;access_level_id`, colonnes de provenance optionnelles `source_utilisateur;source_nom_complet;source_departement;source_logiciel;source_niveau_acces;source_row`. Ce fichier n'existe pas encore — il sera préparé après réconciliation d'identité, hors de cette fonctionnalité ; l'échantillon actuel n'en tient pas lieu.

### Résolution, par ligne

`user_id`, `asset_id`, `access_level_id` doivent résoudre à des lignes existantes **dans l'organisation de l'appelant** (même garde anti-IDOR que le reste du module — aucune exception). `access_level_id` doit appartenir à `asset_id`. L'utilisateur doit être `ACTIVE` (`AccessProfile.lifecycle`) — un utilisateur `OFFBOARDING`/`DEPARTED` fait échouer la ligne.

Chaque ligne obtient un statut prospectif :
- `UNRESOLVED` — référence invalide, niveau n'appartenant pas à l'actif indiqué, ou utilisateur non `ACTIVE`.
- `CONFLICT` — une `AccessAssignment` existe déjà pour `(userId, assetId)` avec un `levelId` différent, **ou** deux lignes de ce même fichier désignent des `access_level_id` différents pour le même `(user_id, asset_id)`. Inclut le cas d'une affectation existante `REVOKED` : on ne la ressuscite jamais silencieusement, c'est un conflit.
- `NOOP_DUPLICATE` — ligne strictement identique (mêmes 3 colonnes résolues) à une ligne déjà vue plus tôt dans le même fichier.
- `NOOP_UNCHANGED` — une `AccessAssignment` `(userId, assetId, levelId)` identique existe déjà.
- `TO_CREATE` — aucune affectation existante pour cette paire, rien d'autre dans le fichier ne la contredit.

### Commit : tout ou rien

**Un lot ne peut être commité que si zéro ligne est `UNRESOLVED` ou `CONFLICT`.** Ce n'est pas un filtre ligne par ligne : la moindre ligne bloquante bloque l'intégralité du lot, avec le détail de chaque erreur affiché pour correction du fichier source en dehors de l'application. Les lignes `NOOP_DUPLICATE`/`NOOP_UNCHANGED` ne bloquent jamais rien.

La prévisualisation et le commit exécutent **la même fonction de résolution**. Au clic « Confirmer », le serveur **revalide entièrement** contre l'état actuel de la base — jamais seulement contre les lignes stockées à la prévisualisation. Si l'état a changé entretemps (ex. un niveau archivé, un utilisateur parti depuis), la revalidation le détecte et refuse le commit avec les nouvelles erreurs. C'est la réponse complète à l'exigence « stale previews... block the whole commit » : pas de jeton de version séparé à maintenir, juste ne jamais faire confiance à un résultat de prévisualisation périmé.

Un lot bloqué reste en base (`committedAt: null`) comme trace consultable de la tentative rejetée. Corriger = préparer un nouveau fichier et l'uploader — un nouveau `ImportBatch`, jamais un correctif ligne par ligne dans l'écran.

### Effets du commit (quand il a lieu)

Pour chaque ligne `TO_CREATE` : crée `AccessAssignment` avec `status: ACTIVE`, `verification: IMPORTED_UNREVIEWED`, `source: LEGACY_IMPORT` (déjà la valeur par défaut du modèle), `periodStart: now()`, `periodEnd: null` (ongoing). Crée l'`AccessAssignmentEvent` correspondant : `sourceType: "IMPORT"`, `sourceId: importBatch.id`, `outcome: "ASSIGNED"`, `beforeLevelId: null`, `afterLevelId: levelId`.

**Import strictement additif** : ne modifie jamais une affectation `source: REQUEST` existante, ne réactive jamais un `status: REVOKED`, et ne révoque jamais une affectation absente du fichier source. Le fichier ajoute des faits connus ; il ne synchronise pas un état complet.

Le département de l'employé reste celui d'IziPilot (`DepartmentMember`/`Department`) — les colonnes `source_departement` etc. ne sont que de la provenance affichée, jamais écrites dans les tables d'organisation existantes.

## 6. Modèle de données

Deux nouveaux modèles, deux nouveaux enums. Aucun changement aux modèles de la phase 1 : `AccessAssignment` (`source: LEGACY_IMPORT` par défaut, `verification: IMPORTED_UNREVIEWED`) et `AccessAssignmentEvent` (`sourceType`/`sourceId` génériques) ont été prévus dès la phase 1 exactement pour cet usage.

```prisma
enum ImportMode {
  CATALOGUE_SEED
  BASELINE_ASSIGNMENTS
}

enum ImportRowOutcome {
  MATCHED          // seed : paire déjà existante, réutilisée
  DRAFT_CREATED    // seed : actif/niveau brouillon créé
  TO_CREATE        // baseline : affectation qui sera/a été créée
  NOOP_UNCHANGED   // baseline : identique à l'existant
  NOOP_DUPLICATE   // baseline : doublon exact dans le même fichier
  UNRESOLVED       // baseline : référence invalide ou employé non actif
  CONFLICT         // baseline : diffère de l'existant, ou fichier interne incohérent
}

model ImportBatch {
  id          String     @id @default(cuid())
  orgId       String
  mode        ImportMode
  fileHash    String     // SHA-256 du fichier uploadé — traçabilité et rejeu sûr
  fileName    String
  actorId     String
  totalRows   Int
  committedAt DateTime?  // null = prévisualisation seule ou lot bloqué
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
  sourceFields    Json             // colonnes brutes de la ligne, telles quelles
  resolvedAssetId String?
  resolvedLevelId String?
  resolvedUserId  String?
  outcome         ImportRowOutcome
  reason          String?          // motif lisible pour UNRESOLVED/CONFLICT

  batch ImportBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@index([batchId])
  @@map("import_rows")
}
```

Isolation multi-org : `ImportBatch.orgId` vient toujours de la session, jamais du client (même garde que partout ailleurs dans le module). `ImportRow` n'a pas d'`orgId` propre — isolé via `batch.orgId`, même précédent que `AccessLevel` en phase 1 (Ruling A).

## 7. Écrans

Nouvel écran `/access/assets/import` (sous l'écran actifs existant plutôt qu'une route racine séparée — les deux outils y opèrent sur le même catalogue et partagent son garde d'accès) avec deux sections indépendantes, chacune : zone d'upload, tableau de prévisualisation avec compteurs par statut, bouton « Confirmer » actif seulement si aucune ligne bloquante (mode baseline) ou toujours actif (mode seed, jamais bloquant), historique des lots précédents (`ImportBatch` de cette org, triés par date).

Réservé à l'Asset Administrator effectif — même garde `requireAssetAdministrator` que `/access/assets`, aucun nouveau rôle.

Mobile-first, états chargement/vide/erreur requis par le projet — un tableau de prévisualisation peut compter jusqu'à ~180 lignes (mode seed) ou plus (mode baseline) ; pagination côté client, pas de nouvelle pagination serveur pour cette taille.

## 8. Audit

Chaque commit (des deux modes) écrit un `AccessAuditEvent` (`eventType: "IMPORT_COMMITTED"`, `objectType: "ImportBatch"`, `objectId: importBatch.id`) en plus des lignes `ImportBatch`/`ImportRow` elles-mêmes — cohérent avec `/access/audit`, qui reste la vue unifiée de toute mutation du module. `ImportBatch`/`ImportRow` sont le détail technique consultable depuis l'écran d'import ; l'entrée `AccessAuditEvent` est ce qui apparaît dans le journal général.

## 9. Tests

- **Fonctions pures** : résolution d'une ligne baseline (les 5 statuts), extraction des paires distinctes pour le seed, détection de doublon exact intra-fichier.
- **Contraintes en base, vraie connexion** : commit bloqué si une ligne est `CONFLICT`/`UNRESOLVED` (aucune `AccessAssignment` créée) ; revalidation au commit détecte un changement survenu après la prévisualisation ; rejeu du même fichier (même hash) est un no-op complet ; import jamais capable de modifier une affectation `source: REQUEST` ni de ressusciter un `REVOKED`.
- **Fixture réelle** : `registre_acces_2026-08-27.csv` copié tel quel dans `tests/fixtures/access/registre_acces_2026-08-27.csv` (jamais modifié — spec : « keep the supplied sample unchanged ») pour tester le mode seed avec les vraies irrégularités (département `NULL`, paires à niveaux multiples). Le mode baseline n'a pas de fixture réelle équivalente (le fichier normalisé n'existe pas encore) : fixtures construites à la main couvrant les 5 statuts et le cas de revalidation.
- **Vérification manuelle** en navigateur (build de production locale) des deux flux avec le fichier réel pour le seed.

## 10. Risques et points ouverts

- **Le fichier de baseline normalisé n'existe pas encore.** Le mode 2 ne pourra être vérifié de bout en bout avec de vraies données qu'une fois la réconciliation d'identité faite séparément — hors de cette fonctionnalité, comme le confirment les trois documents sources.
- **`ImportRow.sourceFields` en JSON** : taille raisonnable ici (5 à 8 colonnes courtes par ligne, ≤ 476 lignes par lot dans l'échantillon connu), mais aucune limite de taille de fichier n'est fixée par la spec — à surveiller si un futur import dépasse largement cet ordre de grandeur.
- **Dépendance de branche** : cette phase est développée sur une branche empilée sur `worktree-access-management-phase1` (PR #71 non encore mergée) — à rebaser sur `main` une fois la phase 1 mergée, avant l'ouverture de la PR de cette phase.
- **Les vues de lecture reportées (§1)** restent à concevoir séparément ; le résolveur de portée (`lib/access/scope.ts`) qu'elles consommeront est déjà en place et testé depuis la phase 1.
