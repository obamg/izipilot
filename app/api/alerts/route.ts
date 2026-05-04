import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent } from "@/lib/score";

const alertTypeEnum = z.enum([
  "KR_BLOCKED", "KR_DECLINING", "ENTRY_MISSING", "ESCALATION_48H", "SCORE_BELOW_40",
]);
const alertSeverityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const getAlertsSchema = z.object({
  type: alertTypeEnum.optional(),
  severity: alertSeverityEnum.optional(),
  isResolved: z.enum(["true", "false"]).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const params = getAlertsSchema.safeParse({
    type: searchParams.get("type") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
    isResolved: searchParams.get("isResolved") ?? undefined,
  });

  if (!params.success) {
    return Response.json(
      { error: "Invalid query params", details: params.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { type, severity, isResolved } = params.data;
  const isOwnerScoped = session.user.role === "PO";

  const alerts = await prisma.alert.findMany({
    where: {
      orgId: session.user.orgId,
      ...(type && { type }),
      ...(severity && { severity }),
      ...(isResolved !== undefined && { isResolved: isResolved === "true" }),
      ...(isOwnerScoped && {
        keyResult: { ownerId: session.user.id },
      }),
    },
    include: {
      keyResult: {
        select: { id: true, title: true, score: true, status: true },
      },
      triggerer: { select: { id: true, name: true } },
      resolver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    data: alerts.map((a) => ({
      id: a.id,
      type: a.type,
      severity: a.severity,
      message: a.message,
      isResolved: a.isResolved,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      resolution: a.resolution,
      keyResult: {
        id: a.keyResult.id,
        title: a.keyResult.title,
        scorePercent: scoreToPercent(a.keyResult.score),
        status: a.keyResult.status,
      },
      triggeredBy: a.triggerer,
      resolvedBy: a.resolver,
    })),
  });
}

const resolveSchema = z.object({
  alertId: z.string(),
  resolution: z.string().min(1),
});

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only CEO and MANAGEMENT can resolve alerts
  if (session.user.role !== "CEO" && session.user.role !== "MANAGEMENT") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { alertId, resolution } = parsed.data;

  const alert = await prisma.alert.findFirst({
    where: { id: alertId, orgId: session.user.orgId },
  });

  if (!alert) {
    return Response.json({ error: "Alert not found" }, { status: 404 });
  }

  const updated = await prisma.alert.update({
    where: { id: alertId },
    data: {
      isResolved: true,
      resolvedBy: session.user.id,
      resolvedAt: new Date(),
      resolution,
    },
  });

  return Response.json({ data: { id: updated.id, isResolved: true } });
}
