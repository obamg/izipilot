import { auth } from "@/lib/auth";
import { reviseRequest, RequestError } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({
  targetLevelId: z.string().min(1).nullable().optional(),
  justification: z.string().min(1).max(2000).optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { versionId } = await params;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const version = await reviseRequest(session.user.orgId, session.user.id, versionId, {
      targetLevelId: parsed.data.targetLevelId,
      justification: parsed.data.justification,
      periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
      periodEnd: parsed.data.periodEnd !== undefined ? (parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null) : undefined,
    });
    return Response.json({ data: version });
  } catch (err) {
    if (err instanceof RequestError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
