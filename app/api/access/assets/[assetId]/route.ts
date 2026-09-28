import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { updateAsset, archiveAsset, CatalogueError } from "@/lib/access/catalogue-server";
import { updateAssetSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const { assetId } = await params;

  const body = await request.json();
  const parsed = updateAssetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  let asset;
  try {
    asset = await updateAsset(assetId, ctx.orgId, parsed.data);
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "ASSET_ADMINISTRATOR",
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: asset.id,
    eventType: "ASSET_UPDATED",
    objectType: "AccessAsset",
    objectId: asset.id,
    objectVersion: asset.catalogueVersion,
    beneficiaryId: null,
    before: null,
    after: asset,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: asset });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const { assetId } = await params;

  // "Suppression" = archivage (spec §4 : un actif n'est jamais supprimé).
  const asset = await archiveAsset(assetId, ctx.orgId);

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "ASSET_ADMINISTRATOR",
    primaryCoveredId: null,
    scopeType: "ASSET",
    scopeId: asset.id,
    eventType: "ASSET_ARCHIVED",
    objectType: "AccessAsset",
    objectId: asset.id,
    objectVersion: asset.catalogueVersion,
    beneficiaryId: null,
    before: null,
    after: asset,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: asset });
}
