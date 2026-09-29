# Gestion des accès — Phase 3a : demandes et approbations (conception)

Date : 2026-09-29 · Statut : en attente de relecture · Chemin d'analyse : architectural

## 1. Contexte et intention

Les phases 1 (fondations : rôles, catalogue, audit) et 2 (import catalogue + baseline) sont mergées dans `main`. Le registre contient maintenant des données réelles, mais rien ne permet encore à un employé de **demander** un accès, ni à un chef de département/CISO/COO de l'**approuver** — toute la logique de routage d'approbation de la spec v1 (`/Users/mariusokouin/Downloads/FEATURE-PROMPT.md` §5) reste à construire.

**Correction du découpage** : le projet distinguait à l'origine une seule « Phase 3 : demandes / approbations / exécution manuelle / expiration / lots ». Décision du 2026-09-29 : cette phase est scindée en deux, chacune avec sa spec/plan/PR propres — cette conception ne couvre que **3a**. **3b** (exécution manuelle des tâches, job d'expiration à 5 minutes, lots de claim/fulfilment) suivra séparément, en s'appuyant sur ce que 3a livre. Le §9 « Batches » du spec v1 est lui-même scindé selon sa nature : l'initiation et la décision en lot relèvent de 3a (ce sont des demandes/approbations) ; le claim et la confirmation en lot relèvent de 3b (c'est de l'exécution).

**Critère de réussite de la phase 3a** : un employé peut soumettre une demande d'accès sur un couple lui-même/actif ; le système calcule seul la route d'approbation exacte (chef de département → CISO → COO selon les règles du spec) ; les approbateurs concernés — et seulement eux — peuvent décider ; les décisions (approuver/rejeter/clarifier/retourner) sont enregistrées avec versions immuables et rejouables. Une demande entièrement approuvée atteint un état « prête », sans qu'aucun accès réel ne soit encore modifié — c'est la limite avec la phase 3b.

## 2. Périmètre

**Inclus** : soumission de demande (GRANT/UPGRADE/RENEW/REDUCE/REVOKE, dérivés automatiquement de l'état actuel), calcul de route d'approbation, résolution d'acteur par étape (titulaire/suppléant, règles d'indépendance), décisions individuelles et en lot, révisions à version immuable, écrans « Mes demandes », « Mes approbations », « Demandes du département ».

