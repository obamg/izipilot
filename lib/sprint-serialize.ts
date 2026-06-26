import type { Prisma } from "@prisma/client";

// Shared include + serializer for SprintTask so API routes and pages emit the
// exact same client-facing shape.
export const sprintTaskInclude = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  department: { select: { id: true, code: true, name: true, color: true } },
  product: { select: { id: true, code: true, name: true, color: true } },
  keyResult: { select: { id: true, title: true } },
  sprint: { select: { id: true, number: true, name: true, status: true } },
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
  };
}

export type SerializedSprintTask = ReturnType<typeof serializeSprintTask>;
