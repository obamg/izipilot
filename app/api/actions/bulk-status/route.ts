import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { bulkActionStatusSchema } from "@/lib/validations/actions";
import { getISOWeek } from "@/lib/date";
import { actionVisibilityWhere } from "@/lib/visibility";
import { resolveActionColumn } from "@/lib/board-column-server";

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

  // Verify all actions belong to the user's org AND are visible to them.
  // A PO/VIEWER passing D7 action IDs in the payload would otherwise bypass
  // the UI hide.
  const actions = await prisma.action.findMany({
    where: {
      id: { in: actionIds },
      orgId: session.user.orgId,
      ...actionVisibilityWhere(session.user.role),
    },
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

  // CONTRIBUTOR can only update actions assigned to them
  if (session.user.role === "CONTRIBUTOR") {
    const unauthorized = actions.some((a) => a.assigneeId !== session.user.id);
    if (unauthorized) {
      return Response.json({ error: "Forbidden: you can only update actions assigned to you" }, { status: 403 });
    }
  }

  const { weekNumber } = getISOWeek(new Date());

  // Build a map for quick lookup
  const actionMap = new Map(actions.map((a) => [a.id, a]));

  // Colonne cible de chaque action dans le flux de SON équipe. Résolu avant la
  // transaction (ce sont des lectures) pour ne pas allonger le verrou. Sans ce
  // recalcul, le statut changerait mais la carte resterait dans son ancienne
  // colonne sur le tableau.
  const columnByAction = new Map<string, string | null>();
  for (const u of updates) {
    const existing = actionMap.get(u.actionId)!;
    columnByAction.set(
      u.actionId,
      await resolveActionColumn(session.user.orgId, existing.krId, u.status)
    );
  }

  await prisma.$transaction(
    updates.map((u) => {
      const existing = actionMap.get(u.actionId)!;
      const data: Record<string, unknown> = {
        status: u.status,
        columnId: columnByAction.get(u.actionId) ?? null,
      };

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
