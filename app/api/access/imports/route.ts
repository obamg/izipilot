import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { listImportBatches } from "@/lib/access/import-server";
import type { ImportMode } from "@prisma/client";

const VALID_MODES: ImportMode[] = ["CATALOGUE_SEED", "BASELINE_ASSIGNMENTS"];

export async function GET(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAssetAdministrator();
  } catch (err) {
    if (err instanceof AssetAdminAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const { searchParams } = new URL(request.url);
  const modeParam = searchParams.get("mode");
  const mode =
    modeParam && VALID_MODES.includes(modeParam as ImportMode) ? (modeParam as ImportMode) : undefined;

  const data = await listImportBatches(ctx.orgId, mode);
  return Response.json({ data });
}
