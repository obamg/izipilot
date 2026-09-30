// lib/access/requests-read-server.ts
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "./roles-server";
import { isStageDecidable } from "./stage-decidability";
import type { EffectiveRole } from "./scope";

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
  justification: string;
  periodStart: Date;
  periodEnd: Date | null;
  pendingClarificationStageId: string | null;
  /**
   * Motif de l'étape actuellement "bloquante", pour que l'écran affiche
   * pourquoi la demande est dans cet état sans obliger l'utilisateur à
   * deviner :
   * - CLARIFICATION_REQUIRED → le `reason` de l'étape CLARIFY'd
   *   (`decision === null`, même sélection que `pendingClarificationStageId`
   *   ci-dessous — il y en a exactement une).
   * - REVISION_REQUIRED → le `reason` de l'étape `decision === "RETURN"`
   *   (il y en a exactement une).
   * - Sinon → null.
   */
  currentStageReason: string | null;
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
}

interface VersionForSummary {
  id: string;
  requestId: string;
  versionNumber: number;
  kind: string;
  targetLevelId: string | null;
  state: string;
  createdAt: Date;
  justification: string;
  periodStart: Date;
  periodEnd: Date | null;
  outcome: string | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  request: { beneficiaryId: string; assetId: string; closedAt: Date | null };
  // ⚠️ Doit être trié par `sequence` ASC par l'appelant (voir les `orderBy`
  // dans `listMyRequests`/`listMyApprovals` ci-dessous). Une étape CLARIFY'd
  // et une étape future jamais atteinte ont TOUTES DEUX `decision === null` —
  // rien ne les distingue à ce niveau. Seule la position dans l'ordre des
  // séquences permet de retrouver l'étape réellement bloquante : c'est
  // toujours celle de plus petite séquence encore non décidée (la règle
  // d'ordre des étapes dans `decideStage` garantit qu'aucune étape
  // postérieure n'a pu être décidée avant elle). Sans ce tri, `.find()`
  // peut retourner l'id d'une étape future au lieu de celle en attente de
  // clarification.
  //
  // `reason` est déjà retourné par Prisma sans changement de requête : ni
  // `listMyRequests` ni `listMyApprovals` n'appliquent de `select` sur
  // `stages` (seulement `orderBy`), donc tous les champs scalaires — dont
  // `reason` — sont déjà présents à l'exécution ; seul ce type devait être
  // élargi pour que `toSummaries` puisse le lire.
  stages: { id: string; decision: string | null; reason: string | null }[];
}

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
            events: { where: { type: { in: ["CANCELLED", "RECONCILED"] } }, orderBy: { occurredAt: "desc" }, take: 1, select: { reason: true } },
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
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: { request: true, stages: { orderBy: { sequence: "asc" } } },
      },
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
  /**
   * `reason`/`clarificationResponse` de CETTE étape précise (celle
   * effectivement offerte à la décision), pas dérivés de l'état de la
   * version comme `currentStageReason` sur `RequestSummaryDTO`.
   *
   * Nécessaire car `respondToClarification` fait revenir la version à
   * PENDING_APPROVAL dès que l'initiateur répond — l'étape CLARIFY'd garde
   * alors `decision: null` (rejouable) mais la version n'est plus dans l'état
   * CLARIFICATION_REQUIRED, donc `currentStageReason` (state-gated) redevient
   * `null` alors même que c'est le moment où l'approbateur, en train de
   * redécider CETTE étape, a le plus besoin de revoir la question posée et la
   * réponse obtenue. Peuplés sans condition d'état depuis les colonnes de la
   * ligne `AccessApprovalStage` elle-même (déjà chargées, aucune requête
   * supplémentaire) : non nuls dès que cette étape est passée par CLARIFY au
   * moins une fois, quel que soit l'état courant de la version.
   */
  stageReason: string | null;
  stageClarificationResponse: string | null;
}

