import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, _resetRateLimitForTests } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first N attempts and blocks the (N+1)th", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", 5, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit("k", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("decrements `remaining` as attempts accumulate", () => {
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(2);
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(1);
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(0);
  });

  it("isolates keys — one IP being blocked does not block another", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("alice", 5, 60_000);
    expect(checkRateLimit("alice", 5, 60_000).allowed).toBe(false);
    expect(checkRateLimit("bob", 5, 60_000).allowed).toBe(true);
  });

  it("resets the window after windowMs has elapsed", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", 5, 60_000);
    expect(checkRateLimit("k", 5, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit("k", 5, 60_000).allowed).toBe(true);
  });

  it("returns a positive retryAfterSec when blocked", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("k", 3, 60_000);
    const blocked = checkRateLimit("k", 3, 60_000);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });
});
