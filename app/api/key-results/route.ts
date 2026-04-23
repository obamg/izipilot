import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { scoreToPercent } from "@/lib/score";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const krId = searchParams.get("id");
  const objectiveId = searchParams.get("objectiveId");
  const ownerId = searchParams.get("ownerId");

  // Single KR detail
  if (krId) {
    const kr = await prisma.keyResult.findFirst({
      where: { id: krId, orgId: session.user.orgId },
      include: {
        owner: { select: { name: true } },
        objective: {
          include: {
            product: { select: { name: true, color: true } },
            department: { select: { name: true, color: true } },
          },
        },
        weeklyEntries: {
          orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
          take: 13,
          include: { submitter: { select: { name: true } } },
        },
      },
    });

    if (!kr) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const latestEntry = kr.weeklyEntries[0];
    const previousEntry = kr.weeklyEntries[1];

    return Response.json({
      data: {
        id: kr.id,
        title: kr.title,
        krType: kr.krType,
        target: kr.target,
        targetUnit: kr.targetUnit,
        targetDate: kr.targetDate,
        currentValue: kr.currentValue,
        scorePercent: scoreToPercent(kr.score),
        status: kr.status,
        ownerName: kr.owner.name,
        objectiveTitle: kr.objective.title,
        entityName:
          kr.objective.product?.name ??
          kr.objective.department?.name ??
          "—",
        entityColor:
          kr.objective.product?.color ??
          kr.objective.department?.color ??
          "#5f6e7a",
        delta: latestEntry && previousEntry
          ? Number(latestEntry.scoreAtEntry) - Number(previousEntry.scoreAtEntry)
          : 0,
        weeklyHistory: kr.weeklyEntries.map((e) => ({
          id: e.id,
          krId: e.krId,
          weekNumber: e.weekNumber,
          year: e.year,
          progress: e.progress,
          status: e.status,
          delta: e.delta,
          blocker: e.blocker,
          actionNeeded: e.actionNeeded,
          comment: e.comment,
          scoreAtEntry: scoreToPercent(e.scoreAtEntry),
          submittedAt: e.submittedAt.toISOString(),
          submitterName: e.submitter.name,
        })),
      },
    });
  }

  // List KRs
  const krs = await prisma.keyResult.findMany({
    where: {
      orgId: session.user.orgId,
      isActive: true,
      deletedAt: null,
      ...(objectiveId && { objectiveId }),
      ...(ownerId && { ownerId }),
    },
    include: { owner: { select: { name: true } } },
    orderBy: { sortOrder: "asc" },
  });

  return Response.json({
    data: krs.map((kr) => ({
      id: kr.id,
      title: kr.title,
      krType: kr.krType,
      target: kr.target,
      targetUnit: kr.targetUnit,
      currentValue: kr.currentValue,
      scorePercent: scoreToPercent(kr.score),
      status: kr.status,
      ownerName: kr.owner.name,
    })),
  });
}
