import { auth } from "@/lib/auth";
import { decideBatch } from "@/lib/access/requests-server";
import { z } from "zod";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        stageId: z.string().min(1),
        decision: z.enum(["APPROVE", "REJECT", "CLARIFY", "RETURN"]),
        reason: z.string().min(1).max(2000).nullable(),
        escalateToCoo: z.boolean().optional(),
      })
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const results = await decideBatch(session.user.orgId, session.user.id, parsed.data.items);
  return Response.json({ data: results });
}
