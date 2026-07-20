import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sprintTaskVisibilityWhere } from "@/lib/visibility";
import {
  sprintTaskRequestInclude,
  serializeTaskRequest,
} from "@/lib/sprint-serialize";
import { loadViewerTeams } from "@/lib/sprint-request-server";

// GET — the viewer's inbox: { received, sent }.
// received = OPEN requests aimed at them (as person or via their team), not
// their own. sent = requests they raised (any status).
export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = session.user.orgId;
  const role = session.user.role;
  const viewer = await loadViewerTeams(orgId, session.user.id, role);
  const taskVisible = sprintTaskVisibilityWhere(role);

  const [received, sent] = await Promise.all([
    prisma.sprintTaskRequest.findMany({
      where: {
        orgId,
        status: "OPEN",
        requestedById: { not: session.user.id },
        task: taskVisible,
        OR: [
          { targetUserId: session.user.id },
          { targetDepartmentId: { in: viewer.departmentIds } },
          { targetProductId: { in: viewer.productIds } },
        ],
      },
      include: sprintTaskRequestInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.sprintTaskRequest.findMany({
      where: { orgId, requestedById: session.user.id, task: taskVisible },
      include: sprintTaskRequestInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return Response.json({
    received: received.map(serializeTaskRequest),
    sent: sent.map(serializeTaskRequest),
  });
}