/**
 * Étapes non décidées où l'utilisateur est effectivement éligible (titulaire ou suppléant actif).
 *
 * Scoping départemental : une étape de rôle DEPARTMENT_HEAD n'est retenue que
 * si l'acteur est effectivement chef (titulaire ou suppléant actif) du
 * département du BÉNÉFICIAIRE (`AccessRequestVersion.departmentSnapshot`),
 * pas de n'importe quel département de l'organisation. Sans ce filtre,
 * n'importe quel chef de département verrait dans sa liste « mes
 * approbations » TOUTES les étapes DEPARTMENT_HEAD en attente de l'org, y
 * compris celles de bénéficiaires d'un département qu'il ne dirige pas —
 * même si `decideStage` (Tâche 5) rejetterait correctement une tentative de
 * décider l'une de ces étapes hors périmètre, les lister est déjà une fuite
 * de visibilité. CISO/COO ne sont pas scopés : rôles uniques par
 * organisation, jamais rattachés à un département.
 *
 * Décidabilité effective (gap post-Tâche 5) : le scoping départemental et
 * l'éligibilité de rôle ne suffisent pas — une étape peut rester listée alors
 * que `decideStage` la rejetterait de toute façon (étape de séquence
 * antérieure pas encore APPROVE, ou acteur non indépendant : initiateur,
 * bénéficiaire, ou ayant déjà décidé une autre étape de la même version).
 * `isStageDecidable` (même prédicat que `decideStage`, seule source de
 * vérité) filtre ces cas pour que la liste ne montre que ce que l'utilisateur
 * peut réellement décider maintenant — sinon l'approbation en lot produit des
 * résultats "en erreur" mystérieux pour des étapes qui n'auraient jamais dû
 * apparaître.
 */
