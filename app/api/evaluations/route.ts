import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/api-auth";
import { evaluationInputSchema } from "@/lib/validations/evaluation";
import {
  evaluableSubjectIds,
  canEvaluate,
  monthDeliveryByUser,
} from "@/lib/evaluation-server";
import { deliveryScoreFromRatio, overallScore } from "@/lib/evaluation";

// POST — create or update this evaluator's monthly evaluation of a colleague.
// The delivery component is (re)computed server-side and frozen into the row,
// so the score can't be forged by the client.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = evaluationInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const orgId = session.user.orgId;
  const evaluatorId = session.user.id;

  // Permission: may this evaluator rate this subject?
  const allowed = await evaluableSubjectIds(orgId, {
    id: evaluatorId,
    role: session.user.role,
  });
  if (!canEvaluate(allowed, d.subjectId, evaluatorId)) {
    return Response.json(
      { error: "Vous n'êtes pas autorisé à évaluer cette personne." },
      { status: 403 }
    );
  }

  // Subject must be a real, active member of the same org.
  const subject = await prisma.user.findFirst({
    where: { id: d.subjectId, orgId, isActive: true },
    select: { id: true },
  });
  if (!subject) {
    return Response.json({ error: "Collègue introuvable." }, { status: 404 });
  }

  // (Re)compute the delivery component from the month's sprint work.
  const deliveryMap = await monthDeliveryByUser(orgId, d.periodYear, d.periodMonth, [
    d.subjectId,
  ]);
  const stats = deliveryMap.get(d.subjectId) ?? null;
  const deliveryScore = deliveryScoreFromRatio(stats?.ratio ?? null);
  const manual = {
    quality: d.scoreQuality,
    collaboration: d.scoreCollaboration,
    initiative: d.scoreInitiative,
  };
  const overall = overallScore(deliveryScore, manual);

  const data = {
    scoreQuality: d.scoreQuality,
    scoreCollaboration: d.scoreCollaboration,
    scoreInitiative: d.scoreInitiative,
    deliveryScore,
    overall,
    comment: d.comment?.trim() ? d.comment.trim() : null,
    statsSnapshot: stats
      ? {
          deliveredPoints: stats.deliveredPoints,
          committedPoints: stats.committedPoints,
          assignedPoints: stats.assignedPoints,
          ratio: stats.ratio,
          tasksDone: stats.tasksDone,
          tasksTotal: stats.tasksTotal,
          onTimeRate: stats.onTimeRate,
        }
      : undefined,
  };

  const saved = await prisma.evaluation.upsert({
    where: {
      subjectId_evaluatorId_periodMonth_periodYear: {
        subjectId: d.subjectId,
        evaluatorId,
        periodMonth: d.periodMonth,
        periodYear: d.periodYear,
      },
    },
    create: {
      orgId,
      subjectId: d.subjectId,
      evaluatorId,
      periodMonth: d.periodMonth,
      periodYear: d.periodYear,
      ...data,
    },
    update: data,
  });

  return Response.json({
    data: {
      id: saved.id,
      subjectId: saved.subjectId,
      periodMonth: saved.periodMonth,
      periodYear: saved.periodYear,
      scoreQuality: saved.scoreQuality,
      scoreCollaboration: saved.scoreCollaboration,
      scoreInitiative: saved.scoreInitiative,
      deliveryScore: saved.deliveryScore != null ? Number(saved.deliveryScore) : null,
      overall: Number(saved.overall),
      comment: saved.comment,
      updatedAt: saved.updatedAt.toISOString(),
    },
  });
}
