// app/api/access/profiles/[userId]/route.ts
import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { setPrimaryDepartmentSchema } from "@/lib/validations/access";
import { recordAudit } from "@/lib/access/audit-server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await requireCEO();
  const { userId } = await params;
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = setPrimaryDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const department = await prisma.department.findFirst({
    where: { id: parsed.data.primaryDepartmentId, orgId },
  });
  if (!department) {
    return Response.json({ error: "Département introuvable" }, { status: 400 });
  }

  // ⚠️ Correction post-revue (Tâche 12, fix round) : `userId` vient de l'URL et
  // n'appartient pas forcément à l'org de l'appelant. Chercher le profil par
  // (userId, orgId) — jamais par userId seul — sinon un CEO d'une org peut
  // modifier le profil d'accès d'un utilisateur d'une autre org (IDOR
  // cross-tenant), même si le département choisi, lui, reste bien vérifié.
  const before = await prisma.accessProfile.findFirst({ where: { userId, orgId } });
  if (!before) {
    return Response.json({ error: "Profil introuvable" }, { status: 404 });
  }

  const updated = await prisma.accessProfile.update({
    where: { id: before.id },
    data: { primaryDepartmentId: parsed.data.primaryDepartmentId, revision: { increment: 1 } },
  });

  await recordAudit({
    orgId,
    actorId: session.user.id,
    actorRole: null,
    primaryCoveredId: null,
    scopeType: "ACCESS_PROFILE",
    scopeId: updated.id,
    eventType: "PRIMARY_DEPARTMENT_SET",
    objectType: "AccessProfile",
    objectId: updated.id,
    objectVersion: updated.revision,
    beneficiaryId: userId,
    before: before ? { primaryDepartmentId: before.primaryDepartmentId } : null,
    after: { primaryDepartmentId: updated.primaryDepartmentId },
    reason: "Correction manuelle par l'administrateur de plateforme",
    outcome: "SUCCESS",
    correlationId: null,
  });

  return Response.json({ data: updated });
}
