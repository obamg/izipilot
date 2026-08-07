import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { resolveTaskRequestSchema } from "@/lib/validations/sprints";
import {
  sprintTaskRequestInclude,
  serializeTaskRequest,
} from "@/lib/sprint-serialize";
import { loadViewerTeams } from "@/lib/sprint-request-server";
import { canResolveRequest, canCancelRequest } from "@/lib/sprint-request";

// PATCH — target résout/refuse, or requester annule.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "VIEWER") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { requestId } = await params;

  const existing = await prisma.sprintTaskRequest.findFirst({
    where: { id: requestId, orgId: session.user.orgId },
    select: {
      id: true,
      status: true,
      requestedById: true,
      targetUserId: true,
      targetDepartmentId: true,
      targetProductId: true,
    },
  });
  if (!existing) {
    return Response.json({ error: "Request not found" }, { status: 404 });
  }

  const parsed = resolveTaskRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { status, resolutionNote } = parsed.data;

  // Cancel → requester only; resolve/decline → target or privileged.
  if (status === "CANCELLED") {
    if (!canCancelRequest(existing, { userId: session.user.id })) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    const viewer = await loadViewerTeams(
      session.user.orgId,
      session.user.id,
      session.user.role
    );
    if (!canResolveRequest(existing, viewer)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const updated = await prisma.sprintTaskRequest.update({
    where: { id: requestId },
    data: {
      status,
      resolvedById: session.user.id,
      resolvedAt: new Date(),
      resolutionNote: resolutionNote ?? null,
    },
    include: sprintTaskRequestInclude,
  });

  return Response.json({ data: serializeTaskRequest(updated) });
}
