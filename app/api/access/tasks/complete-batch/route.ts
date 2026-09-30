// app/api/access/tasks/complete-batch/route.ts
import { auth } from "@/lib/auth";
import { completeBatchSchema } from "@/lib/validations/access";
import { completeTasksBatch } from "@/lib/access/fulfilment-server";
import { readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

// Résultat par élément (FP:252, FP:254) : chaque élément porte sa propre
// preuve ; la route répond 200 même si des éléments échouent.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthenticated();

  const parsed = completeBatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const data = await completeTasksBatch(session.user.orgId, session.user.id, parsed.data.items);
  return Response.json({ data });
}
