import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { updateKeyResultSchema } from "@/lib/validations/admin";

interface Params {
  params: Promise<{ krId: string }>;
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { krId } = await params;

  const kr = await prisma.keyResult.findFirst({
    where: { id: krId, orgId },
  });
  if (!kr) {
    return Response.json({ error: "Key Result introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateKeyResultSchema.safeParse(body);
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
      return Response.json({ error: "Propriétaire introuvable" }, { status: 400 });
    }
  }

  const updated = await prisma.keyResult.update({
    where: { id: krId },
    data: parsed.data,
  });

  return Response.json({ data: updated });
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { krId } = await params;

  const kr = await prisma.keyResult.findFirst({
    where: { id: krId, orgId },
    include: { _count: { select: { weeklyEntries: true } } },
  });
  if (!kr) {
    return Response.json({ error: "Key Result introuvable" }, { status: 404 });
  }

  if (kr._count.weeklyEntries > 0) {
    // Soft delete — has history
    await prisma.keyResult.update({
      where: { id: krId },
      data: { isActive: false },
    });
  } else {
    // Hard delete — no history
    await prisma.keyResult.delete({ where: { id: krId } });
  }

  return Response.json({ data: { id: krId, deleted: true } });
}
