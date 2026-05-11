/**
 * Fixed-window in-memory rate limiter. Designed for a single-process
 * self-hosted deployment (Docker container on the VPS). Buckets are kept
 * in a module-level Map — they share state across requests in the same
 * Node process but reset on container restart, which is fine for
 * brute-force login protection: the cost-of-restart is low compared to
 * the cost-of-allowing.
 *
 * Do NOT use this across multiple replicas — each replica keeps its own
 * counters and an attacker would multiply the effective limit by the
 * replica count. If we ever scale horizontally, swap for Redis.
 */

interface Bucket {
  count: number;
  resetAt: number; // ms epoch
}

const buckets = new Map<string, Bucket>();

// Opportunistic GC. Without this, expired buckets for stale IPs would
// pile up indefinitely. Every 200 writes we sweep entries whose window
// has closed — keeps the map bounded by active-IP count.
let opsSinceSweep = 0;
function sweepIfNeeded(now: number) {
  if (++opsSinceSweep < 200) return;
  opsSinceSweep = 0;
  for (const [k, b] of buckets.entries()) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying. 0 when allowed. */
  retryAfterSec: number;
  /** Remaining attempts in the current window. */
  remaining: number;
}

/**
 * Record one attempt against the given key and decide whether to allow it.
 * Atomic per-process: increments and checks in a single synchronous step.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  sweepIfNeeded(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0, remaining: limit - 1 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, limit - bucket.count),
  };
}

/**
 * Test-only: clears every bucket. Exported so unit tests don't bleed
 * across cases. Don't call from production code.
 */
export function _resetRateLimitForTests(): void {
  buckets.clear();
  opsSinceSweep = 0;
}
