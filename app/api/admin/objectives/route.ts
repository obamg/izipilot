import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { createObjectiveSchema } from "@/lib/validations/admin";

export async function GET(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType"); // DEPARTMENT | PRODUCT
  const entityId = searchParams.get("entityId");
  const quarter = searchParams.get("quarter");

  const where: Record<string, unknown> = { orgId };
  if (entityType === "DEPARTMENT" && entityId) {
    where.entityType = "DEPARTMENT";
    where.departmentId = entityId;
  } else if (entityType === "PRODUCT" && entityId) {
    where.entityType = "PRODUCT";
    where.productId = entityId;
  }
  if (quarter) where.quarter = quarter;

  const objectives = await prisma.objective.findMany({
    where,
    include: {
      department: { select: { id: true, code: true, name: true, color: true } },
      product: { select: { id: true, code: true, name: true, color: true } },
      keyResults: {
        where: { isActive: true },
        include: {
          owner: { select: { id: true, name: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return Response.json({ data: objectives });
}

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = createObjectiveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Verify entity exists in same org
  if (parsed.data.entityType === "DEPARTMENT") {
    const dept = await prisma.department.findFirst({
      where: { id: parsed.data.departmentId, orgId },
    });
    if (!dept) {
      return Response.json({ error: "Département introuvable" }, { status: 400 });
    }
  } else {
    const prod = await prisma.product.findFirst({
      where: { id: parsed.data.productId, orgId },
    });
    if (!prod) {
      return Response.json({ error: "Produit introuvable" }, { status: 400 });
    }
  }

  const maxSort = await prisma.objective.aggregate({
    where: { orgId },
    _max: { sortOrder: true },
  });

  const objective = await prisma.objective.create({
    data: {
      orgId,
      title: parsed.data.title,
      why: parsed.data.why,
      entityType: parsed.data.entityType,
      departmentId: parsed.data.entityType === "DEPARTMENT" ? parsed.data.departmentId : null,
      productId: parsed.data.entityType === "PRODUCT" ? parsed.data.productId : null,
      quarter: parsed.data.quarter,
      year: parsed.data.year,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  return Response.json({ data: objective }, { status: 201 });
}
