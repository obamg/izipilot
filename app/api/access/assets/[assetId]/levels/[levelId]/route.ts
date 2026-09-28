import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { updateLevel, archiveLevel, CatalogueError } from "@/lib/access/catalogue-server";
import { updateLevelSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assetId: string; levelId: string }> }
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
  const { levelId } = await params;

  const body = await request.json();
  const parsed = updateLevelSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const level = await updateLevel(levelId, ctx.orgId, parsed.data);

    await recordAudit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: level.assetId,
      eventType: "LEVEL_UPDATED",
      objectType: "AccessLevel",
      objectId: level.id,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: level,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return Response.json({ data: level });
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assetId: string; levelId: string }> }
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
  const { levelId } = await params;

  try {
    const level = await archiveLevel(levelId, ctx.orgId);

    await recordAudit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: level.assetId,
      eventType: "LEVEL_ARCHIVED",
      objectType: "AccessLevel",
      objectId: level.id,
      objectVersion: null,
      beneficiaryId: null,
      before: null,
      after: level,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });

    return Response.json({ data: level });
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
