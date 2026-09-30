// app/api/access/tasks/route.ts
// Lecture des tâches d'exécution (phase 3b). La portée est recalculée en base
// par listFulfilmentTasks ; hors portée → 404, jamais 403.
import { auth } from "@/lib/auth";
import { taskListQuerySchema } from "@/lib/validations/access";
import { listFulfilmentTasks } from "@/lib/access/fulfilment-read-server";
import { fulfilmentErrorResponse, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthenticated();

  const url = new URL(request.url);
  const parsed = taskListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const { page, pageSize } = parsed.data;
  try {
    const result = await listFulfilmentTasks({ orgId: session.user.orgId, userId: session.user.id }, parsed.data);
    return Response.json({ data: result.rows, total: result.total, page, pageSize });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
