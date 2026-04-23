import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { updateProductSchema } from "@/lib/validations/admin";

interface Params {
  params: Promise<{ productId: string }>;
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { productId } = await params;

  const product = await prisma.product.findFirst({
    where: { id: productId, orgId },
  });
  if (!product) {
    return Response.json({ error: "Produit introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateProductSchema.safeParse(body);
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

  const updated = await prisma.product.update({
    where: { id: productId },
    data: parsed.data,
  });

  return Response.json({ data: updated });
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { productId } = await params;

  const product = await prisma.product.findFirst({
    where: { id: productId, orgId },
    include: { _count: { select: { objectives: { where: { isActive: true } } } } },
  });
  if (!product) {
    return Response.json({ error: "Produit introuvable" }, { status: 404 });
  }

  if (product._count.objectives > 0) {
    return Response.json(
      { error: "Impossible de supprimer : ce produit a des objectifs actifs" },
      { status: 409 }
    );
  }

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: false },
  });

  return Response.json({ data: { id: productId, isActive: false } });
}
