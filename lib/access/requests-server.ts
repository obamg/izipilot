// lib/access/requests-server.ts
import type { Prisma, AccessRequestState, AccessRequestKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { getEffectiveRoleHolders } from "./roles-server";
import { computeGrantRoute, computeReductionRoute, classifyRequest, InvalidRequestError } from "./routing";
import type { ApprovalStageRole } from "./routing";

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

export async function submitRequest(
  orgId: string,
  actorId: string,
  input: SubmitRequestInput
): Promise<RequestVersionDTO> {
  const [beneficiary, beneficiaryProfile, asset, targetLevel, currentAssignment, actorRoles] = await Promise.all([
    prisma.user.findFirst({ where: { id: input.beneficiaryId, orgId }, select: { id: true } }),
    prisma.accessProfile.findFirst({ where: { userId: input.beneficiaryId, orgId }, select: { lifecycle: true } }),
    prisma.accessAsset.findFirst({ where: { id: input.assetId, orgId, archivedAt: null }, select: { id: true, catalogueVersion: true } }),
    input.targetLevelId
      ? prisma.accessLevel.findFirst({
          where: { id: input.targetLevelId, assetId: input.assetId, archivedAt: null },
          select: { id: true, priority: true, isAdmin: true },
        })
      : Promise.resolve(null),
    prisma.accessAssignment.findFirst({ where: { orgId, userId: input.beneficiaryId, assetId: input.assetId } }),
    getEffectiveRoleHolders(orgId, actorId),
  ]);

  if (!beneficiary) throw new RequestError("Bénéficiaire introuvable dans cette organisation");
  if (!asset) throw new RequestError("Actif introuvable dans cette organisation");
  if (input.targetLevelId && !targetLevel) throw new RequestError("Niveau introuvable ou n'appartenant pas à cet actif");

  const currentLevelPriority = currentAssignment?.levelId
    ? (await prisma.accessLevel.findUnique({ where: { id: currentAssignment.levelId }, select: { priority: true } }))?.priority ?? null
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
    input.periodEnd ?? null
  );

  const isReduction = kind === "REDUCE" || kind === "REVOKE";
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

  let stages: ApprovalStageRole[];
  let exceptionReason: string | null;

  if (isReduction) {
    const initiatorRole = pickReductionInitiatorRole(actorRoles.map((r) => r.role));
    if (!initiatorRole) {
      throw new RequestError("Seuls un chef de département, l'opérateur accès IT ou le CISO peuvent initier une réduction/révocation");
    }
    const beneficiaryRoles = await getEffectiveRoleHolders(orgId, input.beneficiaryId);
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
          departmentSnapshot: "", // renseigné par un futur incrément si nécessaire aux vues département
          assignmentVersion: currentAssignment?.version ?? 0,
          catalogueVersion: asset.catalogueVersion,
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

function pickReductionInitiatorRole(
  roles: string[]
): "DEPARTMENT_HEAD" | "IT_ACCESS_OPERATOR" | "CISO" | null {
  if (roles.includes("CISO")) return "CISO";
  if (roles.includes("DEPARTMENT_HEAD")) return "DEPARTMENT_HEAD";
  if (roles.includes("IT_ACCESS_OPERATOR")) return "IT_ACCESS_OPERATOR";
  return null;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
