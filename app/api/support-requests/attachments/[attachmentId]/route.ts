import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { accessFor } from "@/lib/support-request-server";
import { readAttachment, safeDownloadName } from "@/lib/storage";
import { log } from "@/lib/log";

// Lecture disque : runtime Node obligatoire.
export const runtime = "nodejs";

const logger = log.child("api/support-attachments");

/**
 * GET /api/support-requests/attachments/:attachmentId
 * Sert le fichier après vérification de l'accès à la demande parente. Les
 * fichiers ne sont jamais exposés en statique : le contrôle d'accès passe
 * forcément par ici.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { attachmentId } = await params;

  const attachment = await prisma.supportRequestAttachment.findFirst({
    where: { id: attachmentId, request: { orgId: session.user.orgId } },
    select: {
      filename: true,
      mimeType: true,
      storageKey: true,
      request: { select: { requesterId: true, assigneeId: true, departmentId: true } },
    },
  });
  if (!attachment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const access = await accessFor(
    { id: session.user.id, orgId: session.user.orgId, role: session.user.role },
    attachment.request
  );
  if (!access.canView) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const data = await readAttachment(attachment.storageKey);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": attachment.mimeType,
        // `attachment` plutôt qu'`inline` : un fichier envoyé par un
        // utilisateur ne doit pas s'exécuter dans l'origine de l'app.
        "Content-Disposition": `attachment; filename="${safeDownloadName(attachment.filename)}"`,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    logger.error("read failed", { attachmentId }, err);
    return Response.json({ error: "Fichier indisponible" }, { status: 404 });
  }
}
