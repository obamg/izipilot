import { getItem, setItem, deleteItem } from "./storage";

// API client for the IziPilot backend. Base URL priority:
//   EXPO_PUBLIC_API_URL (dev: http://<mac-lan-ip>:3005) → production.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") || "https://izipilote.com";

const ACCESS_KEY = "izipilot.accessToken";
const REFRESH_KEY = "izipilot.refreshToken";
const USER_KEY = "izipilot.user";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: "CEO" | "MANAGEMENT" | "PO" | "CONTRIBUTOR" | "VIEWER";
  orgId: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- token storage ----

export async function storeSession(tokens: {
  accessToken: string;
  refreshToken: string;
  user?: ApiUser;
}): Promise<void> {
  await setItem(ACCESS_KEY, tokens.accessToken);
  await setItem(REFRESH_KEY, tokens.refreshToken);
  if (tokens.user) await setItem(USER_KEY, JSON.stringify(tokens.user));
}

export async function loadStoredUser(): Promise<ApiUser | null> {
  const [token, raw] = await Promise.all([getItem(REFRESH_KEY), getItem(USER_KEY)]);
  if (!token || !raw) return null;
  try {
    return JSON.parse(raw) as ApiUser;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([deleteItem(ACCESS_KEY), deleteItem(REFRESH_KEY), deleteItem(USER_KEY)]);
}

// ---- refresh (single-flight so parallel 401s don't double-rotate) ----

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await getItem(REFRESH_KEY);
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/api/mobile/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        await setItem(ACCESS_KEY, data.accessToken);
        await setItem(REFRESH_KEY, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        // allow the next expiry to trigger a fresh single-flight
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

// ---- core fetch ----

async function request<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const accessToken = await getItem(ACCESS_KEY);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried) {
    const ok = await refreshTokens();
    if (ok) return request<T>(path, init, true);
    await clearSession();
    throw new ApiError(401, "Session expirée");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? `Erreur HTTP ${res.status}`,
      (body as { code?: string }).code,
    );
  }
  return body as T;
}

// ---- typed endpoints ----

export function login(email: string, password: string) {
  return request<{ challengeToken: string; expiresInSeconds: number }>(
    "/api/mobile/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
}

export function verifyOtp(challengeToken: string, code: string, deviceName?: string) {
  return request<{
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
    user: ApiUser;
  }>("/api/mobile/verify", {
    method: "POST",
    body: JSON.stringify({ challengeToken, code, deviceName }),
  });
}

export interface BootstrapEntity {
  code: string;
  name: string;
  color: string;
  scorePercent: number;
}

export interface BootstrapKr {
  id: string;
  title: string;
  target: number | null;
  targetUnit: string | null;
  currentValue: number;
  score: number;
  status: string;
  krType: "NUMERIC" | "PERCENTAGE" | "DATE" | "BINARY";
  objectiveTitle: string;
  entityCode: string;
  entityName: string;
  entityColor: string;
  existingProgress?: number;
  existingStatus?: string;
  existingBlocker?: string;
  existingProposedSolution?: string;
  existingActionNeeded?: string;
  existingComment?: string;
  isSubmitted: boolean;
  submittedByOther: string | null;
  actions: {
    id: string;
    title: string;
    status: string;
    priority: string;
    assigneeName: string;
    dueDate: string | null;
  }[];
}

export interface Bootstrap {
  user: ApiUser;
  week: { weekNumber: number; year: number; currentWeek: number; currentYear: number };
  products: BootstrapEntity[];
  departments: BootstrapEntity[];
  kpis: {
    globalScorePercent: number;
    totalKrs: number;
    onTrack: number;
    atRisk: number;
    blocked: number;
    notStarted: number;
    unresolvedAlertCount: number;
  };
  weekly: {
    krData: BootstrapKr[];
    orgUsers: { id: string; name: string }[];
    isReadOnly: boolean;
    isHistorical: boolean;
    deadline: string;
    entityNames: string[];
    submittedCount: number;
  };
}

export function getBootstrap(week?: number, year?: number) {
  const qs = week && year ? `?week=${week}&year=${year}` : "";
  return request<Bootstrap>(`/api/mobile/bootstrap${qs}`);
}

export interface Alert {
  id: string;
  type: string;
  severity: string;
  source: string;
  message: string;
  isResolved: boolean;
  createdAt: string;
  keyResult?: { id: string; title: string; score: number; status: string } | null;
}

export async function getAlerts(): Promise<Alert[]> {
  const res = await request<{ data: Alert[] }>("/api/alerts?isResolved=false");
  return res.data ?? [];
}

export interface WeeklyEntryInput {
  krId: string;
  weekNumber: number;
  year: number;
  progress: number; // 0..1
  status: string;
  blocker: string | null;
  proposedSolution: string | null;
  actionNeeded: string | null;
  comment: string | null;
}

export function submitWeeklyBatch(entries: WeeklyEntryInput[]) {
  return request<{ count: number }>("/api/weekly-entries/batch", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}
