import type { Appraisal, AppraisalStatus, Quarter, User } from "@prisma/client";
import type { AppraisalGoal, CompetencyScores, MonthlyRollup } from "./appraisal";

export interface SerializedAppraisal {
  id: string;
  quarter: Quarter;
  year: number;
  status: AppraisalStatus;
  subject: { id: string; name: string };
  manager: { id: string; name: string };
  selfCompetencies: CompetencyScores;
  managerCompetencies: CompetencyScores;
  goals: AppraisalGoal[];
  selfComment: string | null;
  managerComment: string | null;
  strengths: string | null;
  improvements: string | null;
  developmentPlan: string | null;
  acknowledgeComment: string | null;
  selfSubmittedAt: string | null;
  managerSubmittedAt: string | null;
  acknowledgedAt: string | null;
  monthlyRollup: MonthlyRollup | null;
  overall: number | null;
}

type AppraisalWithPeople = Appraisal & {
  subject: Pick<User, "id" | "name">;
  manager: Pick<User, "id" | "name">;
};

export function serializeAppraisal(a: AppraisalWithPeople): SerializedAppraisal {
  return {
    id: a.id,
    quarter: a.quarter,
    year: a.year,
    status: a.status,
    subject: { id: a.subject.id, name: a.subject.name },
    manager: { id: a.manager.id, name: a.manager.name },
    selfCompetencies: (a.selfCompetencies as CompetencyScores | null) ?? {},
    managerCompetencies: (a.managerCompetencies as CompetencyScores | null) ?? {},
    goals: (a.goals as AppraisalGoal[] | null) ?? [],
    selfComment: a.selfComment,
    managerComment: a.managerComment,
    strengths: a.strengths,
    improvements: a.improvements,
    developmentPlan: a.developmentPlan,
    acknowledgeComment: a.acknowledgeComment,
    selfSubmittedAt: a.selfSubmittedAt?.toISOString() ?? null,
    managerSubmittedAt: a.managerSubmittedAt?.toISOString() ?? null,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    monthlyRollup: (a.monthlyRollup as MonthlyRollup | null) ?? null,
    overall: a.overall == null ? null : Number(a.overall),
  };
}

export const APPRAISAL_STATUS_META: Record<
  AppraisalStatus,
  { label: string; color: string; bg: string }
> = {
  SELF_ASSESSMENT: { label: "Auto-évaluation", color: "var(--gray)", bg: "var(--gray-lt)" },
  MANAGER_ASSESSMENT: { label: "Éval. manager", color: "var(--gold)", bg: "var(--gold-lt)" },
  SHARED: { label: "Partagé", color: "var(--teal)", bg: "var(--teal-lt)" },
  ACKNOWLEDGED: { label: "Signé", color: "var(--green)", bg: "var(--green-lt)" },
};
