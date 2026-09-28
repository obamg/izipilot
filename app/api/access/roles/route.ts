// app/api/access/roles/route.ts
import { requireCEO } from "@/lib/auth-guard";
import { listRoleAssignments, upsertRoleAssignment, RoleAssignmentError } from "@/lib/access/roles-server";
import { upsertRoleAssignmentSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function GET() {
  const session = await requireCEO();
  const data = await listRoleAssignments(session.user.orgId);
  return Response.json({ data });
}

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = upsertRoleAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const assignment = await upsertRoleAssignment({
      orgId,
      ...parsed.data,
      backupUserId: parsed.data.backupUserId ?? null,
    });
    await recordAudit({
      orgId,
      actorId: session.user.id,
      actorRole: null,
      primaryCoveredId: null,
      scopeType: "ROLE_ASSIGNMENT",
      scopeId: assignment.id,
      eventType: "ROLE_ASSIGNED",
      objectType: "AccessRoleAssignment",
      objectId: assignment.id,
      objectVersion: assignment.revision,
      beneficiaryId: assignment.userId,
      before: null,
      after: assignment,
      reason: null,
      outcome: "SUCCESS",
      correlationId: null,
    });
    return Response.json({ data: assignment }, { status: 201 });
  } catch (err) {
    if (err instanceof RoleAssignmentError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
