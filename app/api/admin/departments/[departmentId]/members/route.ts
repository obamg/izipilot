import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { z } from "zod";

interface Params {
  params: Promise<{ departmentId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { departmentId } = await params;

  const dept = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
  });
  if (!dept) {
    return Response.json({ error: "Departement introuvable" }, { status: 404 });
  }

  const members = await prisma.departmentMember.findMany({
    where: { departmentId },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { joinedAt: "asc" },
  });

  return Response.json({
    data: members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      userRole: m.user.role,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
  });
}

const addMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(["MEMBER", "LEAD"]).default("MEMBER"),
});

export async function POST(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { departmentId } = await params;

  const dept = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
  });
  if (!dept) {
    return Response.json({ error: "Departement introuvable" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  // Verify user belongs to the same org
  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, orgId, isActive: true },
  });
  if (!user) {
    return Response.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Check if already a member
  const existing = await prisma.departmentMember.findUnique({
    where: { departmentId_userId: { departmentId, userId: parsed.data.userId } },
  });
  if (existing) {
    return Response.json({ error: "Cet utilisateur est deja membre" }, { status: 409 });
  }

  const member = await prisma.departmentMember.create({
    data: {
      departmentId,
      userId: parsed.data.userId,
      role: parsed.data.role,
    },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });

  return Response.json(
    {
      data: {
        id: member.id,
        userId: member.user.id,
        name: member.user.name,
        email: member.user.email,
        userRole: member.user.role,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      },
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const session = await requireCEO();
  const orgId = session.user.orgId;
  const { departmentId } = await params;

  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");
  if (!memberId) {
    return Response.json({ error: "memberId requis" }, { status: 400 });
  }

  const member = await prisma.departmentMember.findFirst({
    where: { id: memberId, departmentId, department: { orgId } },
  });
  if (!member) {
    return Response.json({ error: "Membre introuvable" }, { status: 404 });
  }

  await prisma.departmentMember.delete({ where: { id: memberId } });

  return Response.json({ success: true });
}