export async function listMyApprovals(orgId: string, userId: string): Promise<PendingStageDTO[]> {
  const effectiveRoles = await getEffectiveRoleHolders(orgId, userId);
  const eligibleRoles = new Set(
    effectiveRoles
      .filter((r) => r.role === "CISO" || r.role === "COO" || r.role === "DEPARTMENT_HEAD")
      .map((r) => r.role)
  );
  if (eligibleRoles.size === 0) return [];

  const headedDepartmentIds = new Set(
    effectiveRoles
      .filter((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId !== null)
      .map((r) => r.departmentId as string)
  );

  const pendingStages = await prisma.accessApprovalStage.findMany({
    where: {
      decision: null,
      role: { in: [...eligibleRoles] as ("DEPARTMENT_HEAD" | "CISO" | "COO")[] },
      requestVersion: { state: "PENDING_APPROVAL", request: { orgId } },
    },
    include: {
      requestVersion: { include: { request: true, stages: { orderBy: { sequence: "asc" } } } },
    },
  });

  const scopedStages = pendingStages.filter((s) =>
    s.role === "DEPARTMENT_HEAD" ? headedDepartmentIds.has(s.requestVersion.departmentSnapshot) : true
  );

  // Filtre de décidabilité effective — voir la doc de la fonction ci-dessus
  // et celle d'`isStageDecidable` (lib/access/stage-decidability.ts) pour le
  // détail des deux règles (ordre des étapes, indépendance).
  const decidableStages = scopedStages.filter(
    (s) =>
      isStageDecidable(
        { id: s.id, sequence: s.sequence },
        s.requestVersion.stages,
        s.requestVersion.initiatorId,
        s.requestVersion.request.beneficiaryId,
        userId
      ).decidable
  );

  const versions = decidableStages.map((s) => s.requestVersion);
  const summaries = await toSummaries(versions);
  const summaryByVersionId = new Map(summaries.map((s) => [s.versionId, s]));

  return decidableStages
    .map((s): PendingStageDTO | null => {
      const summary = summaryByVersionId.get(s.requestVersionId);
      if (!summary) return null;
      // Même scoping départemental que ci-dessus : un acteur qui est chef
      // titulaire d'UN département peut n'être que suppléant d'un AUTRE — ne
      // pas mélanger les deux quand on détermine s'il agit comme primaire
      // pour CETTE étape précise (même logique que la revalidation dans
      // `decideStage`, Tâche 5).
      const actedAsPrimary =
        s.role === "DEPARTMENT_HEAD"
          ? effectiveRoles.some(
              (r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === s.requestVersion.departmentSnapshot && r.actsAsPrimary
            )
          : effectiveRoles.some((r) => r.role === s.role && r.actsAsPrimary);
      return {
        ...summary,
        stageId: s.id,
        stageRole: s.role,
        stageSequence: s.sequence,
        actedAsPrimary,
        // Colonnes de cette étape précise, sans condition d'état — voir la
        // doc de `PendingStageDTO` ci-dessus.
        stageReason: s.reason,
        stageClarificationResponse: s.clarificationResponse,
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

/**
 * Accès actifs des employés du département — base pour initier une
 * réduction/révocation.
 *
 * Résolution des membres via `AccessProfile.primaryDepartmentId` (et non la
 * table de jointure `DepartmentMember`) — correctif gap post-Tâche 5 :
 * `submitRequest` (branche réduction, via `canInitiateDepartmentReduction`)
 * autorise l'initiation en se basant sur `primaryDepartmentId`, département
 * AUTORITAIRE du bénéficiaire (voir `deriveRequestTerms` dans
 * requests-server.ts). Un employé `DepartmentMember` de plusieurs
 * départements n'a qu'UN SEUL `primaryDepartmentId` ; lister via
 * `DepartmentMember` ferait apparaître cet employé dans le panneau de
 * réduction de CHAQUE département dont il est membre, alors que
 * `submitRequest` rejetterait la soumission depuis tous ces départements sauf
 * celui qui est effectivement son `primaryDepartmentId`. Les deux sources
 * doivent rester alignées pour que la liste n'annonce jamais une réduction
 * qui échouera ensuite avec une `RequestError`.
 */
export async function listDepartmentReducibleAccess(
  orgId: string,
  departmentId: string
): Promise<DepartmentEmployeeAssetDTO[]> {
  const members = await prisma.accessProfile.findMany({
    where: { orgId, primaryDepartmentId: departmentId },
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

/**
 * Autorise l'initiation d'une réduction/révocation d'accès pour CE
 * département précis : le chef effectif (titulaire ou suppléant actif) de ce
 * département, ou CISO/IT_ACCESS_OPERATOR (initiateurs company-wide — voir
 * `ReductionInitiatorRole` dans `lib/access/routing.ts`, le même trio utilisé
 * pour router les réductions).
 *
 * ⚠️ Le filtre `r.departmentId === departmentId` sur DEPARTMENT_HEAD est
 * obligatoire : `getEffectiveRoleHolders` n'émet une entrée DEPARTMENT_HEAD
 * que pour le(s) département(s) que l'acteur dirige effectivement (titulaire
 * ou suppléant actif), jamais une entrée générique « est chef de département
 * quelque part ». Sans ce filtre, le chef d'un AUTRE département passerait à
 * tort ce contrôle — même classe de bug que le scoping départemental déjà
 * corrigé dans `listMyApprovals` ci-dessus et dans `decideStage` (Tâche 5).
 * Extrait de la route dans un helper testable unitairement (post-revue,
 * Tâche 12) pour éviter que cette logique d'autorisation ne vive, seule dans
 * tout ce module, sans couverture de test.
 */
export function canInitiateDepartmentReduction(
  effectiveRoles: EffectiveRole[],
  departmentId: string
): boolean {
  const isThisDeptHead = effectiveRoles.some(
    (r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === departmentId
  );
  const isCompanyWideInitiator = effectiveRoles.some(
    (r) => r.role === "CISO" || r.role === "IT_ACCESS_OPERATOR"
  );
  return isThisDeptHead || isCompanyWideInitiator;
}
