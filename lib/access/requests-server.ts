// lib/access/requests-server.ts
import type { Prisma, AccessRequestState, AccessRequestKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { getEffectiveRoleHolders } from "./roles-server";
import { canInitiateDepartmentReduction } from "./requests-read-server";
import { computeGrantRoute, computeReductionRoute, classifyRequest, InvalidRequestError } from "./routing";
import type { ApprovalStageRole, ReductionInitiatorRole } from "./routing";
import type { EffectiveRole } from "./scope";

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

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Famille d'une demande : octroi (GRANT/UPGRADE/RENEW, initié par le
 * bénéficiaire lui-même) ou réduction (REDUCE/REVOKE, initiée par un chef de
 * département/IT/CISO pour quelqu'un d'autre). Les deux familles n'ont ni le
 * même initiateur autorisé ni la même fonction de routage.
 */
type RequestFamily = "GRANT_FAMILY" | "REDUCTION_FAMILY";

function familyOf(kind: AccessRequestKind): RequestFamily {
  return kind === "REDUCE" || kind === "REVOKE" ? "REDUCTION_FAMILY" : "GRANT_FAMILY";
}

interface DeriveRequestTermsInput {
  beneficiaryId: string;
  assetId: string;
  targetLevelId: string | null;
  periodEnd: Date | null;
  /**
   * Révision uniquement : la famille de la version d'origine. Si la
   * reclassification tombe dans l'AUTRE famille, la révision est refusée
   * (jamais de re-routage silencieux d'une réduction en octroi ou inverse).
   */
  expectedFamily?: RequestFamily;
}

interface DerivedRequestTerms {
  kind: AccessRequestKind;
  stages: ApprovalStageRole[];
  exceptionReason: string | null;
  departmentSnapshot: string;
  assignmentVersion: number;
  catalogueVersion: number;
}

/**
 * Dérivation partagée par `submitRequest` et `reviseRequest` — une seule
 * source de vérité pour : contrôles catalogue/cycle de vie, classification
 * (GRANT/UPGRADE/RENEW/REDUCE/REVOKE depuis l'affectation actuelle), contrôle
 * de l'initiateur (le bénéficiaire pour un octroi ; chef du BON département,
 * IT ou CISO pour une réduction), département du bénéficiaire et calcul de la
 * route. Correctif revue finale : `reviseRequest` recopiait auparavant `kind`
 * et recalculait la route à part, sans reclassifier ni revalider — une
 * réduction pouvait ainsi être révisée en octroi de fait, routée comme une
 * réduction, et une réduction visant le CISO titulaire était re-routée vers
 * le CISO lui-même.
 *
 * `client` : `prisma` (soumission) ou `tx` (révision, lue dans la même
 * transaction que la création de la nouvelle version).
 */
