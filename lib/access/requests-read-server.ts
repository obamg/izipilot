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

  const versions = scopedStages.map((s) => s.requestVersion);
  const summaries = await toSummaries(versions);
  const summaryByVersionId = new Map(summaries.map((s) => [s.versionId, s]));

  return scopedStages
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
