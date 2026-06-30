import type { ActionStatus, ActionPriority, SprintStatus } from "@prisma/client";

export interface TeamTag {
  type: "PRODUCT" | "DEPARTMENT";
  id: string;
  code: string;
  name: string;
  color: string;
}

// Client mirror of lib/sprint-serialize#serializeSprintTask output.
export interface SprintTaskItem {
  id: string;
  sprintId: string | null;
  sprintName: string | null;
  sprintNumber: number | null;
  krId: string | null;
  krTitle: string | null;
  title: string;
  description: string | null;
  reportUrl: string | null;
  status: ActionStatus;
  priority: ActionPriority;
  storyPoints: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdById: string;
  createdByName: string;
  departmentId: string | null;
  productId: string | null;
  team: TeamTag | null;
  sortOrder: number;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  commentCount: number;
}

export interface UserOption {
  id: string;
  name: string;
}

export interface TeamOption {
  id: string;
  code: string;
  name: string;
  color: string;
}

export interface KrOption {
  id: string;
  title: string;
  entityCode: string;
  entityName: string;
}

export interface SprintSummary {
  id: string;
  number: number;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string;
  endDate: string;
  completedAt: string | null;
  stats: {
    totalTasks: number;
    doneTasks: number;
    totalPoints: number;
    donePoints: number;
    percentComplete: number;
  };
}
