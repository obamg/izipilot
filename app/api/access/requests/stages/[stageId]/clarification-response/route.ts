import { auth } from "@/lib/auth";
import { respondToClarification, RequestError } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({ response: z.string().min(1).max(2000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stageId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { stageId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const version = await respondToClarification(session.user.orgId, session.user.id, stageId, parsed.data.response);
    return Response.json({ data: version });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
