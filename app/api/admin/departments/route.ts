import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { createDepartmentSchema } from "@/lib/validations/admin";

export async function GET() {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const departments = await prisma.department.findMany({
    where: { orgId },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { objectives: { where: { isActive: true } } } },
    },
    orderBy: { sortOrder: "asc" },
  });

  return Response.json({
    data: departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      color: d.color,
      description: d.description,
      isActive: d.isActive,
      ownerId: d.owner.id,
      ownerName: d.owner.name,
      objectiveCount: d._count.objectives,
    })),
  });
}

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = createDepartmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const owner = await prisma.user.findFirst({
    where: { id: parsed.data.ownerId, orgId },
  });
  if (!owner) {
    return Response.json({ error: "Propri\u00e9taire introuvable" }, { status: 400 });
  }

  const existing = await prisma.department.findFirst({
    where: { orgId, code: parsed.data.code },
  });
  if (existing) {
    return Response.json({ error: "Ce code d\u00e9partement existe d\u00e9j\u00e0" }, { status: 409 });
  }

  const maxSort = await prisma.department.aggregate({
    where: { orgId },
    _max: { sortOrder: true },
  });

  const department = await prisma.department.create({
    data: {
      orgId,
      ...parsed.data,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  return Response.json({ data: department }, { status: 201 });
}
