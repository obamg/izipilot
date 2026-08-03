import type { Prisma } from "@prisma/client";
import { describeTarget, REQUEST_KIND_LABELS } from "@/lib/sprint-request";
import { stepProgress } from "@/lib/sprint-step";
import { cadenceLabel, FREQUENCY_LABELS } from "@/lib/recurring-task";

// Shared select for a task step (checklist item) so the embedded list on a
// task and the step routes emit the same shape.
export const sprintTaskStepSelect = {
  id: true,
  title: true,
  done: true,
  createdById: true,
  sortOrder: true,
} satisfies Prisma.SprintTaskStepSelect;

// Shared include + serializer for SprintTask so API routes and pages emit the
// exact same client-facing shape.
export const sprintTaskInclude = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  department: { select: { id: true, code: true, name: true, color: true } },
  product: { select: { id: true, code: true, name: true, color: true } },
  keyResult: { select: { id: true, title: true } },
  sprint: { select: { id: true, number: true, name: true, status: true } },
  // Open requests power the "en attente" chip on the board card.
  requests: {
    where: { status: "OPEN" as const },
    select: {
      id: true,
      kind: true,
      targetUser: { select: { name: true } },
      targetDepartment: { select: { code: true, name: true } },
      targetProduct: { select: { code: true, name: true } },
    },
  },
  // Sub-tasks (étapes) — full list: powers the modal section and the board
  // progress chip (done/total).
  steps: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    select: sprintTaskStepSelect,
  },
  _count: { select: { comments: true } },
} satisfies Prisma.SprintTaskInclude;

export type SprintTaskWithRelations = Prisma.SprintTaskGetPayload<{
  include: typeof sprintTaskInclude;
}>;

export type TeamTag = {
  type: "PRODUCT" | "DEPARTMENT";
  id: string;
  code: string;
  name: string;
  color: string;
};

export function serializeSprintTask(t: SprintTaskWithRelations) {
  const team: TeamTag | null = t.product
    ? {
        type: "PRODUCT",
        id: t.product.id,
        code: t.product.code,
        name: t.product.name,
        color: t.product.color,
      }
    : t.department
    ? {
        type: "DEPARTMENT",
        id: t.department.id,
        code: t.department.code,
        name: t.department.name,
        color: t.department.color,
      }
    : null;

  return {
    id: t.id,
    sprintId: t.sprintId,
    sprintName: t.sprint?.name ?? null,
    sprintNumber: t.sprint?.number ?? null,
    krId: t.krId,
    krTitle: t.keyResult?.title ?? null,
    title: t.title,
    description: t.description,
    reportUrl: t.reportUrl,
    status: t.status,
    priority: t.priority,
    storyPoints: t.storyPoints,
    assigneeId: t.assignee?.id ?? null,
    assigneeName: t.assignee?.name ?? null,
    createdById: t.createdById,
    createdByName: t.createdBy.name,
    departmentId: t.departmentId,
    productId: t.productId,
    team,
    sortOrder: t.sortOrder,
    dueDate: t.dueDate?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    commentCount: t._count.comments,
    openRequests: t.requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      kindLabel: REQUEST_KIND_LABELS[r.kind],
      targetLabel: describeTarget(r),
    })),
    steps: t.steps.map(serializeTaskStep),
    stepProgress: stepProgress(t.steps),
  };
}

export type SerializedSprintTask = ReturnType<typeof serializeSprintTask>;

// ── Task step (Étape) ───────────────────────────────────────────────────────
type StepPayload = Prisma.SprintTaskStepGetPayload<{
  select: typeof sprintTaskStepSelect;
}>;

export function serializeTaskStep(s: StepPayload) {
  return {
    id: s.id,
    title: s.title,
    done: s.done,
    createdById: s.createdById,
    sortOrder: s.sortOrder,
  };
}

export type SerializedTaskStep = ReturnType<typeof serializeTaskStep>;

// ── Task request (Demande) ──────────────────────────────────────────────────
export const sprintTaskRequestInclude = {
  requestedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  targetUser: { select: { id: true, name: true } },
  targetDepartment: { select: { id: true, code: true, name: true } },
  targetProduct: { select: { id: true, code: true, name: true } },
  task: { select: { id: true, title: true, sprintId: true } },
} satisfies Prisma.SprintTaskRequestInclude;

export type SprintTaskRequestWithRelations = Prisma.SprintTaskRequestGetPayload<{
  include: typeof sprintTaskRequestInclude;
}>;

export function serializeTaskRequest(r: SprintTaskRequestWithRelations) {
  const targetType = r.targetUserId
    ? ("USER" as const)
    : r.targetDepartmentId
    ? ("DEPARTMENT" as const)
    : ("PRODUCT" as const);
  return {
    id: r.id,
    taskId: r.taskId,
    taskTitle: r.task.title,
    sprintId: r.task.sprintId,
    kind: r.kind,
    kindLabel: REQUEST_KIND_LABELS[r.kind],
    message: r.message,
    status: r.status,
    targetType,
    targetId: r.targetUserId ?? r.targetDepartmentId ?? r.targetProductId ?? null,
    targetLabel: describeTarget(r),
    requestedById: r.requestedById,
    requestedByName: r.requestedBy.name,
    resolvedById: r.resolvedById,
    resolvedByName: r.resolvedBy?.name ?? null,
    resolutionNote: r.resolutionNote,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export type SerializedTaskRequest = ReturnType<typeof serializeTaskRequest>;

// ── Recurring task (Tâche récurrente) ───────────────────────────────────────
export const recurringTaskInclude = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  department: { select: { id: true, code: true, name: true, color: true } },
  product: { select: { id: true, code: true, name: true, color: true } },
  keyResult: { select: { id: true, title: true } },
} satisfies Prisma.RecurringTaskInclude;

export type RecurringTaskWithRelations = Prisma.RecurringTaskGetPayload<{
  include: typeof recurringTaskInclude;
}>;

export function serializeRecurringTask(r: RecurringTaskWithRelations) {
  const team: TeamTag | null = r.product
    ? {
        type: "PRODUCT",
        id: r.product.id,
        code: r.product.code,
        name: r.product.name,
        color: r.product.color,
      }
    : r.department
    ? {
        type: "DEPARTMENT",
        id: r.department.id,
        code: r.department.code,
        name: r.department.name,
        color: r.department.color,
      }
    : null;

  return {
    id: r.id,
    title: r.title,
    description: r.description,
    krId: r.krId,
    krTitle: r.keyResult?.title ?? null,
    departmentId: r.departmentId,
    productId: r.productId,
    team,
    priority: r.priority,
    storyPoints: r.storyPoints,
    assigneeId: r.assignee?.id ?? null,
    assigneeName: r.assignee?.name ?? null,
    createdById: r.createdById,
    createdByName: r.createdBy.name,
    frequency: r.frequency,
    frequencyLabel: FREQUENCY_LABELS[r.frequency],
    weekday: r.weekday,
    monthDay: r.monthDay,
    cadenceLabel: cadenceLabel(r),
    isActive: r.isActive,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export type SerializedRecurringTask = ReturnType<typeof serializeRecurringTask>;
