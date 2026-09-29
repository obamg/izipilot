// app/api/access/assignments/route.ts
// Lecture du registre (phase 2b). Aucun rôle requis pour « Mes accès » ; les
// autres vues sont autorisées par listAssignments à partir des portées
// recalculées en base. Hors portée → 404, jamais 403 (spec §6).
import { auth } from "@/lib/auth";
import { registerQuerySchema } from "@/lib/validations/access";
import { registerRequestFromQuery } from "@/lib/access/register";
import { listAssignments, RegisterNotFoundError } from "@/lib/access/register-server";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = registerQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const req = registerRequestFromQuery(parsed.data);
  if (!req) {
    return Response.json(
      { error: "Validation error", details: { departmentId: ["Requis pour la vue département"] } },
      { status: 400 }
    );
  }

  const { page, pageSize } = parsed.data;
  try {
    const result = await listAssignments({
      viewer: { userId: session.user.id, orgId: session.user.orgId },
      view: req.view,
      filters: req.filters,
      pagination: { page, pageSize },
    });
    return Response.json({ data: result.rows, total: result.total, page, pageSize });
  } catch (err) {
    if (err instanceof RegisterNotFoundError) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
