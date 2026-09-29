// lib/access/import-server.ts
import type { Prisma, ImportMode, ImportRowOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { parseSeedCsv, extractDistinctPairs, computeFileHash, type SeedPair } from "./import";
import { parseBaselineCsv, classifyBaselineRows, type BaselineCsvRow } from "./import";

export interface ImportRowDTO {
  id: string;
  rowIndex: number;
  sourceFields: Record<string, string | null>;
  resolvedAssetId: string | null;
  resolvedLevelId: string | null;
  resolvedUserId: string | null;
  outcome: ImportRowOutcome;
  reason: string | null;
}

export interface ImportBatchDTO {
  id: string;
  mode: ImportMode;
  fileName: string;
  fileHash: string;
  actorId: string;
  actorName: string | null;
  totalRows: number;
  committedAt: Date | null;
  createdAt: Date;
  rows: ImportRowDTO[];
}

export class ImportError extends Error {}

type BatchWithRows = Prisma.ImportBatchGetPayload<{ include: { rows: true } }>;

function toBatchDTO(batch: BatchWithRows, actorName: string | null): ImportBatchDTO {
  return {
    id: batch.id,
    mode: batch.mode,
    fileName: batch.fileName,
    fileHash: batch.fileHash,
    actorId: batch.actorId,
    actorName,
    totalRows: batch.totalRows,
    committedAt: batch.committedAt,
    createdAt: batch.createdAt,
    rows: batch.rows
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .map((r) => ({
        id: r.id,
        rowIndex: r.rowIndex,
        sourceFields: r.sourceFields as Record<string, string | null>,
        resolvedAssetId: r.resolvedAssetId,
        resolvedLevelId: r.resolvedLevelId,
        resolvedUserId: r.resolvedUserId,
        outcome: r.outcome,
        reason: r.reason,
      })),
  };
}

async function actorNameFor(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

async function resolveSeedPair(
  orgId: string,
  pair: SeedPair
): Promise<{ outcome: "MATCHED" | "DRAFT_CREATED"; resolvedAssetId: string | null; resolvedLevelId: string | null }> {
  const asset = await prisma.accessAsset.findFirst({
    where: { orgId, name: pair.logiciel },
  });
  if (!asset) return { outcome: "DRAFT_CREATED", resolvedAssetId: null, resolvedLevelId: null };
  const level = await prisma.accessLevel.findFirst({
    where: { assetId: asset.id, name: pair.niveauAcces },
  });
  if (!level) return { outcome: "DRAFT_CREATED", resolvedAssetId: asset.id, resolvedLevelId: null };
  return { outcome: "MATCHED", resolvedAssetId: asset.id, resolvedLevelId: level.id };
}

export async function previewCatalogueSeed(
  orgId: string,
  actorId: string,
  fileName: string,
  content: string
): Promise<ImportBatchDTO> {
  const rows = parseSeedCsv(content);
  const pairs = extractDistinctPairs(rows);
  const fileHash = computeFileHash(content);
  const resolved = await Promise.all(pairs.map((pair) => resolveSeedPair(orgId, pair)));

  const batch = await prisma.importBatch.create({
    data: {
      orgId,
      mode: "CATALOGUE_SEED",
      fileHash,
      fileName,
      actorId,
      totalRows: pairs.length,
      rows: {
        create: pairs.map((pair, i) => ({
          rowIndex: i,
          sourceFields: pair as unknown as Prisma.InputJsonValue,
          resolvedAssetId: resolved[i].resolvedAssetId,
          resolvedLevelId: resolved[i].resolvedLevelId,
          outcome: resolved[i].outcome,
        })),
      },
    },
    include: { rows: true },
  });
  return toBatchDTO(batch, await actorNameFor(actorId));
}

export async function commitCatalogueSeed(
  orgId: string,
  actorId: string,
  batchId: string
): Promise<ImportBatchDTO> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, orgId, mode: "CATALOGUE_SEED" },
    include: { rows: true },
  });
  if (!batch) throw new ImportError("Lot d'import introuvable");
  if (batch.committedAt) throw new ImportError("Ce lot a déjà été commité");

  const rowsSorted = [...batch.rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const pairs = rowsSorted.map((r) => r.sourceFields as unknown as SeedPair);

  const updated = await prisma.$transaction(async (tx) => {
    const assetIdByName = new Map<string, string>();

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      let assetId = assetIdByName.get(pair.logiciel);
      if (!assetId) {
        const existing = await tx.accessAsset.findFirst({
          where: { orgId, name: pair.logiciel },
        });
        const asset =
          existing ??
          (await tx.accessAsset.create({
            data: { orgId, name: pair.logiciel, sourceLabel: pair.logiciel },
          }));
        assetId = asset.id;
        assetIdByName.set(pair.logiciel, assetId);
      }

      let level = await tx.accessLevel.findFirst({
        where: { assetId, name: pair.niveauAcces },
      });
      const outcome: "MATCHED" | "DRAFT_CREATED" = level ? "MATCHED" : "DRAFT_CREATED";
      if (!level) {
        level = await tx.accessLevel.create({
          data: {
            assetId,
            name: pair.niveauAcces,
            priority: null,
            isAdmin: null,
            sourceLabel: pair.niveauAcces,
          },
        });
      }

      await tx.importRow.update({
        where: { id: rowsSorted[i].id },
        data: { resolvedAssetId: assetId, resolvedLevelId: level.id, outcome },
      });
    }

    const { count } = await tx.importBatch.updateMany({
      where: { id: batchId, orgId, committedAt: null },
      data: { committedAt: new Date() },
    });
    if (count === 0) {
      throw new ImportError("Ce lot a déjà été commité");
    }
    const committed = await tx.importBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });

    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "IMPORT",
      scopeId: batchId,
      eventType: "IMPORT_COMMITTED",
      objectType: "ImportBatch",
      objectId: batchId,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: { mode: "CATALOGUE_SEED", totalRows: committed.totalRows },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return committed;
  });

  return toBatchDTO(updated, await actorNameFor(actorId));
}

