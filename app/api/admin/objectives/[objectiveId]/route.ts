import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { updateObjectiveSchema } from "@/lib/validations/admin";

interface Params {
  params: Promise<{ objectiveId: string }>;
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { objectiveId } = await params;

  const obj = await prisma.objective.findFirst({
    where: { id: objectiveId, orgId },
  });
  if (!obj) {
    return Response.json({ error: "Objectif introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateObjectiveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updated = await prisma.objective.update({
    where: { id: objectiveId },
    data: parsed.data,
  });

  return Response.json({ data: updated });
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { objectiveId } = await params;

  const obj = await prisma.objective.findFirst({
    where: { id: objectiveId, orgId },
    include: { _count: { select: { keyResults: { where: { isActive: true } } } } },
  });
  if (!obj) {
    return Response.json({ error: "Objectif introuvable" }, { status: 404 });
  }

  if (obj._count.keyResults > 0) {
    return Response.json(
      { error: "Impossible de supprimer : cet objectif a des KRs actifs" },
      { status: 409 }
    );
  }

  await prisma.objective.update({
    where: { id: objectiveId },
    data: { isActive: false },
  });

  return Response.json({ data: { id: objectiveId, isActive: false } });
}
