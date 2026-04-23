import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { updateOrgSchema } from "@/lib/validations/admin";

export async function GET() {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: {
        select: {
          users: { where: { isActive: true } },
          departments: { where: { isActive: true } },
          products: { where: { isActive: true } },
          objectives: { where: { isActive: true } },
          keyResults: { where: { isActive: true } },
        },
      },
    },
  });

  if (!org) {
    return Response.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  return Response.json({
    data: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      plan: org.plan,
      isActive: org.isActive,
      createdAt: org.createdAt,
      counts: org._count,
    },
  });
}

export async function PUT(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = updateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updated = await prisma.organization.update({
    where: { id: orgId },
    data: parsed.data,
  });

  return Response.json({ data: updated });
}
