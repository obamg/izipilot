import { requireCEO } from "@/lib/auth-guard";
import { setDepartmentHeadBackup, RoleAssignmentError } from "@/lib/access/roles-server";
import { z } from "zod";

const bodySchema = z.object({ backupUserId: z.string().min(1).nullable() });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ departmentId: string }> }
) {
  const session = await requireCEO();
  const { departmentId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    await setDepartmentHeadBackup(session.user.orgId, departmentId, parsed.data.backupUserId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RoleAssignmentError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
