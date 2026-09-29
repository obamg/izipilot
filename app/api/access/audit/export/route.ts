// app/api/access/audit/export/route.ts
import { requireAuditViewer, AuditAccessDeniedError } from "@/lib/access/audit-guard";
import { queryAuditEvents, recordAudit } from "@/lib/access/audit-server";
import { toCsvRow } from "@/lib/access/audit";

const CSV_HEADER = ["Date", "Acteur", "Type d'événement", "Objet", "Bénéficiaire", "Résultat", "Motif"];

export async function GET(request: Request) {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireAuditViewer();
  } catch (err) {
    if (err instanceof AuditAccessDeniedError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const filters = {
    actorId: url.searchParams.get("actorId") ?? undefined,
    objectType: url.searchParams.get("objectType") ?? undefined,
    beneficiaryId: url.searchParams.get("beneficiaryId") ?? undefined,
    from: url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined,
    to: url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined,
  };

  // Pas de limite de pageSize à l'export : on récupère tout ce qui correspond
  // au filtre, en une seule passe (le volume de la phase 1 reste modeste —
  // aucune donnée de registre n'existe encore avant la phase 2).
  const result = await queryAuditEvents(ctx.orgId, filters, { page: 1, pageSize: 100000 });

  const lines = [
    toCsvRow(CSV_HEADER),
    ...result.rows.map((r) =>
      toCsvRow([
        r.occurredAt.toISOString(),
        r.actorName ?? r.actorId,
        r.eventType,
        `${r.objectType}:${r.objectId}`,
        r.beneficiaryName ?? r.beneficiaryId ?? "",
        r.outcome,
        r.reason ?? "",
      ])
    ),
  ];

  await recordAudit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorRole: "AUDIT_VIEWER",
    primaryCoveredId: null,
    scopeType: "AUDIT",
    scopeId: null,
    eventType: "AUDIT_EXPORTED",
    objectType: "AccessAuditEvent",
    objectId: "export",
    objectVersion: null,
    beneficiaryId: null,
    before: null,
    after: { rowCount: result.rows.length, filters },
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-acces-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
