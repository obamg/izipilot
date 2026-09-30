// app/api/cron/access-processor/route.ts
import { NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron";
import { log } from "@/lib/log";
import { runAccessProcessor } from "@/lib/access/access-processor";

const logger = log.child("cron/access-processor");

/**
 * GET /api/cron/access-processor
 * Toutes les 5 minutes (cron/crontab). Libère les demandes arrivées à leur
 * date de début, répare les tâches manquantes, marque les accès temporaires
 * échus et crée leur tâche de retrait, renvoie en révision les demandes dont
 * la période est passée avant exécution. Idempotent ; aucun appel externe,
 * aucune notification. Protégé par CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  try {
    const report = await runAccessProcessor(new Date());
    logger.info("run complete", { ...report });
    return Response.json({ ok: true, ...report });
  } catch (err) {
    logger.error("unexpected error", undefined, err);
    return Response.json({ error: "Erreur interne" }, { status: 500 });
  }
}
