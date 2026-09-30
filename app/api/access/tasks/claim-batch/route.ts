// app/api/access/tasks/claim-batch/route.ts
import { auth } from "@/lib/auth";
import { claimBatchSchema } from "@/lib/validations/access";
import { claimTasksBatch } from "@/lib/access/fulfilment-server";
import { readJson, unauthenticated, validationError } from "@/lib/access/fulfilment-http";

// Résultat par élément (FP:252) : la route répond 200 même si des éléments
// échouent — chaque échec porte son message et son code.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return unauthenticated();

  const parsed = claimBatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors);

  const data = await claimTasksBatch(session.user.orgId, session.user.id, parsed.data.items);
  return Response.json({ data });
}
