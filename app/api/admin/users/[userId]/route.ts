import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { updateUserSchema } from "@/lib/validations/admin";

interface Params {
  params: Promise<{ userId: string }>;
}

export async function PUT(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { userId } = await params;

  const user = await prisma.user.findFirst({
    where: { id: userId, orgId },
  });
  if (!user) {
    return Response.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: parsed.data,
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return Response.json({ data: updated });
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { userId } = await params;

  const user = await prisma.user.findFirst({
    where: { id: userId, orgId },
  });
  if (!user) {
    return Response.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Prevent self-deactivation
  if (userId === session.user.id) {
    return Response.json(
      { error: "Vous ne pouvez pas vous d\u00e9sactiver vous-m\u00eame" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  });

  return Response.json({ data: { id: userId, isActive: false } });
}
