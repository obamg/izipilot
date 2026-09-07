import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { planSprintClose } from "@/lib/sprint-close";

// GET /api/sprints/[sprintId]/close-preview
// Ce que la clôture ferait, sans rien changer. Alimente la confirmation.
// Même garde que le PATCH qui clôture : inutile d'exposer le plan à qui ne peut
// pas l'exécuter.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sprintId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "CEO" && session.user.role !== "MANAGEMENT") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sprintId } = await params;
  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, orgId: session.user.orgId },
    select: { id: true, number: true },
  });
  if (!sprint) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }

  return Response.json({ plan: await planSprintClose(session.user.orgId, sprint) });
}