interface ResolvedBaselineRow {
  outcome: ImportRowOutcome;
  resolvedUserId: string | null;
  resolvedAssetId: string | null;
  resolvedLevelId: string | null;
  reason: string | null;
}

async function resolveBaselineRow(orgId: string, row: BaselineCsvRow): Promise<ResolvedBaselineRow> {
  const [user, profile, asset, level] = await Promise.all([
    prisma.user.findFirst({ where: { id: row.userId, orgId }, select: { id: true } }),
    prisma.accessProfile.findFirst({ where: { userId: row.userId, orgId }, select: { lifecycle: true } }),
    prisma.accessAsset.findFirst({ where: { id: row.assetId, orgId, archivedAt: null }, select: { id: true } }),
    prisma.accessLevel.findFirst({
      where: { id: row.accessLevelId, assetId: row.assetId, archivedAt: null },
      select: { id: true },
    }),
  ]);

  if (!user) {
    return { outcome: "UNRESOLVED", resolvedUserId: null, resolvedAssetId: null, resolvedLevelId: null, reason: "Utilisateur introuvable dans cette organisation" };
  }
  if (!profile || profile.lifecycle !== "ACTIVE") {
    return { outcome: "UNRESOLVED", resolvedUserId: user.id, resolvedAssetId: null, resolvedLevelId: null, reason: "Utilisateur non actif (en départ ou parti)" };
  }
  if (!asset) {
    return { outcome: "UNRESOLVED", resolvedUserId: user.id, resolvedAssetId: null, resolvedLevelId: null, reason: "Actif introuvable dans cette organisation" };
  }
  if (!level) {
    return { outcome: "UNRESOLVED", resolvedUserId: user.id, resolvedAssetId: asset.id, resolvedLevelId: null, reason: "Niveau introuvable ou n'appartenant pas à cet actif" };
  }

  const existing = await prisma.accessAssignment.findFirst({ where: { userId: user.id, assetId: asset.id } });
  if (!existing) {
    return { outcome: "TO_CREATE", resolvedUserId: user.id, resolvedAssetId: asset.id, resolvedLevelId: level.id, reason: null };
  }
  if (existing.status === "ACTIVE" && existing.levelId === level.id) {
    return { outcome: "NOOP_UNCHANGED", resolvedUserId: user.id, resolvedAssetId: asset.id, resolvedLevelId: level.id, reason: null };
  }
  return {
    outcome: "CONFLICT",
    resolvedUserId: user.id,
    resolvedAssetId: asset.id,
    resolvedLevelId: level.id,
    reason:
      existing.status !== "ACTIVE"
        ? "Une affectation existe déjà pour cet employé et cet actif mais n'est plus active — non réactivée automatiquement"
        : "Une affectation active différente existe déjà pour cet employé et cet actif",
  };
}

async function resolveBaselineBatch(
  orgId: string,
  rows: BaselineCsvRow[]
): Promise<ResolvedBaselineRow[]> {
  const classifications = classifyBaselineRows(rows);
  return Promise.all(
    rows.map((row, i) => {
      if (classifications[i] === "INTERNAL_CONFLICT") {
        return Promise.resolve<ResolvedBaselineRow>({
          outcome: "CONFLICT",
          resolvedUserId: null,
          resolvedAssetId: null,
          resolvedLevelId: null,
          reason: "Incohérence dans le fichier : ce couple employé/actif porte plusieurs niveaux différents dans ce fichier",
        });
      }
      if (classifications[i] === "DUPLICATE") {
        return Promise.resolve<ResolvedBaselineRow>({
          outcome: "NOOP_DUPLICATE",
          resolvedUserId: null,
          resolvedAssetId: null,
          resolvedLevelId: null,
          reason: null,
        });
      }
      return resolveBaselineRow(orgId, row);
    })
  );
}

