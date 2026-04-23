import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { bulkActionStatusSchema } from "@/lib/validations/actions";
import { getISOWeek } from "@/lib/date";

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = bulkActionStatusSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { updates } = parsed.data;
  const actionIds = updates.map((u) => u.actionId);

  // Verify all actions belong to the user's org
  const actions = await prisma.action.findMany({
    where: { id: { in: actionIds }, orgId: session.user.orgId },
    include: { keyResult: { select: { ownerId: true } } },
  });

  if (actions.length !== actionIds.length) {
    return Response.json({ error: "Some actions not found" }, { status: 404 });
  }

  // PO can only update actions on their own KRs
  if (session.user.role === "PO") {
    const unauthorized = actions.some((a) => a.keyResult.ownerId !== session.user.id);
    if (unauthorized) {
      return Response.json({ error: "Forbidden: not the owner of some KRs" }, { status: 403 });
    }
  }

  const { weekNumber } = getISOWeek(new Date());

  // Build a map for quick lookup
  const actionMap = new Map(actions.map((a) => [a.id, a]));

  await prisma.$transaction(
    updates.map((u) => {
      const existing = actionMap.get(u.actionId)!;
      const data: Record<string, unknown> = { status: u.status };

      // Set completedAt when transitioning to DONE
      if (u.status === "DONE" && existing.status !== "DONE") {
        data.completedAt = new Date();
        data.weekCompleted = weekNumber;
      }

      // Clear completedAt when transitioning away from DONE
      if (u.status !== "DONE" && existing.status === "DONE") {
        data.completedAt = null;
        data.weekCompleted = null;
      }

      return prisma.action.update({
        where: { id: u.actionId },
        data,
      });
    })
  );

  return Response.json({ success: true, updated: updates.length });
}
