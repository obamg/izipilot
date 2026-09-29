// app/api/access/audit/route.ts
import { requireAuditViewer, AuditAccessDeniedError } from "@/lib/access/audit-guard";
import { queryAuditEvents } from "@/lib/access/audit-server";

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
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));

  const filters = {
    actorId: url.searchParams.get("actorId") ?? undefined,
    objectType: url.searchParams.get("objectType") ?? undefined,
    beneficiaryId: url.searchParams.get("beneficiaryId") ?? undefined,
    from: url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined,
    to: url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined,
  };

  const result = await queryAuditEvents(ctx.orgId, filters, { page, pageSize });
  return Response.json({ data: result.rows, total: result.total, page, pageSize });
}
