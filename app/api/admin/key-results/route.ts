import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { createKeyResultSchema } from "@/lib/validations/admin";

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = createKeyResultSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Verify objective exists in same org
  const objective = await prisma.objective.findFirst({
    where: { id: parsed.data.objectiveId, orgId },
  });
  if (!objective) {
    return Response.json({ error: "Objectif introuvable" }, { status: 400 });
  }

  // Verify owner exists in same org
  const owner = await prisma.user.findFirst({
    where: { id: parsed.data.ownerId, orgId },
  });
  if (!owner) {
    return Response.json({ error: "Propriétaire introuvable" }, { status: 400 });
  }

  const maxSort = await prisma.keyResult.aggregate({
    where: { objectiveId: parsed.data.objectiveId },
    _max: { sortOrder: true },
  });

  const kr = await prisma.keyResult.create({
    data: {
      orgId,
      ...parsed.data,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  return Response.json({ data: kr }, { status: 201 });
}