async function deriveRequestTerms(
  client: DbClient,
  orgId: string,
  actorId: string,
  input: DeriveRequestTermsInput
): Promise<DerivedRequestTerms> {
  const [beneficiary, beneficiaryProfile, asset, targetLevel, currentAssignment, actorRoles] = await Promise.all([
    client.user.findFirst({ where: { id: input.beneficiaryId, orgId }, select: { id: true } }),
    // `primaryDepartmentId` est le département AUTORITAIRE du bénéficiaire
    // (phase 1 : résolu automatiquement s'il n'appartient qu'à un seul
    // département, arbitré par le CEO via ConfigIssuesPanel sinon) — jamais
    // une ligne `DepartmentMember` arbitraire, non déterministe pour un
    // employé membre de plusieurs départements.
    client.accessProfile.findFirst({
      where: { userId: input.beneficiaryId, orgId },
      select: { lifecycle: true, primaryDepartmentId: true },
    }),
    client.accessAsset.findFirst({
      where: { id: input.assetId, orgId },
      select: { id: true, catalogueVersion: true, archivedAt: true, requestsEnabled: true },
    }),
    input.targetLevelId
      ? client.accessLevel.findFirst({
          where: { id: input.targetLevelId, assetId: input.assetId },
          select: { id: true, priority: true, isAdmin: true, archivedAt: true, enabled: true },
        })
      : Promise.resolve(null),
    client.accessAssignment.findFirst({ where: { orgId, userId: input.beneficiaryId, assetId: input.assetId } }),
    getEffectiveRoleHolders(orgId, actorId, client),
  ]);

  if (!beneficiary) throw new RequestError("Bénéficiaire introuvable dans cette organisation");
  if (!asset) throw new RequestError("Actif introuvable dans cette organisation");
  if (asset.archivedAt !== null) throw new RequestError("Cet actif est archivé — aucune demande possible");
  if (input.targetLevelId && !targetLevel) throw new RequestError("Niveau introuvable ou n'appartenant pas à cet actif");
  if (targetLevel && (targetLevel.archivedAt !== null || !targetLevel.enabled)) {
    throw new RequestError("Le niveau ciblé est archivé ou désactivé");
  }

  const currentLevelPriority = currentAssignment?.levelId
    ? (await client.accessLevel.findUnique({ where: { id: currentAssignment.levelId }, select: { priority: true } }))?.priority ?? null
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
    input.periodEnd
  );

  if (input.expectedFamily && familyOf(kind) !== input.expectedFamily) {
    throw new RequestError(
      "Cette révision change la nature de la demande (octroi ↔ réduction) — annulez et soumettez une nouvelle demande"
    );
  }

  const isReduction = familyOf(kind) === "REDUCTION_FAMILY";
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
  // `requestsEnabled` ne bloque que les octrois : réduire/révoquer un accès
  // existant doit rester possible même sur un actif fermé aux nouvelles
  // demandes (même principe que le cycle de vie ci-dessus — le nettoyage
  // d'accès n'est jamais empêché).
  if (!isReduction && !asset.requestsEnabled) {
    throw new RequestError("Cet actif n'est pas ouvert aux demandes");
  }

  // "" si aucun département principal résolu (appartenance multiple non
  // arbitrée, ou aucun département) : volontaire, pas un TODO — une étape
  // DEPARTMENT_HEAD sur une telle demande n'aura alors aucun acteur éligible,
  // ce qui est un problème de routage visible (déjà remonté au CEO par
  // ConfigIssuesPanel) plutôt qu'un contournement silencieux (contrainte
  // globale : "aucun saut automatique ni approbateur inventé").
  const departmentSnapshot = beneficiaryProfile?.primaryDepartmentId ?? "";

  let stages: ApprovalStageRole[];
  let exceptionReason: string | null;

  if (isReduction) {
    const initiatorRole = pickReductionInitiatorRole(actorRoles, departmentSnapshot);
    const beneficiaryRoles = await getEffectiveRoleHolders(orgId, input.beneficiaryId, client);
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

  return {
    kind,
    stages,
    exceptionReason,
    departmentSnapshot,
    assignmentVersion: currentAssignment?.version ?? 0,
    catalogueVersion: asset.catalogueVersion,
  };
}

/**
 * Rôle au titre duquel l'acteur initie une réduction/révocation, SCOPÉ au
 * département du bénéficiaire (correctif revue finale) : l'autorisation
 * réutilise exactement `canInitiateDepartmentReduction` (même règle que la
 * route GET `.../reducible`, pour que les deux ne divergent jamais) — un chef
 * de département ne peut réduire que les accès d'un employé de SON
 * département ; CISO et IT_ACCESS_OPERATOR sont initiateurs company-wide.
 * Aucun repli silencieux sur un rôle que l'acteur ne détient pas : échec
 * explicite.
 */
