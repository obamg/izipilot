import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { commitCatalogueSeed, ImportError } from "@/lib/access/import-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
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
  const { batchId } = await params;

  try {
    const batch = await commitCatalogueSeed(ctx.orgId, ctx.userId, batchId);
    return Response.json({ data: batch });
  } catch (err) {
    if (err instanceof ImportError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
