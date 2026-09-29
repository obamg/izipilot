import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listDepartmentReducibleAccess } from "@/lib/access/requests-read-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ departmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { departmentId } = await params;

  const department = await prisma.department.findFirst({
    where: { id: departmentId, orgId: session.user.orgId },
    select: { id: true },
  });
  if (!department) {
    return Response.json({ error: "Département introuvable" }, { status: 404 });
  }

  const effectiveRoles = await getEffectiveRoleHolders(session.user.orgId, session.user.id);
  const isThisDeptHead = effectiveRoles.some((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === departmentId);
  const isCompanyWideInitiator = effectiveRoles.some((r) => r.role === "CISO" || r.role === "IT_ACCESS_OPERATOR");
  if (!isThisDeptHead && !isCompanyWideInitiator) {
    return Response.json({ error: "Non autorisé pour ce département" }, { status: 403 });
  }

  const data = await listDepartmentReducibleAccess(session.user.orgId, departmentId);
  return Response.json({ data });
}
