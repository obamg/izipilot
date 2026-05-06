// Gleap REST API client with in-memory caching.
// Auth: JWT service-account token + `project` header. Base: https://api.gleap.io/v3

const BASE_URL = "https://api.gleap.io/v3";
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 90 * 1000;
const TICKET_FETCH_LIMIT = 1000;

export type GleapProjectKey = "TRADING" | "AFRICAPART" | "SHARED";

interface GleapCredentials {
  apiKey: string;
  projectId: string;
}

function getCredentials(key: GleapProjectKey): GleapCredentials | null {
  const map: Record<GleapProjectKey, [string | undefined, string | undefined]> = {
    TRADING: [
      process.env.GLEAP_API_KEY_TRADING,
      process.env.GLEAP_PROJECT_ID_TRADING,
    ],
    AFRICAPART: [
      process.env.GLEAP_API_KEY_AFRICAPART,
      process.env.GLEAP_PROJECT_ID_AFRICAPART,
    ],
    SHARED: [
      process.env.GLEAP_API_KEY_SHARED,
      process.env.GLEAP_PROJECT_ID_SHARED,
    ],
  };
  const [apiKey, projectId] = map[key];
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId };
}

export function isGleapConfigured(key: GleapProjectKey): boolean {
  return getCredentials(key) !== null;
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function gleapFetch<T>(
  creds: GleapCredentials,
  path: string
): Promise<T> {
  const cacheKey = `${creds.projectId}::${path}`;
  const now = Date.now();
  const cached = cache.get(cacheKey) as CacheEntry<T> | undefined;
  if (cached && cached.expires > now) return cached.data;

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      project: creds.projectId,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Gleap API ${res.status} on ${path}`);
  }
  const data = (await res.json()) as T;
  cache.set(cacheKey, { data, expires: now + CACHE_TTL_MS });
  return data;
}

interface GleapTicket {
  _id?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  slaBreached?: boolean;
  processingUser?: {
    _id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  } | null;
}

interface GleapTicketsResponse {
  tickets: GleapTicket[];
  count: number;
  totalCount: number;
}

interface GleapProjectUser {
  id?: string;
  _id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export async function getOpenTicketsCount(
  key: GleapProjectKey
): Promise<number | null> {
  const creds = getCredentials(key);
  if (!creds) return null;
  try {
    const data = await gleapFetch<GleapTicketsResponse>(
      creds,
      "/tickets?status=OPEN&ignoreArchived=true&limit=1"
    );
    return typeof data.totalCount === "number" ? data.totalCount : null;
  } catch (err) {
    console.error(`[gleap] getOpenTicketsCount(${key}) failed:`, err);
    return null;
  }
}

export interface GleapAgentMetric {
  id: string;
  name: string;
  ticketsHandled: number;
  avgResolutionHours: number | null;
  slaBreached: number;
}

export interface GleapWorkspaceStats {
  agents: GleapAgentMetric[];
  // Total slaBreached tickets in the fetched sample (up to TICKET_FETCH_LIMIT
  // most recent non-archived tickets). Lower bound for huge backlogs.
  slaBreachedInSample: number;
  sampleSize: number;
}

export async function getWorkspaceStats(
  key: GleapProjectKey
): Promise<GleapWorkspaceStats | null> {
  const creds = getCredentials(key);
  if (!creds) return null;
  try {
    const [users, tickets] = await Promise.all([
      gleapFetch<GleapProjectUser[]>(creds, "/projects/users"),
      gleapFetch<GleapTicketsResponse>(
        creds,
        `/tickets?ignoreArchived=true&limit=${TICKET_FETCH_LIMIT}`
      ),
    ]);

    const userById = new Map<string, GleapProjectUser>();
    for (const u of users) {
      const id = u.id || u._id;
      if (id) userById.set(id, u);
    }

    const grouped = new Map<string, GleapTicket[]>();
    for (const t of tickets.tickets) {
      const uid = t.processingUser?._id;
      if (!uid || !userById.has(uid)) continue;
      const list = grouped.get(uid) ?? [];
      list.push(t);
      grouped.set(uid, list);
    }

    const agents: GleapAgentMetric[] = [];
    for (const [uid, userTickets] of grouped) {
      const user = userById.get(uid)!;
      const closed = userTickets.filter((t) => t.status !== "OPEN");
      const resolutionHours = closed.map(
        (t) =>
          (new Date(t.updatedAt).getTime() -
            new Date(t.createdAt).getTime()) /
          (1000 * 60 * 60)
      );
      const avgResolutionHours =
        resolutionHours.length > 0
          ? resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length
          : null;
      const slaBreached = userTickets.filter((t) => t.slaBreached === true)
        .length;
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.email ||
        "Agent";
      agents.push({
        id: uid,
        name,
        ticketsHandled: userTickets.length,
        avgResolutionHours,
        slaBreached,
      });
    }

    return {
      agents,
      slaBreachedInSample: tickets.tickets.filter(
        (t) => t.slaBreached === true
      ).length,
      sampleSize: tickets.tickets.length,
    };
  } catch (err) {
    console.error(`[gleap] getWorkspaceStats(${key}) failed:`, err);
    return null;
  }
}
