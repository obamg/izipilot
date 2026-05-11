import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Verify the `Authorization: Bearer <CRON_SECRET>` header against the env
 * value. Uses constant-time comparison so a timing attack on the secret's
 * first bytes cannot leak it byte-by-byte.
 *
 * Returns true when the request is authorized to run a cron handler.
 * Returns false on any other case (missing env, missing header, mismatch,
 * or different byte length).
 */
export function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const expected = `Bearer ${secret}`;
  const actual = header;

  // timingSafeEqual throws unless both buffers are the same length; pad the
  // shorter side and compare lengths separately so length itself doesn't
  // leak via timing.
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Run a dummy compare so this code path takes similar time to a hit.
    const dummy = Buffer.alloc(b.length);
    timingSafeEqual(dummy, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
