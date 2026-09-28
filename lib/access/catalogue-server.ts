import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReadyForRequests, catalogueChangeRequiresVersionBump } from "./catalogue";

export interface LevelDTO {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: Date | null;
}

export interface AssetDTO {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  backupOwnerId: string | null;
  backupOwnerName: string | null;
  requestsEnabled: boolean;
  readyForRequests: boolean;
  catalogueVersion: number;
  archivedAt: Date | null;
  levels: LevelDTO[];
}

function levelToDTO(l: {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: Date | null;
}): LevelDTO {
  return { ...l };
}

function assetToDTO(a: {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  backupOwnerId: string | null;
  requestsEnabled: boolean;
  catalogueVersion: number;
  archivedAt: Date | null;
  owner: { name: string } | null;
  backupOwner: { name: string } | null;
  levels: LevelDTO[];
}): AssetDTO {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    ownerId: a.ownerId,
    ownerName: a.owner?.name ?? null,
    backupOwnerId: a.backupOwnerId,
    backupOwnerName: a.backupOwner?.name ?? null,
    requestsEnabled: a.requestsEnabled,
    readyForRequests: isReadyForRequests({ ownerId: a.ownerId, archivedAt: a.archivedAt }, a.levels),
    catalogueVersion: a.catalogueVersion,
    archivedAt: a.archivedAt,
    levels: a.levels,
  };
}

const ASSET_INCLUDE = {
  owner: { select: { name: true } },
  backupOwner: { select: { name: true } },
  levels: { orderBy: [{ priority: "asc" }, { name: "asc" }] },
} satisfies Prisma.AccessAssetInclude;

export async function listAssets(orgId: string): Promise<AssetDTO[]> {
  const rows = await prisma.accessAsset.findMany({
    where: { orgId },
    include: ASSET_INCLUDE,
    orderBy: { name: "asc" },
  });
  return rows.map((r) => assetToDTO({ ...r, levels: r.levels.map(levelToDTO) }));
}

export interface CreateAssetInput {
  orgId: string;
  name: string;
  description?: string | null;
  ownerId?: string | null;
  backupOwnerId?: string | null;
}

export async function createAsset(input: CreateAssetInput): Promise<AssetDTO> {
  const row = await prisma.accessAsset.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? null,
      ownerId: input.ownerId ?? null,
      backupOwnerId: input.backupOwnerId ?? null,
    },
    include: ASSET_INCLUDE,
  });
  return assetToDTO({ ...row, levels: [] });
}

export interface UpdateAssetInput {
  name?: string;
  description?: string | null;
  ownerId?: string | null;
  backupOwnerId?: string | null;
  requestsEnabled?: boolean;
}

export async function updateAsset(
  assetId: string,
  orgId: string,
  input: UpdateAssetInput
): Promise<AssetDTO> {
  const row = await prisma.accessAsset.update({
    where: { id: assetId, orgId },
    data: { ...input, revision: { increment: 1 } },
    include: ASSET_INCLUDE,
  });
  return assetToDTO({ ...row, levels: row.levels.map(levelToDTO) });
}

export async function archiveAsset(assetId: string, orgId: string): Promise<AssetDTO> {
  const row = await prisma.accessAsset.update({
    where: { id: assetId, orgId },
    data: { archivedAt: new Date(), revision: { increment: 1 } },
    include: ASSET_INCLUDE,
  });
  return assetToDTO({ ...row, levels: row.levels.map(levelToDTO) });
}

export interface CreateLevelInput {
  name: string;
  priority?: number | null;
  isAdmin?: boolean | null;
}

export async function createLevel(
  assetId: string,
  orgId: string,
  input: CreateLevelInput
): Promise<LevelDTO> {
  const asset = await prisma.accessAsset.findFirst({ where: { id: assetId, orgId } });
  if (!asset) throw new CatalogueError("Actif introuvable");

  const row = await prisma.accessLevel.create({
    data: {
      assetId,
      name: input.name,
      priority: input.priority ?? null,
      isAdmin: input.isAdmin ?? null,
    },
  });
  return levelToDTO(row);
}

export interface UpdateLevelInput {
  name?: string;
  priority?: number | null;
  isAdmin?: boolean | null;
  enabled?: boolean;
}

/**
 * Un changement de priorité ou de isAdmin monte la version du catalogue de
 * l'actif parent (spec §4) — fait dans la même transaction que la mise à
 * jour du niveau pour ne jamais désynchroniser les deux.
 */
export async function updateLevel(
  levelId: string,
  orgId: string,
  input: UpdateLevelInput
): Promise<LevelDTO> {
  const existing = await prisma.accessLevel.findFirst({
    where: { id: levelId, asset: { orgId } },
  });
  if (!existing) throw new CatalogueError("Niveau introuvable");

  const changedFields: Array<"priority" | "isAdmin"> = [];
  if (input.priority !== undefined && input.priority !== existing.priority) changedFields.push("priority");
  if (input.isAdmin !== undefined && input.isAdmin !== existing.isAdmin) changedFields.push("isAdmin");
  const bump = catalogueChangeRequiresVersionBump(changedFields);

  const [level] = await prisma.$transaction([
    prisma.accessLevel.update({
      where: { id: levelId },
      data: { ...input, revision: { increment: 1 } },
    }),
    ...(bump
      ? [
          prisma.accessAsset.update({
            where: { id: existing.assetId },
            data: { catalogueVersion: { increment: 1 } },
          }),
        ]
      : []),
  ]);
  return levelToDTO(level);
}

export async function archiveLevel(levelId: string, orgId: string): Promise<LevelDTO> {
  const existing = await prisma.accessLevel.findFirst({
    where: { id: levelId, asset: { orgId } },
  });
  if (!existing) throw new CatalogueError("Niveau introuvable");

  const row = await prisma.accessLevel.update({
    where: { id: levelId },
    data: { archivedAt: new Date(), enabled: false, revision: { increment: 1 } },
  });
  return levelToDTO(row);
}

export class CatalogueError extends Error {}
