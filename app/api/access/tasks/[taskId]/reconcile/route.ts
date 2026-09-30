// app/api/access/tasks/[taskId]/reconcile/route.ts
import { auth } from "@/lib/auth";
import { reconcileTaskSchema } from "@/lib/validations/access";
import { reconcileTask } from "@/lib/access/fulfilment-server";
import { fulfilmentErrorResponse, readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth();
  if (!session?.user) return unauthenticated();
  const { taskId } = await params;

  const parsed = reconcileTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  try {
    const data = await reconcileTask(session.user.orgId, session.user.id, taskId, parsed.data);
    return Response.json({ data });
  } catch (err) {
    return fulfilmentErrorResponse(err);
  }
}
