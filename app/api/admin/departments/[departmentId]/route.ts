import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { updateDepartmentSchema } from "@/lib/validations/admin";

interface Params {
  params: Promise<{ departmentId: string }>;
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { departmentId } = await params;

  const dept = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
  });
  if (!dept) {
    return Response.json({ error: "D\u00e9partement introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (parsed.data.ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: parsed.data.ownerId, orgId },
    });
    if (!owner) {
      return Response.json({ error: "Propri\u00e9taire introuvable" }, { status: 400 });
    }
  }

  const updated = await prisma.department.update({
    where: { id: departmentId },
    data: parsed.data,
  });

  return Response.json({ data: updated });
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { departmentId } = await params;

  const dept = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
    include: { _count: { select: { objectives: { where: { isActive: true } } } } },
  });
  if (!dept) {
    return Response.json({ error: "D\u00e9partement introuvable" }, { status: 404 });
  }

  if (dept._count.objectives > 0) {
    return Response.json(
      { error: "Impossible de supprimer : ce d\u00e9partement a des objectifs actifs" },
      { status: 409 }
    );
  }

  await prisma.department.update({
    where: { id: departmentId },
    data: { isActive: false },
  });

  return Response.json({ data: { id: departmentId, isActive: false } });
}
