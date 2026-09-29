import { requireAssetAdministrator, AssetAdminAccessDeniedError } from "@/lib/access/asset-admin-guard";
import { previewBaselineAssignments } from "@/lib/access/import-server";
import { CsvParseError } from "@/lib/access/import";

export const runtime = "nodejs";

const MAX_BASELINE_FILE_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/access/imports/baseline
 * Multipart, champ `file`. Prévisualise sans rien créer — voir Tâche 4.
 */
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

  let file: File | null = null;
  try {
    const form = (await request.formData()) as unknown as globalThis.FormData;
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return Response.json({ error: "Corps multipart invalide" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ error: "Aucun fichier reçu" }, { status: 400 });
  }
  if (file.size > MAX_BASELINE_FILE_BYTES) {
    return Response.json({ error: "Fichier trop lourd (max 5 Mo)" }, { status: 413 });
  }

  const content = await file.text();
  try {
    const batch = await previewBaselineAssignments(ctx.orgId, ctx.userId, file.name.slice(0, 200), content);
    return Response.json({ data: batch }, { status: 201 });
  } catch (err) {
    if (err instanceof CsvParseError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
