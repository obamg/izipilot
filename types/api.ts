/**
 * API Contracts — IziPilot
 *
 * Shared request/response types for all API routes.
 * Agents 2 & 3 must use these types to stay aligned.
 * Zod schemas will be derived from these interfaces.
 */

import type { KrStatus, KrType, AlertType, AlertSeverity, DecisionStatus, ActionStatus, ActionPriority } from "@prisma/client";

// ============================================================================
// Common
// ============================================================================

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// GET /api/objectives
// ============================================================================

export interface ObjectiveListParams {
  orgId: string;
  entityType?: "DEPARTMENT" | "PRODUCT";
  departmentId?: string;
  productId?: string;
  quarter?: "Q1" | "Q2" | "Q3" | "Q4";
  year?: number;
}

export interface ObjectiveResponse {
  id: string;
  title: string;
  why: string | null;
  entityType: "DEPARTMENT" | "PRODUCT";
  departmentId: string | null;
  productId: string | null;
  quarter: string;
  year: number;
  keyResults: KeyResultSummary[];
  /** Average score across all KRs (0–100) */
  scorePercent: number;
}

export interface KeyResultSummary {
  id: string;
  title: string;
  krType: KrType;
  target: number | null;
  targetUnit: string | null;
  currentValue: number;
  /** 0–100, always rounded */
  scorePercent: number;
  status: KrStatus;
  ownerName: string;
}

// ============================================================================
// GET/PUT /api/key-results
// ============================================================================

export interface KeyResultDetailResponse extends KeyResultSummary {
  objectiveTitle: string;
  entityName: string; // Product or Department name
  entityColor: string;
  targetDate: string | null;
  delta: number; // vs previous week
  weeklyHistory: WeeklyEntryResponse[];
}

// ============================================================================
// GET/POST /api/weekly-entries
// ============================================================================

export interface WeeklyEntryCreateRequest {
  krId: string;
  weekNumber: number;
  year: number;
  progress: number; // 0.0 to 1.0
  status: KrStatus;
  blocker?: string | null;
  actionNeeded?: string | null;
  comment?: string | null;
}

export interface WeeklyEntryResponse {
  id: string;
  krId: string;
  weekNumber: number;
  year: number;
  progress: number;
  status: KrStatus;
  delta: number;
  blocker: string | null;
  actionNeeded: string | null;
  comment: string | null;
  /** 0–100, always rounded */
  scoreAtEntry: number;
  submittedAt: string; // ISO date
  submitterName: string;
}

export interface WeeklyEntryListParams {
  orgId: string;
  weekNumber: number;
  year: number;
  /** Filter by specific KR */
  krId?: string;
  /** Filter by PO */
  submittedBy?: string;
}

// ============================================================================
// GET /api/alerts
// ============================================================================

export interface AlertListParams {
  orgId: string;
  type?: AlertType;
  severity?: AlertSeverity;
  isResolved?: boolean;
}

export interface AlertResponse {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  isResolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  keyResult: {
    id: string;
    title: string;
    scorePercent: number;
    status: KrStatus;
  };
  triggeredBy: {
    id: string;
    name: string;
  };
}

export interface AlertResolveRequest {
  resolution: string;
}

// ============================================================================
// POST /api/alerts/:id/decisions
// ============================================================================

export interface DecisionCreateRequest {
  title: string;
  description?: string | null;
  ownerId: string;
  dueDate?: string | null; // ISO date
}

export interface DecisionResponse {
  id: string;
  title: string;
  description: string | null;
  status: DecisionStatus;
  ownerName: string;
  dueDate: string | null;
  outcome: string | null;
  createdAt: string;
}

// ============================================================================
// GET/POST /api/actions
// ============================================================================

export interface ActionCreateRequest {
  krId: string;
  title: string;
  description?: string | null;
  assigneeId: string;
  priority?: ActionPriority;
  dueDate?: string | null;
}

export interface ActionResponse {
  id: string;
  krId: string;
  krTitle: string;
  title: string;
  description: string | null;
  assigneeId: string;
  assigneeName: string;
  createdById: string;
  createdByName: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
  completedAt: string | null;
  weekCreated: number;
  weekCompleted: number | null;
  createdAt: string;
  commentCount: number;
}

export interface ActionCommentResponse {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface ActionKpiResponse {
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  cancelled: number;
  total: number;
}

// ============================================================================
// GET /api/dashboard (aggregated)
// ============================================================================

export interface DashboardResponse {
  /** Total KRs by status */
  statusBreakdown: {
    onTrack: number;
    atRisk: number;
    blocked: number;
    notStarted: number;
  };
  /** Average score across all active KRs (0–100) */
  overallScorePercent: number;
  /** Delta vs previous week */
  overallDelta: number;
  /** Unresolved alerts count by severity */
  alertCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  /** Current week info */
  currentWeek: {
    weekNumber: number;
    year: number;
    submittedCount: number;
    totalExpected: number;
    deadlinePassed: boolean;
  };
  /** Action KPIs */
  actionKpis?: ActionKpiResponse;
}