export async function previewBaselineAssignments(
  orgId: string,
  actorId: string,
  fileName: string,
  content: string
): Promise<ImportBatchDTO> {
  const rows = parseBaselineCsv(content);
  const fileHash = computeFileHash(content);
  const resolved = await resolveBaselineBatch(orgId, rows);

  const batch = await prisma.importBatch.create({
    data: {
      orgId,
      mode: "BASELINE_ASSIGNMENTS",
      fileHash,
      fileName,
      actorId,
      totalRows: rows.length,
      rows: {
        create: rows.map((row, i) => ({
          rowIndex: i,
          sourceFields: row as unknown as Prisma.InputJsonValue,
          resolvedUserId: resolved[i].resolvedUserId,
          resolvedAssetId: resolved[i].resolvedAssetId,
          resolvedLevelId: resolved[i].resolvedLevelId,
          outcome: resolved[i].outcome,
          reason: resolved[i].reason,
        })),
      },
    },
    include: { rows: true },
  });
  return toBatchDTO(batch, await actorNameFor(actorId));
}

/**
 * Revalide TOUJOURS entièrement contre l'état actuel de la base avant de
 * commiter — jamais confiance dans les lignes stockées à la prévisualisation
 * (spec : « stale previews... block the whole commit »). Tout-ou-rien : le
 * lot ne se commite que si zéro ligne UNRESOLVED/CONFLICT après revalidation.
 */
export async function commitBaselineAssignments(
  orgId: string,
  actorId: string,
  batchId: string
): Promise<ImportBatchDTO> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, orgId, mode: "BASELINE_ASSIGNMENTS" },
    include: { rows: true },
  });
  if (!batch) throw new ImportError("Lot d'import introuvable");
  if (batch.committedAt) throw new ImportError("Ce lot a déjà été commité");

  const rowsSorted = [...batch.rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const sourceRows = rowsSorted.map((r) => r.sourceFields as unknown as BaselineCsvRow);
  const resolved = await resolveBaselineBatch(orgId, sourceRows);
  const hasBlockingRow = resolved.some((r) => r.outcome === "UNRESOLVED" || r.outcome === "CONFLICT");

  const updated = await prisma.$transaction(async (tx) => {
    for (let i = 0; i < rowsSorted.length; i++) {
      await tx.importRow.update({
        where: { id: rowsSorted[i].id },
        data: {
          resolvedUserId: resolved[i].resolvedUserId,
          resolvedAssetId: resolved[i].resolvedAssetId,
          resolvedLevelId: resolved[i].resolvedLevelId,
          outcome: resolved[i].outcome,
          reason: resolved[i].reason,
        },
      });
    }

    if (hasBlockingRow) {
      return tx.importBatch.findUniqueOrThrow({ where: { id: batchId }, include: { rows: true } });
    }

    for (const r of resolved) {
      if (r.outcome !== "TO_CREATE") continue;
      const assignment = await tx.accessAssignment.create({
        data: {
          orgId,
          userId: r.resolvedUserId as string,
          assetId: r.resolvedAssetId as string,
          levelId: r.resolvedLevelId as string,
          status: "ACTIVE",
          verification: "IMPORTED_UNREVIEWED",
          source: "LEGACY_IMPORT",
          periodStart: new Date(),
        },
      });
      await tx.accessAssignmentEvent.create({
        data: {
          orgId,
          assignmentId: assignment.id,
          userId: assignment.userId,
          assetId: assignment.assetId,
          beforeLevelId: null,
          afterLevelId: assignment.levelId,
          actorId,
          actorRole: "ASSET_ADMINISTRATOR",
          sourceType: "IMPORT",
          sourceId: batchId,
          outcome: "ASSIGNED",
        },
      });
    }

    const { count } = await tx.importBatch.updateMany({
      where: { id: batchId, orgId, committedAt: null },
      data: { committedAt: new Date() },
    });
    if (count === 0) {
      throw new ImportError("Ce lot a déjà été commité");
    }
    const committed = await tx.importBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });

    await recordAuditInTx(tx, {
      orgId,
      actorId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "IMPORT",
      scopeId: batchId,
      eventType: "IMPORT_COMMITTED",
      objectType: "ImportBatch",
      objectId: batchId,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: { mode: "BASELINE_ASSIGNMENTS", totalRows: committed.totalRows },
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return committed;
  });

  return toBatchDTO(updated, await actorNameFor(actorId));
}

export async function listImportBatches(orgId: string, mode?: ImportMode): Promise<ImportBatchDTO[]> {
  const batches = await prisma.importBatch.findMany({
    where: { orgId, ...(mode && { mode }) },
    include: { rows: true },
    orderBy: { createdAt: "desc" },
  });

  const actorIds = [...new Set(batches.map((b) => b.actorId))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name]));

  return batches.map((b) => toBatchDTO(b, nameById.get(b.actorId) ?? null));
}
