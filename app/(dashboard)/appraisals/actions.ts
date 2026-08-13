"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createAppraisalSchema,
  selfAssessmentSchema,
  managerAssessmentSchema,
  acknowledgeAppraisalSchema,
} from "@/lib/validations/appraisal";
import {
  evaluableSubjectIds,
  canEvaluate,
  monthlyRollupForQuarter,
} from "@/lib/appraisal-server";
import { overallScore, type AppraisalGoal } from "@/lib/appraisal";

function fail(error: string) {
  return { ok: false as const, error };
}

function revalidate(id?: string) {
  revalidatePath("/appraisals");
  revalidatePath("/my-appraisals");
  if (id) revalidatePath(`/appraisals/${id}`);
}

/** Manager crée le bilan d'un collègue pour un trimestre (idempotent). */
export async function createAppraisal(input: unknown) {
  const session = await auth();
  if (!session?.user) return fail("Non authentifié");
  const parsed = createAppraisalSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { subjectId, quarter, year } = parsed.data;
  const orgId = session.user.orgId;

  const allowed = await evaluableSubjectIds(orgId, {
    id: session.user.id,
    role: session.user.role,
  });
  if (!canEvaluate(allowed, subjectId, session.user.id)) return fail("Accès refusé");

  const subject = await prisma.user.findFirst({
    where: { id: subjectId, orgId, isActive: true },
    select: { id: true },
  });
  if (!subject) return fail("Collègue introuvable");

  const existing = await prisma.appraisal.findUnique({
    where: { subjectId_quarter_year: { subjectId, quarter, year } },
    select: { id: true },
  });
  if (existing) return { ok: true as const, data: { id: existing.id, existed: true } };

  const rollup = await monthlyRollupForQuarter(orgId, subjectId, quarter, year);
  const created = await prisma.appraisal.create({
    data: {
      orgId,
      subjectId,
      managerId: session.user.id,
      quarter,
      year,
      status: "SELF_ASSESSMENT",
      monthlyRollup: rollup as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  revalidate(created.id);
  return { ok: true as const, data: { id: created.id, existed: false } };
}

/** Le collègue enregistre / soumet son auto-évaluation. */
export async function saveSelfAssessment(input: unknown) {
  const session = await auth();
  if (!session?.user) return fail("Non authentifié");
  const parsed = selfAssessmentSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, competencies, goals, comment, submit } = parsed.data;

  const appraisal = await prisma.appraisal.findFirst({
    where: { id, orgId: session.user.orgId },
    select: { subjectId: true, status: true },
  });
  if (!appraisal) return fail("Bilan introuvable");
  if (appraisal.subjectId !== session.user.id) return fail("Accès refusé");
  if (appraisal.status !== "SELF_ASSESSMENT") return fail("L'auto-évaluation est verrouillée");

  await prisma.appraisal.update({
    where: { id },
    data: {
      selfCompetencies: competencies as Prisma.InputJsonValue,
      goals: goals as unknown as Prisma.InputJsonValue,
      selfComment: comment ?? null,
      ...(submit ? { status: "MANAGER_ASSESSMENT" as const, selfSubmittedAt: new Date() } : {}),
    },
  });
  revalidate(id);
  return { ok: true as const };
}

/** Le manager enregistre / finalise son évaluation. */
export async function saveManagerAssessment(input: unknown) {
  const session = await auth();
  if (!session?.user) return fail("Non authentifié");
  const parsed = managerAssessmentSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, competencies, goals, strengths, improvements, developmentPlan, comment, finalize } =
    parsed.data;
  const orgId = session.user.orgId;

  const appraisal = await prisma.appraisal.findFirst({
    where: { id, orgId },
    select: { subjectId: true, managerId: true, status: true, quarter: true, year: true },
  });
  if (!appraisal) return fail("Bilan introuvable");

  const allowed = await evaluableSubjectIds(orgId, {
    id: session.user.id,
    role: session.user.role,
  });
  const isManager =
    appraisal.managerId === session.user.id ||
    canEvaluate(allowed, appraisal.subjectId, session.user.id);
  if (!isManager) return fail("Accès refusé");
  if (appraisal.status !== "MANAGER_ASSESSMENT") {
    return fail(
      appraisal.status === "SELF_ASSESSMENT"
        ? "En attente de l'auto-évaluation du collègue"
        : "Le bilan est déjà finalisé"
    );
  }

  let extra: Prisma.AppraisalUpdateInput = {};
  if (finalize) {
    const rollup = await monthlyRollupForQuarter(
      orgId,
      appraisal.subjectId,
      appraisal.quarter,
      appraisal.year
    );
    const overall = overallScore({
      managerCompetencies: competencies,
      goals: goals as AppraisalGoal[],
      monthlyAvg: rollup.avgOverall,
    });
    extra = {
      status: "SHARED",
      managerSubmittedAt: new Date(),
      manager: { connect: { id: session.user.id } },
      monthlyRollup: rollup as unknown as Prisma.InputJsonValue,
      ...(overall != null ? { overall } : {}),
    };
  }

  await prisma.appraisal.update({
    where: { id },
    data: {
      managerCompetencies: competencies as Prisma.InputJsonValue,
      goals: goals as unknown as Prisma.InputJsonValue,
      strengths: strengths ?? null,
      improvements: improvements ?? null,
      developmentPlan: developmentPlan ?? null,
      managerComment: comment ?? null,
      ...extra,
    },
  });
  revalidate(id);
  return { ok: true as const };
}

/** Le collègue signe (accuse réception) le bilan partagé. */
export async function acknowledgeAppraisal(input: unknown) {
  const session = await auth();
  if (!session?.user) return fail("Non authentifié");
  const parsed = acknowledgeAppraisalSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, comment } = parsed.data;

  const appraisal = await prisma.appraisal.findFirst({
    where: { id, orgId: session.user.orgId },
    select: { subjectId: true, status: true },
  });
  if (!appraisal) return fail("Bilan introuvable");
  if (appraisal.subjectId !== session.user.id) return fail("Accès refusé");
  if (appraisal.status !== "SHARED") return fail("Rien à signer");

  await prisma.appraisal.update({
    where: { id },
    data: {
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      acknowledgeComment: comment ?? null,
    },
  });
  revalidate(id);
  return { ok: true as const };
}
