import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { createLevel, CatalogueError } from "@/lib/access/catalogue-server";
import { createLevelSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function POST(
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
  const parsed = createLevelSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const level = await createLevel(assetId, ctx.orgId, parsed.data);

    await recordAudit({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      actorRole: "ASSET_ADMINISTRATOR",
      primaryCoveredId: null,
      scopeType: "ASSET",
      scopeId: assetId,
      eventType: "LEVEL_CREATED",
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

    return Response.json({ data: level }, { status: 201 });
  } catch (err) {
    if (err instanceof CatalogueError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (isUniqueConstraintError(err)) {
      return Response.json(
        { error: "Cette priorité est déjà utilisée par un autre niveau actif de cet actif" },
        { status: 409 }
      );
    }
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
