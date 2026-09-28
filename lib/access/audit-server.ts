// lib/access/audit-server.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildAuditEvent, type AuditEventInput } from "./audit";

export type { AuditEventInput };

export async function recordAudit(input: AuditEventInput): Promise<void> {
  await recordAuditInTx(prisma, input);
}

export async function recordAuditInTx(
  tx: Prisma.TransactionClient,
  input: AuditEventInput
): Promise<void> {
  const event = buildAuditEvent(input);
  await tx.accessAuditEvent.create({
    data: {
      orgId: event.orgId,
      actorId: event.actorId,
      actorRole: event.actorRole as never,
      primaryCoveredId: event.primaryCoveredId,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      eventType: event.eventType,
      objectType: event.objectType,
      objectId: event.objectId,
      objectVersion: event.objectVersion,
      beneficiaryId: event.beneficiaryId,
      before: event.before as Prisma.InputJsonValue,
      after: event.after as Prisma.InputJsonValue,
      reason: event.reason,
      outcome: event.outcome,
      correlationId: event.correlationId,
    },
  });
}

export interface AuditQueryFilters {
  actorId?: string;
  objectType?: string;
  beneficiaryId?: string;
  from?: Date;
  to?: Date;
}

export interface AccessAuditEventDTO {
  id: string;
  occurredAt: Date;
  actorId: string;
  actorName: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  reason: string | null;
  outcome: string;
}

export async function queryAuditEvents(
  orgId: string,
  filters: AuditQueryFilters,
  pagination: { page: number; pageSize: number }
): Promise<{ rows: AccessAuditEventDTO[]; total: number }> {
  const where: Prisma.AccessAuditEventWhereInput = {
    orgId,
    ...(filters.actorId && { actorId: filters.actorId }),
    ...(filters.objectType && { objectType: filters.objectType }),
    ...(filters.beneficiaryId && { beneficiaryId: filters.beneficiaryId }),
    ...((filters.from || filters.to) && {
      occurredAt: {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.accessAuditEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.accessAuditEvent.count({ where }),
  ]);

  const userIds = [
    ...new Set(rows.flatMap((r) => [r.actorId, r.beneficiaryId].filter((x): x is string => !!x))),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      actorId: r.actorId,
      actorName: nameById.get(r.actorId) ?? null,
      eventType: r.eventType,
      objectType: r.objectType,
      objectId: r.objectId,
      beneficiaryId: r.beneficiaryId,
      beneficiaryName: r.beneficiaryId ? nameById.get(r.beneficiaryId) ?? null : null,
      reason: r.reason,
      outcome: r.outcome,
    })),
  };
}