function pickReductionInitiatorRole(
  actorRoles: EffectiveRole[],
  beneficiaryDepartmentId: string
): ReductionInitiatorRole {
  if (!canInitiateDepartmentReduction(actorRoles, beneficiaryDepartmentId)) {
    const holdsAnyInitiatorRole = actorRoles.some(
      (r) => r.role === "DEPARTMENT_HEAD" || r.role === "CISO" || r.role === "IT_ACCESS_OPERATOR"
    );
    throw new RequestError(
      holdsAnyInitiatorRole
        ? "Un chef de département ne peut initier une réduction/révocation que pour un employé de son propre département"
        : "Seuls un chef de département, l'opérateur accès IT ou le CISO peuvent initier une réduction/révocation"
    );
  }
  if (actorRoles.some((r) => r.role === "CISO")) return "CISO";
  if (actorRoles.some((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === beneficiaryDepartmentId)) {
    return "DEPARTMENT_HEAD";
  }
  return "IT_ACCESS_OPERATOR";
}

export async function submitRequest(
  orgId: string,
  actorId: string,
  input: SubmitRequestInput
): Promise<RequestVersionDTO> {
  const terms = await deriveRequestTerms(prisma, orgId, actorId, {
    beneficiaryId: input.beneficiaryId,
    assetId: input.assetId,
    targetLevelId: input.targetLevelId,
    periodEnd: input.periodEnd ?? null,
  });
  const { kind, stages, exceptionReason } = terms;

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
          // Département principal du bénéficiaire (voir deriveRequestTerms) :
          // c'est ce "snapshot" que decideStage utilise pour restreindre
          // l'étape DEPARTMENT_HEAD au(x) chef(s) du BON département.
          departmentSnapshot: terms.departmentSnapshot,
          assignmentVersion: terms.assignmentVersion,
          catalogueVersion: terms.catalogueVersion,
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

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

function isRecordNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2025"
  );
}

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
  if (escalateToCoo && !reason) {
    throw new RequestError("Un motif est obligatoire pour escalader vers COO");
  }

  // ⚠️ Toute la logique — y compris les lectures (étape, indépendance,
  // éligibilité, revalidation) — s'exécute DANS cette transaction, jusqu'à
  // l'écriture finale. Faire les lectures avant `$transaction` (comme dans
  // une première version) ouvre un TOCTOU : deux décisions concurrentes
  // (même étape par deux acteurs, ou même acteur sur deux étapes) peuvent
  // toutes deux passer leurs vérifications avant qu'aucune n'ait écrit. Les
  // écritures de clôture (`updateMany` conditionnels plus bas) sont ce qui
  // ferme réellement la course — Postgres en Read Committed ré-évalue leur
  // clause WHERE une fois le verrou de ligne obtenu, après le commit d'une
  // transaction concurrente.
  const updated = await prisma.$transaction(async (tx) => {
    const stage = await tx.accessApprovalStage.findFirst({
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

    // Ordre des étapes : une étape ne peut être décidée que si toutes les
    // étapes de séquence inférieure sont déjà APPROVE (jamais de saut
    // d'étape, ex. CISO avant le chef de département).
    const priorStagesNotYetApproved = version.stages.some(
      (s) => s.sequence < stage.sequence && s.decision !== "APPROVE"
    );
    if (priorStagesNotYetApproved) {
      throw new RequestError("Les étapes précédentes n'ont pas encore été décidées");
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

    // Revalidation : éligibilité de l'acteur pour ce rôle d'étape, à l'instant
    // présent, lue dans CETTE transaction (`tx`) — pas sur le client global —
    // pour qu'elle fasse partie de la même unité atomique que la décision.
    //
    // DEPARTMENT_HEAD est scopé au département du bénéficiaire au moment de
    // la soumission (`version.departmentSnapshot`) : sans ce filtre, N'IMPORTE
    // QUEL chef de département de l'organisation pourrait décider cette
    // étape, pas seulement celui du bénéficiaire. CISO/COO restent non
    // scopés : ce sont des rôles uniques par organisation (index unique
    // partiel en base, Tâche 2), pas rattachés à un département.
    const effectiveRoles = await getEffectiveRoleHolders(orgId, actorId, tx);
    const eligible =
      stage.role === "DEPARTMENT_HEAD"
        ? effectiveRoles.some((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === version.departmentSnapshot)
        : effectiveRoles.some((r) => r.role === stage.role);
    if (!eligible) {
      throw new RequestError("Vous n'êtes plus éligible pour décider cette étape");
    }
    // Même scoping départemental que l'éligibilité ci-dessus (et que
    // `listMyApprovals`) : un acteur titulaire d'UN département mais seulement
    // suppléant de CELUI du bénéficiaire agit ici comme suppléant, pas comme
    // titulaire.
    const actedAsPrimary =
      stage.role === "DEPARTMENT_HEAD"
        ? effectiveRoles.some(
            (r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === version.departmentSnapshot && r.actsAsPrimary
          )
        : effectiveRoles.some((r) => r.role === stage.role && r.actsAsPrimary);

    // Revalidation : catalogue/niveau ciblé/affectation inchangés depuis la soumission.
    //
    // ⚠️ Le niveau ciblé (AccessLevel) a son propre `archivedAt`, distinct de
    // `AccessAsset.catalogueVersion` : archiver un niveau (`archiveLevel` dans
    // catalogue-server.ts) ne fait PAS bumper `catalogueVersion` — seul un
    // changement de `priority`/`isAdmin` via `updateLevel` le fait. Comparer
    // uniquement `catalogueVersion` ne détecterait donc jamais l'archivage
    // du niveau ciblé : il faut vérifier son `archivedAt` séparément.
    const [asset, targetLevel, currentAssignment] = await Promise.all([
      tx.accessAsset.findFirst({ where: { id: request.assetId, orgId }, select: { catalogueVersion: true, archivedAt: true } }),
      version.targetLevelId
        ? tx.accessLevel.findFirst({ where: { id: version.targetLevelId, assetId: request.assetId }, select: { archivedAt: true } })
        : Promise.resolve(null),
      tx.accessAssignment.findFirst({ where: { orgId, userId: request.beneficiaryId, assetId: request.assetId }, select: { version: true } }),
    ]);
    if (!asset || asset.archivedAt !== null || asset.catalogueVersion !== version.catalogueVersion) {
      throw new RequestError("Le catalogue a changé depuis la soumission — décision refusée, la demande doit être revue");
    }
    if (version.targetLevelId && (!targetLevel || targetLevel.archivedAt !== null)) {
      throw new RequestError("Le niveau ciblé a été archivé depuis la soumission — décision refusée, la demande doit être revue");
    }
    if ((currentAssignment?.version ?? 0) !== version.assignmentVersion) {
      throw new RequestError("L'affectation actuelle a changé depuis la soumission — décision refusée, la demande doit être revue");
    }

    // Écriture atomique et conditionnelle de la décision d'étape : la clause
    // `decision: null` du WHERE est ré-évaluée par Postgres au moment où le
    // verrou de ligne est obtenu (Read Committed), donc contre l'état déjà
    // commité par une transaction concurrente le cas échéant — ce qui ferme
    // réellement la course entre deux décisions sur la même étape (ex. une
    // APPROVE et un REJECT simultanés), plutôt que de simplement la réduire.
    const stageUpdateResult = await tx.accessApprovalStage.updateMany({
      where: { id: stageId, decision: null },
      data: {
        actorId,
        actedAsPrimary,
        // CLARIFY ne « décide » pas l'étape : elle doit rester rejouable
        // (decision === null) une fois la clarification obtenue — sinon le
        // garde-fou « stage.decision !== null → déjà décidée » plus haut
        // bloquerait définitivement toute décision ultérieure sur cette
        // étape.
        decision: decision === "CLARIFY" ? null : decision,
        reason,
        decidedAt: decision === "CLARIFY" ? null : new Date(),
      },
    });
    if (stageUpdateResult.count === 0) {
      throw new RequestError("Cette étape a déjà été décidée");
    }

    let newState: AccessRequestState = version.state;

    if (decision === "REJECT") {
      newState = "REJECTED";
    } else if (decision === "CLARIFY") {
      newState = "CLARIFICATION_REQUIRED";
    } else if (decision === "RETURN") {
      newState = "REVISION_REQUIRED";
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
    }

    // Même principe que pour l'étape : écriture atomique et conditionnelle,
    // appliquée à toutes les transitions (APPROVE/REJECT/CLARIFY/RETURN),
    // pas seulement à une branche — sinon deux décisions concurrentes sur
    // deux étapes différentes de la même version pourraient toutes deux
    // écrire un nouvel état de version l'une après l'autre sans se détecter.
    const versionUpdateResult = await tx.accessRequestVersion.updateMany({
      where: { id: version.id, state: "PENDING_APPROVAL" },
      data: { state: newState },
    });
    if (versionUpdateResult.count === 0) {
      throw new RequestError("Cette version n'est plus en attente d'approbation — décision refusée");
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

    // ⚠️ Capturer le DTO final AVANT un éventuel REJECT : supprimer
    // `AccessRequest` cascade-supprime immédiatement `AccessRequestVersion`
    // (onDelete: Cascade dans le schéma) et, en cascade, ses
    // `AccessApprovalStage` — dans la MÊME transaction, pas seulement au
    // commit. Un `findUnique` sur la version APRÈS ce delete renverrait donc
    // `null`. On lit le résultat pendant qu'il existe encore, puis on
    // supprime la demande si nécessaire.
    const finalVersion = await tx.accessRequestVersion.findUnique({
      where: { id: version.id },
      include: { stages: true, request: true },
    });

    if (decision === "REJECT") {
      await tx.accessRequest.delete({ where: { id: request.id } });
    }

    return finalVersion;
  });

  return toVersionDTO(updated as VersionWithStages);
}

/**
 * Réponse de l'initiateur à une clarification demandée par un approbateur
 * (`decideStage(..., "CLARIFY", ...)`). Prend le **même `stageId`** que celui
 * décidé avec CLARIFY — cette étape porte `clarificationResponse` et est
 * remise à zéro (decision/decidedAt null) pour être re-décidée par le même
 * rôle.
 *
 * ⚠️ Même discipline transactionnelle que `decideStage` (Tâche 5) : la
 * lecture de l'étape/version (état, initiateur) se fait avec `tx`, DANS la
 * transaction, pas sur le client `prisma` global avant — sinon deux réponses
 * concurrentes à la même clarification pourraient toutes deux passer la
 * vérification `state === "CLARIFICATION_REQUIRED"` avant qu'aucune n'ait
 * écrit. La fermeture réelle de cette course est l'`updateMany` conditionnel
 * sur la version ci-dessous : sa clause `state: "CLARIFICATION_REQUIRED"` est
 * ré-évaluée par Postgres au moment du verrou de ligne, contre l'état déjà
 * commité par une transaction concurrente le cas échéant. Une fois ce verrou
 * gagné, l'écriture de l'étape elle-même n'a pas besoin d'être conditionnelle
 * : l'exclusivité est déjà acquise pour cette version.
 */
export async function respondToClarification(
  orgId: string,
  actorId: string,
  stageId: string,
  response: string
): Promise<RequestVersionDTO> {
  const updated = await prisma.$transaction(async (tx) => {
    const stage = await tx.accessApprovalStage.findFirst({
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

    const versionUpdateResult = await tx.accessRequestVersion.updateMany({
      where: { id: version.id, state: "CLARIFICATION_REQUIRED" },
      data: { state: "PENDING_APPROVAL" },
    });
    if (versionUpdateResult.count === 0) {
      throw new RequestError("Cette demande n'est plus en attente de clarification");
    }

    await tx.accessApprovalStage.update({
      where: { id: stageId },
      data: { clarificationResponse: response, decision: null, decidedAt: null },
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

/**
 * Révision d'une demande retournée (`decideStage(..., "RETURN", ...)`) :
 * crée une NOUVELLE version (jamais de mutation de l'ancienne, qui reste en
 * base avec son état `REVISION_REQUIRED` pour l'historique) et recalcule la
 * route d'approbation depuis zéro — jamais une simple copie des étapes de
 * l'ancienne version, car le changement (ex. niveau ciblé) peut changer la
 * route requise (ex. ajout de COO si le nouveau niveau est admin).
 *
 * ⚠️ Toutes les lectures utilisées pour reconstruire la route (actif, niveau
 * ciblé, affectation actuelle, rôles effectifs de l'acteur) se font avec
 * `tx`, DANS la même transaction que la lecture initiale de validation —
 * même discipline que `decideStage`. `getEffectiveRoleHolders` est appelé
 * avec `tx` (son 3e paramètre optionnel) pour que la revalidation du rôle de
 * l'acteur fasse partie de la même unité atomique.
 *
 * Concurrence : créer une version est un `create`, pas un `update` — il n'y a
 * donc pas de prédicat d'état à opposer à un `updateMany`. Le risque réel est
 * que deux révisions concurrentes de la MÊME ancienne version calculent
 * toutes deux `versionNumber = oldVersion.versionNumber + 1` et tentent de
 * créer la même paire (requestId, versionNumber). C'est la contrainte unique
 * `@@unique([requestId, versionNumber])` en base qui ferme cette course : la
 * transaction perdante échoue avec `P2002`, traduit ici en `RequestError`
 * plutôt que de laisser fuiter l'erreur Prisma brute.
 */
export async function reviseRequest(
  orgId: string,
  actorId: string,
  versionId: string,
  changes: ReviseRequestChanges
): Promise<RequestVersionDTO> {
  try {
    const created = await prisma.$transaction(async (tx) => {
      const oldVersion = await tx.accessRequestVersion.findFirst({
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

      // État EFFECTIF de la révision : les changements fusionnés sur les
      // termes de l'ancienne version. Actif et bénéficiaire restent
      // immuables (spec §6).
      const targetLevelId = changes.targetLevelId !== undefined ? changes.targetLevelId : oldVersion.targetLevelId;
      const periodEnd = changes.periodEnd !== undefined ? changes.periodEnd : oldVersion.periodEnd;
      const periodStart = changes.periodStart ?? oldVersion.periodStart;

      // Reclassification, contrôles (catalogue, cycle de vie, initiateur,
      // périmètre départemental) et route recalculés exactement comme à la
      // soumission, contre l'état courant — jamais `oldVersion.kind` recopié.
      // Un changement de famille (octroi ↔ réduction) est refusé.
      const terms = await deriveRequestTerms(tx, orgId, actorId, {
        beneficiaryId: oldVersion.request.beneficiaryId,
        assetId: oldVersion.request.assetId,
        targetLevelId,
        periodEnd,
        expectedFamily: familyOf(oldVersion.kind),
      });

      const nextVersionNumber = oldVersion.versionNumber + 1;
      const initialState: AccessRequestState =
        terms.stages.length === 0 ? (periodStart > new Date() ? "AUTHORIZED_WAITING_START" : "READY_FOR_FULFILMENT") : "PENDING_APPROVAL";

      const newVersion = await tx.accessRequestVersion.create({
        data: {
          requestId: oldVersion.requestId,
          versionNumber: nextVersionNumber,
          kind: terms.kind,
          initiatorId: actorId,
          targetLevelId,
          justification: changes.justification ?? oldVersion.justification,
          periodStart,
          periodEnd,
          // Nouvelle version = nouvelle soumission : département principal
          // relu à l'instant présent, cohérent avec la route recalculée.
          departmentSnapshot: terms.departmentSnapshot,
          assignmentVersion: terms.assignmentVersion,
          catalogueVersion: terms.catalogueVersion,
          state: initialState,
          exceptionReason: terms.exceptionReason,
          stages: { create: terms.stages.map((role, i) => ({ sequence: i + 1, role })) },
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
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new RequestError("Cette demande a déjà été révisée entre-temps");
    }
    throw err;
  }
}

/**
 * Annulation par l'initiateur, tant que la demande n'est pas terminale.
 * REJECT/CANCELLED suppriment déjà `AccessRequest` (cascade sur les
 * versions/étapes) — annuler une demande déjà terminale échoue donc
 * naturellement au `findFirst` initial ("Demande introuvable").
 *
 * ⚠️ Même discipline que `decideStage`/`respondToClarification`/
 * `reviseRequest` : lecture de la demande/version courante et vérification
 * de l'initiateur DANS la transaction (`tx`), pas sur `prisma` avant.
 * L'écriture de l'état de la version courante est un `updateMany`
 * conditionnel (prédicat sur l'état lu dans cette même transaction) : si une
 * décision concurrente (ex. REJECT via `decideStage`) a déjà fait avancer
 * cette version, le compte à 0 fait échouer proprement l'annulation plutôt
 * que d'écraser silencieusement un état déjà changé.
 *
 * La suppression de `AccessRequest` elle-même peut échouer avec `P2025` si
 * une autre transaction concurrente (double annulation, ou décision
 * terminale) l'a déjà supprimée entre notre lecture et cette écriture —
 * traduit ici en `RequestError` plutôt que de laisser fuiter l'erreur Prisma
 * brute.
 */
export async function cancelRequest(orgId: string, actorId: string, requestId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const request = await tx.accessRequest.findFirst({
      where: { id: requestId, orgId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!request) throw new RequestError("Demande introuvable dans cette organisation");
    const currentVersion = request.versions[0];
    if (!currentVersion || currentVersion.initiatorId !== actorId) {
      throw new RequestError("Seul l'initiateur peut annuler cette demande");
    }

    const versionUpdateResult = await tx.accessRequestVersion.updateMany({
      where: { id: currentVersion.id, state: currentVersion.state },
      data: { state: "CANCELLED" },
    });
    if (versionUpdateResult.count === 0) {
      throw new RequestError("Cette demande a été modifiée entre-temps — annulation refusée");
    }

    try {
      await tx.accessRequest.delete({ where: { id: requestId } });
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        throw new RequestError("Cette demande a déjà été annulée ou traitée");
      }
      throw err;
    }

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
