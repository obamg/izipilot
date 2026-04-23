import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { createUserSchema } from "@/lib/validations/admin";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const users = await prisma.user.findMany({
    where: { orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return Response.json({ data: users });
}

export async function POST(request: Request) {
  const session = await requireCEO();
  const orgId = session.user.orgId;

  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { email, name, role, password } = parsed.data;

  // Check email uniqueness
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { error: "Un utilisateur avec cet email existe d\u00e9j\u00e0" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { orgId, email, name, role, passwordHash },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return Response.json({ data: user }, { status: 201 });
}
