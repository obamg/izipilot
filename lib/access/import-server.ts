// lib/access/import-server.ts
import type { Prisma, ImportMode, ImportRowOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditInTx } from "./audit-server";
import { parseSeedCsv, extractDistinctPairs, computeFileHash, type SeedPair } from "./import";

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
    where: { orgId, name: pair.logiciel, archivedAt: null },
  });
  if (!asset) return { outcome: "DRAFT_CREATED", resolvedAssetId: null, resolvedLevelId: null };
  const level = await prisma.accessLevel.findFirst({
    where: { assetId: asset.id, name: pair.niveauAcces, archivedAt: null },
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
          where: { orgId, name: pair.logiciel, archivedAt: null },
        });
        const asset = existing ?? (await tx.accessAsset.create({ data: { orgId, name: pair.logiciel } }));
        assetId = asset.id;
        assetIdByName.set(pair.logiciel, assetId);
      }

      let level = await tx.accessLevel.findFirst({
        where: { assetId, name: pair.niveauAcces, archivedAt: null },
      });
      const outcome: "MATCHED" | "DRAFT_CREATED" = level ? "MATCHED" : "DRAFT_CREATED";
      if (!level) {
        level = await tx.accessLevel.create({
          data: { assetId, name: pair.niveauAcces, priority: null, isAdmin: null },
        });
      }

      await tx.importRow.update({
        where: { id: rowsSorted[i].id },
        data: { resolvedAssetId: assetId, resolvedLevelId: level.id, outcome },
      });
    }

    const committed = await tx.importBatch.update({
      where: { id: batchId },
      data: { committedAt: new Date() },
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