**Hors phase 3a** : création/exécution de tâches de fulfilment, job d'expiration à 5 minutes, claim/confirmation en lot par les propriétaires d'actifs (phase 3b) ; onboarding RH, départs (phase 4) ; transferts de département (phase 5) ; vue « Toutes les demandes » CISO/COO (reportée — pas d'action nouvelle par rapport à « Mes approbations », qui couvre déjà tout ce qui est activement en attente pour CISO/COO).

## 3. Constat sur l'existant (vérifié dans le code)

- `lib/access/roles-server.ts` : `getEffectiveRoleHolders(orgId, userId)` renvoie déjà les rôles effectifs d'un utilisateur avec `actsAsPrimary` — directement réutilisable pour déterminer si un demandeur est un titulaire réel (exemptions COO/CISO) ou un suppléant (jamais exempté).
- `lib/access/scope.ts` : `resolveReadScopes` construit déjà les portées de lecture (SELF, DEPARTMENT, OWNED_ASSETS, ALL, AUDIT) — la portée DEPARTMENT (chef de département) et ALL (CISO/COO) couvrent directement les besoins de visibilité de « Mes approbations » et « Demandes du département ». Aucune modification requise pour la phase 3a (le bug connu sur `OWNED_ASSETS`, lié au rôle plutôt qu'à la propriété réelle, ne concerne que l'exécution — phase 3b).
- `AccessAssignment` (phase 1) a déjà les champs nécessaires pour dériver le type de demande (`status`, `levelId`, `version`) et porte déjà `source: AccessAssignmentSource` avec la valeur `REQUEST` prévue depuis la phase 1 pour ce que 3a/3b produiront — aucune migration de ce modèle n'est nécessaire en 3a puisqu'on ne fait qu'y **lire**, jamais y écrire (l'écriture est le travail de 3b, à l'exécution réelle).
- `Department.ownerId` (obligatoire) = chef de département effectif, déjà résolu par `getEffectiveRoleHolders`.
- Aucun modèle de demande, de version ou d'étape d'approbation n'existe : tout est à créer.

## 4. Modèle de données

Trois nouveaux modèles, quatre nouveaux enums. Isolation multi-org : `AccessRequest.orgId` direct (source de vérité) ; `AccessRequestVersion`/`AccessApprovalStage` sont scopées via leur parent, même précédent que `AccessLevel`/`ImportRow` (phases 1/2).

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
```

Note sur la contrainte d'unicité ci-dessus : la spec exige « au plus une demande non terminale par employé/actif », pas « une seule demande par employé/actif pour toujours » (une demande `REJECTED`/`CANCELLED`/complétée n'empêche pas d'en soumettre une nouvelle plus tard). Une contrainte DB `@@unique` classique sur `(orgId, beneficiaryId, assetId)` serait donc trop stricte. La phase 3a modélise plutôt `AccessRequest` comme l'identité stable **du dossier actif en cours** (créée à la première demande non terminale, réutilisée par les versions/révisions successives) et la **supprime** quand la dernière version atteint un état terminal (`REJECTED`/`CANCELLED`) ou passe le relais à la phase 3b (`AUTHORIZED_WAITING_START`/`READY_FOR_FULFILMENT`) — la version elle-même n'est jamais supprimée, seul le pointeur `AccessRequest` l'est, ce qui rend la contrainte d'unicité ci-dessus vraie en permanence sans champ d'état supplémentaire à synchroniser. Une nouvelle demande sur le même couple recrée un nouvel `AccessRequest` avec un nouvel historique de versions.

```prisma
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

`targetLevelId` est nul pour `REVOKE` (aucun niveau cible, l'accès est simplement retiré). `periodEnd` nul = `ONGOING` (défaut spec §5). `assignmentVersion`/`catalogueVersion` sont des instantanés pris à la soumission — la revalidation (§6) les recompare à l'état courant avant chaque décision.

## 5. Moteur de routage (fonctions pures, `lib/access/routing.ts`)

Traduction exacte des règles du spec §5, sans accès base — testables isolément comme `lib/access/roles.ts`/`scope.ts` (phase 1).

```typescript
export function computeGrantRoute(
  requesterRoles: { role: "COO" | "CISO" | "DEPARTMENT_HEAD"; actsAsPrimary: boolean }[],
  targetLevelIsAdmin: boolean
): { stages: ApprovalStageRole[]; exceptionReason: string | null }
```

- Le demandeur est titulaire (`actsAsPrimary: true`) COO → `{ stages: [], exceptionReason: "COO_SELF_REQUEST" }`.
- Titulaire CISO → `{ stages: ["COO"], exceptionReason: null }` (quel que soit le niveau).
- Titulaire chef de département → `{ stages: ["CISO", ...(targetLevelIsAdmin ? ["COO"] : [])], exceptionReason: null }`.
- Autre employé (y compris un suppléant agissant comme COO/CISO/chef — jamais exempté) → `{ stages: ["DEPARTMENT_HEAD", "CISO", ...(targetLevelIsAdmin ? ["COO"] : [])], exceptionReason: null }`.

```typescript
export function computeReductionRoute(
  initiatorRole: "DEPARTMENT_HEAD" | "IT_ACCESS_OPERATOR" | "CISO",
  beneficiaryIsPrimaryCiso: boolean
): ApprovalStageRole[]
```

- `initiatorRole === "CISO"` OU `beneficiaryIsPrimaryCiso` → `["COO"]`.
- Sinon (`DEPARTMENT_HEAD` ou `IT_ACCESS_OPERATOR` initie, bénéficiaire non-CISO) → `["CISO"]`.
- Le retrait d'un accès administrateur n'ajoute jamais automatiquement COO (contrairement à l'octroi) — seule une escalade CISO explicite avec motif le fait, gérée comme une transition de décision (§6), pas dans cette fonction de routage initiale.

Ces deux fonctions ne consultent jamais la base — elles reçoivent des rôles déjà résolus et un booléen déjà calculé, en entrée pure.

## 6. Résolution d'acteur, décisions, revalidation (`lib/access/requests-server.ts`)

**Résolution d'acteur par étape** : réutilise le principe de `getEffectiveRoleHolders` — titulaire disponible non marqué indisponible, sinon suppléant actif. Règle d'indépendance stricte (spec §3) : un acteur ne peut jamais décider une étape s'il est l'initiateur de la version, le bénéficiaire de la demande, ou a déjà décidé une autre étape de cette même version. Aucun acteur éligible trouvé = problème de routage visible (jamais de saut automatique ni d'approbateur inventé), résolu par le Platform Administrator via les écrans de rôles existants (phase 1).

**Revalidation systématique avant toute décision** (même principe que l'import phase 2 — tout-ou-rien, jamais confiance dans un état périmé) : avant d'appliquer `APPROVE`/`REJECT`/`CLARIFY`/`RETURN`, on revérifie que (a) la version décidée est toujours la version courante de la demande, (b) l'acteur est toujours éligible pour cette étape à l'instant présent, (c) `assignmentVersion`/`catalogueVersion` n'ont pas changé depuis la soumission. Un échec de revalidation refuse la décision avec un message explicite (jamais appliquée sur un état obsolète) plutôt que de la bloquer silencieusement.

**Sémantique des décisions :**
- `APPROVE` : marque l'étape décidée ; si c'était la dernière étape requise, la version passe à `AUTHORIZED_WAITING_START` (si `periodStart` futur) ou `READY_FOR_FULFILMENT` (sinon) — fin du périmètre 3a.
- `REJECT` : la version (et la demande) passe à `REJECTED`, terminal, `AccessRequest` supprimé (voir §4).
- `CLARIFY` : la version passe à `CLARIFICATION_REQUIRED`, `reason` porte la question de l'approbateur sur la ligne `AccessApprovalStage` de l'étape courante. L'initiateur répond via `clarificationResponse` (sans changer les termes) — cette réponse remet l'état à `PENDING_APPROVAL` sur la même étape (même `sequence`, `decision` redevient `null` pour permettre une nouvelle décision), jamais de nouvelle version créée.
- `RETURN` : la version passe à `REVISION_REQUIRED` ; l'initiateur modifie les termes et resoumet, ce qui crée une **nouvelle version immuable** (`versionNumber` incrémenté) avec une route recalculée depuis zéro et invalide toutes les décisions de l'ancienne version (elles restent en base pour l'historique, mais ne comptent plus). Actif et bénéficiaire restent immuables après soumission — les changer exige d'annuler et de soumettre une demande différente.
- Escalade CISO→COO : une décision `APPROVE` à l'étape CISO peut porter un indicateur d'escalade avec motif obligatoire, qui ajoute dynamiquement une étape `COO` à la suite plutôt que de terminer la route — modélisé comme l'ajout d'une ligne `AccessApprovalStage` supplémentaire au moment de la décision, pas dans le calcul de route initial.

**Annulation** : l'initiateur peut annuler tant qu'aucune tâche n'a été réclamée — en 3a, le claim n'existe pas encore, donc toujours disponible tant que l'état n'est pas déjà terminal.

## 7. Écrans

Français, composants et pagination existants, mobile d'abord, états chargement/vide/erreur (règles du projet).

| Route | Écran | Réservé à |
| --- | --- | --- |
| `/requests/mine` | Mes demandes : soumission (l'app déduit GRANT/UPGRADE/RENEW/REDUCE/REVOKE), suivi, clarifier/réviser/annuler | Tout utilisateur authentifié (pour soi) ; chef de département/IT/CISO peuvent aussi y initier une réduction/révocation sur un employé de leur périmètre |
| `/requests/approvals` | Mes approbations : étapes en attente pour l'utilisateur (titulaire ou suppléant actif), décision individuelle et multi-sélection en lot, escalade CISO→COO avec motif | Department Head, CISO, COO (effectifs) |

(Deux écrans, pas trois — « Demandes du département » et « Mes demandes » partagent le même écran avec une section conditionnelle selon les rôles effectifs de l'utilisateur, plutôt que deux pages séparées, pour rester cohérent avec la façon dont `/access/assets` de la phase 1 conditionne déjà son contenu par rôle.)

## 8. Audit

Chaque soumission, décision, révision, clarification, escalade, annulation écrit un `AccessAuditEvent` (infrastructure phase 1, `recordAudit`/`recordAuditInTx`) avec acteur réel, rôle représenté, bénéficiaire, avant/après (état de la version), motif. Écrit dans la même transaction que la mutation qu'il décrit (leçon retenue des phases 1/2 : `recordAuditInTx`, pas `recordAudit`, pour ne pas répéter l'écart déjà documenté et reporté en phase 1/2 — voir leurs specs §10).

## 9. Tests

- **Vitest, fonctions pures** : `computeGrantRoute`/`computeReductionRoute` — chaque ligne des deux tableaux du spec §5, y compris les cas d'exemption et l'exclusion des suppléants.
- **Contraintes en base, vraie connexion** : une seule demande non terminale par employé/actif ; aucune auto-approbation ; aucun acteur ne signe deux étapes de la même version ; revalidation détecte un changement de catalogue/assignation survenu après soumission.
- **Scénarios de la spec couverts** (§15, ceux relevant de 3a) : routes de grant/upgrade/renouvellement pour les 4 profils de demandeur, routes de réduction/révocation pour les 3 profils d'initiateur, exemptions COO/CISO, révision à version immuable, clarification sans nouvelle version, absence d'approbateur éligible = problème de routage visible.
- **Vérification manuelle** en navigateur (build de production locale) du chemin essentiel : soumission → routage correct affiché → décision par le bon approbateur → demande prête pour fulfilment.

## 10. Risques et points ouverts

- **Limite avec la phase 3b** : une demande `READY_FOR_FULFILMENT`/`AUTHORIZED_WAITING_START` n'a encore aucune tâche associée — 3b devra créer la tâche de fulfilment à ce point d'entrée exact. Le contrat d'interface (quels champs 3b lit sur `AccessRequestVersion`) est documenté ici mais sera revalidé à la conception de 3b.
- **`AccessRequest` supprimé plutôt qu'archivé** (§4) : choix délibéré pour garder la contrainte d'unicité simple sans champ d'état dupliqué, mais signifie que l'historique complet d'un employé/actif vit dans plusieurs lignes `AccessRequest` distinctes au fil du temps, reliées seulement par `(beneficiaryId, assetId)` sans clé stable commune. Si un futur écran doit afficher « tout l'historique de demandes pour ce couple » en une seule requête, il faudra grouper par `(beneficiaryId, assetId)` plutôt que par une clé de dossier — acceptable en phase 3a (pas d'écran de ce type prévu), à revisiter si la spec l'exige plus tard.
- **Escalade CISO→COO ajoutée dynamiquement** (§6) : modélisée comme une ligne `AccessApprovalStage` ajoutée à la décision plutôt que prévue dans le routage initial — cohérent avec « CISO peut explicitement escalader avec un motif », mais à tester spécifiquement (une escalade sur une réduction déjà à l'étape CISO doit ajouter COO ensuite, pas recalculer toute la route).
- **Vue « Toutes les demandes » CISO/COO** reportée (§2) — si l'usage réel en phase 3a montre que « Mes approbations » est insuffisant pour une supervision globale, cet écran est un ajout simple (lecture seule, portée ALL déjà disponible via `resolveReadScopes`) pour un futur incrément.
