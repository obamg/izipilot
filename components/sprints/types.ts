import type {
  ActionStatus,
  ActionPriority,
  SprintStatus,
  UserRole,
  RequestKind,
  RequestStatus,
  RecurrenceFrequency,
} from "@prisma/client";

// Open-request summary carried on a task (powers the board "en attente" chip).
export interface OpenRequestTag {
  id: string;
  kind: RequestKind;
  kindLabel: string;
  targetLabel: string;
}

// Client mirror of lib/sprint-serialize#serializeTaskRequest.
export interface TaskRequestItem {
  id: string;
  taskId: string;
  taskTitle: string;
  sprintId: string | null;
  kind: RequestKind;
  kindLabel: string;
  message: string;
  status: RequestStatus;
  targetType: "USER" | "DEPARTMENT" | "PRODUCT";
  targetId: string | null;
  targetLabel: string;
  requestedById: string;
  requestedByName: string;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface TeamTag {
  type: "PRODUCT" | "DEPARTMENT";
  id: string;
  code: string;
  name: string;
  color: string;
}

// Client mirror of lib/sprint-serialize#serializeTaskStep.
export interface TaskStepItem {
  id: string;
  title: string;
  done: boolean;
  createdById: string;
  sortOrder: number;
}

// Aggregate for the board chip (lib/sprint-step#stepProgress).
export interface StepProgress {
  done: number;
  total: number;
  percent: number;
}

// Client mirror of lib/sprint-serialize#serializeSprintTask output.
export interface SprintTaskItem {
  id: string;
  sprintId: string | null;
  // Set when this task was spawned from a recurring-task template.
  recurringTaskId: string | null;
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
  openRequests: OpenRequestTag[];
  steps: TaskStepItem[];
  stepProgress: StepProgress;
}

// Client mirror of lib/sprint-serialize#serializeRecurringTask.
export interface RecurringTaskItem {
  id: string;
  title: string;
  description: string | null;
  krId: string | null;
  krTitle: string | null;
  departmentId: string | null;
  productId: string | null;
  team: TeamTag | null;
  priority: ActionPriority;
  storyPoints: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdById: string;
  createdByName: string;
  frequency: RecurrenceFrequency;
  frequencyLabel: string;
  weekday: number | null;
  monthDay: number | null;
  cadenceLabel: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
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

export type AvailabilityState = "IDLE" | "NO_ONGOING" | "ACTIVE";

// Enriched availability row (lib/sprint#AvailabilityMember + user identity).
export interface AvailabilityMemberVM {
  userId: string;
  userName: string;
  role: UserRole;
  total: number;
  inProgress: number;
  todo: number;
  blocked: number;
  done: number;
  state: AvailabilityState;
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
