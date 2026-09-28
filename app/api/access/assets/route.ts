import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { listAssets, createAsset } from "@/lib/access/catalogue-server";
import { createAssetSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function GET() {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const data = await listAssets(ctx.orgId);
  return Response.json({ data });
}

export async function POST(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const body = await request.json();
  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // ⚠️ Correction post-revue (Tâche 14 → Tâche 15) : createAsset (Tâche 14)
  // laisse volontairement remonter le P2002 brut de Prisma sur le doublon
  // (orgId, name) — la Tâche 14 a documenté que ce mappage revient à la
  // couche route. Sans ce try/catch, un nom d'actif dupliqué finirait en 500
  // au lieu d'un 409 propre, contrairement à la convention déjà en place
  // ailleurs dans l'admin (ex. app/api/admin/departments/route.ts).
  let asset;
  try {
    asset = await createAsset({ orgId: ctx.orgId, ...parsed.data });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return Response.json({ error: "Un actif avec ce nom existe déjà" }, { status: 409 });
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
    eventType: "ASSET_CREATED",
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

  return Response.json({ data: asset }, { status: 201 });
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
