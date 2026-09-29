// app/api/access/roles/[assignmentId]/route.ts
import { requireCEO } from "@/lib/auth-guard";
import { setPrimaryUnavailable, deleteRoleAssignment } from "@/lib/access/roles-server";
import { setPrimaryUnavailableSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const session = await requireCEO();
  const { assignmentId } = await params;

  const body = await request.json();
  const parsed = setPrimaryUnavailableSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const before = await prisma.accessRoleAssignment.findFirst({
    where: { id: assignmentId, orgId: session.user.orgId },
  });
  if (!before) {
    return Response.json({ error: "Affectation introuvable" }, { status: 404 });
  }

  const updated = await setPrimaryUnavailable(
    assignmentId,
    session.user.orgId,
    parsed.data.primaryUnavailable
  );

  await recordAudit({
    orgId: session.user.orgId,
    actorId: session.user.id,
    actorRole: null,
    primaryCoveredId: updated.userId,
    scopeType: "ROLE_ASSIGNMENT",
    scopeId: updated.id,
    eventType: parsed.data.primaryUnavailable
      ? "PRIMARY_MARKED_UNAVAILABLE"
      : "PRIMARY_MARKED_AVAILABLE",
    objectType: "AccessRoleAssignment",
    objectId: updated.id,
    objectVersion: updated.revision,
    beneficiaryId: updated.userId,
    before,
    after: updated,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  const session = await requireCEO();
  const { assignmentId } = await params;

  const before = await prisma.accessRoleAssignment.findFirst({
    where: { id: assignmentId, orgId: session.user.orgId },
  });
  if (!before) {
    return Response.json({ error: "Affectation introuvable" }, { status: 404 });
  }

  await deleteRoleAssignment(assignmentId, session.user.orgId);

  await recordAudit({
    orgId: session.user.orgId,
    actorId: session.user.id,
    actorRole: null,
    primaryCoveredId: null,
    scopeType: "ROLE_ASSIGNMENT",
    scopeId: assignmentId,
    eventType: "ROLE_REMOVED",
    objectType: "AccessRoleAssignment",
    objectId: assignmentId,
    objectVersion: null,
    beneficiaryId: before.userId,
    before,
    after: null,
    reason: null,
    outcome: "SUCCESS",
    correlationId: null,
  });

  return new Response(null, { status: 204 });
}
