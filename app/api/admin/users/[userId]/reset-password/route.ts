import { prisma } from "@/lib/prisma";
import { requireCEO } from "@/lib/auth-guard";
import { resetPasswordSchema } from "@/lib/validations/admin";
import bcrypt from "bcryptjs";

interface Params {
  params: Promise<{ userId: string }>;
}

export async function POST(request: Request, { params }: Params) {
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
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  return Response.json({ data: { success: true } });
}
