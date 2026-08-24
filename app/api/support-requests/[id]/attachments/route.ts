import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { loadRequestForViewer } from "@/lib/support-request-server";
import { serializeSupportAttachment } from "@/lib/support-request-serialize";
import { storeAttachment } from "@/lib/storage";
import { ALLOWED_MIME_TYPES, isAllowedMimeType, MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { log } from "@/lib/log";

// Écriture disque : ce handler ne peut pas tourner sur le runtime edge.
export const runtime = "nodejs";

const logger = log.child("api/support-attachments");

/** Au-delà, la page devient illisible et le volume grossit pour rien. */
const MAX_ATTACHMENTS_PER_REQUEST = 10;

/**
 * POST /api/support-requests/:id/attachments
 * Multipart, champ `file`. Réservé aux personnes ayant accès à la demande.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const viewer = {
    id: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
  };
  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) {
    return Response.json({ error: "Request not found" }, { status: 404 });
  }

  let file: File | null = null;
  try {
    // NextRequest hérite du FormData d'undici, dont les typings résolus ici ne
    // portent pas `get`. On repasse par le type DOM, qui est la forme réelle à
    // l'exécution sur le runtime Node de Next.
    const form = (await request.formData()) as unknown as globalThis.FormData;
    const candidate = form.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return Response.json({ error: "Invalid multipart body" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ error: "Aucun fichier reçu" }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Response.json(
      { error: `Fichier trop lourd (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} Mo)` },
      { status: 413 }
    );
  }
  if (!isAllowedMimeType(file.type)) {
    return Response.json(
      {
        error: "Type de fichier non autorisé",
        allowed: Object.keys(ALLOWED_MIME_TYPES),
      },
      { status: 415 }
    );
  }

  const count = await prisma.supportRequestAttachment.count({ where: { requestId: id } });
  if (count >= MAX_ATTACHMENTS_PER_REQUEST) {
    return Response.json(
      { error: `Maximum ${MAX_ATTACHMENTS_PER_REQUEST} pièces jointes par demande` },
      { status: 409 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storeAttachment(id, buffer, file.type);

    const attachment = await prisma.supportRequestAttachment.create({
      data: {
        requestId: id,
        uploadedById: viewer.id,
        // Nom d'origine conservé pour l'affichage uniquement — il n'entre
        // jamais dans le chemin disque (voir lib/storage.ts).
        filename: file.name.slice(0, 200),
        mimeType: file.type,
        size: stored.size,
        storageKey: stored.storageKey,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    revalidatePath(`/support/${id}`);
    return Response.json({ attachment: serializeSupportAttachment(attachment) }, { status: 201 });
  } catch (err) {
    logger.error("upload failed", { requestId: id }, err);
    return Response.json({ error: "Échec de l'envoi du fichier" }, { status: 500 });
  }
}
