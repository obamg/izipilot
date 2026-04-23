import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { createProductSchema } from "@/lib/validations/admin";

export async function GET() {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const products = await prisma.product.findMany({
    where: { orgId },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { objectives: { where: { isActive: true } } } },
    },
    orderBy: { sortOrder: "asc" },
  });

  return Response.json({
    data: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      color: p.color,
      description: p.description,
      status: p.status,
      isActive: p.isActive,
      ownerId: p.owner.id,
      ownerName: p.owner.name,
      objectiveCount: p._count.objectives,
    })),
  });
}

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Verify owner belongs to org
  const owner = await prisma.user.findFirst({
    where: { id: parsed.data.ownerId, orgId },
  });
  if (!owner) {
    return Response.json({ error: "Propri\u00e9taire introuvable" }, { status: 400 });
  }

  // Check code uniqueness within org
  const existing = await prisma.product.findFirst({
    where: { orgId, code: parsed.data.code },
  });
  if (existing) {
    return Response.json({ error: "Ce code produit existe d\u00e9j\u00e0" }, { status: 409 });
  }

  const maxSort = await prisma.product.aggregate({
    where: { orgId },
    _max: { sortOrder: true },
  });

  const product = await prisma.product.create({
    data: {
      orgId,
      ...parsed.data,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  return Response.json({ data: product }, { status: 201 });
}
