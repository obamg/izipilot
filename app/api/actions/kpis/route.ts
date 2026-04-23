import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import type { ActionKpiResponse } from "@/types/api";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const assigneeId = searchParams.get("assigneeId");

  const grouped = await prisma.action.groupBy({
    by: ["status"],
    where: {
      orgId: session.user.orgId,
      ...(assigneeId && { assigneeId }),
    },
    _count: true,
  });

  const kpis: ActionKpiResponse = {
    todo: 0,
    inProgress: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
    total: 0,
  };

  for (const g of grouped) {
    const count = g._count;
    switch (g.status) {
      case "TODO":
        kpis.todo = count;
        break;
      case "IN_PROGRESS":
        kpis.inProgress = count;
        break;
      case "BLOCKED":
        kpis.blocked = count;
        break;
      case "DONE":
        kpis.done = count;
        break;
      case "CANCELLED":
        kpis.cancelled = count;
        break;
    }
    kpis.total += count;
  }

  return Response.json({ data: kpis });
}
