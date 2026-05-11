import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { log } from "@/lib/log";

let stdoutLines: string[];
let stderrLines: string[];
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutLines = [];
  stderrLines = [];
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((s: string | Uint8Array) => {
      stdoutLines.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stdout.write);
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(((s: string | Uint8Array) => {
      stderrLines.push(typeof s === "string" ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stderr.write);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function parseLast(out: string[]): Record<string, unknown> {
  return JSON.parse(out[out.length - 1]!.trim());
}

describe("log", () => {
  it("emits info to stdout with level + msg", () => {
    log.info("hello", { user: "alice" });
    const parsed = parseLast(stdoutLines);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.user).toBe("alice");
    expect(parsed.ts).toBeTypeOf("string");
  });

  it("emits error to stderr with serialized Error", () => {
    const err = new Error("boom");
    log.error("blew up", { krId: "kr1" }, err);
    const parsed = parseLast(stderrLines);
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("blew up");
    expect(parsed.krId).toBe("kr1");
    expect((parsed.error as { message: string }).message).toBe("boom");
    expect((parsed.error as { name: string }).name).toBe("Error");
    expect((parsed.error as { stack?: string }).stack).toContain("boom");
  });

  it("child loggers bind a scope to every line", () => {
    const child = log.child("cron/test");
    child.info("ran");
    const parsed = parseLast(stdoutLines);
    expect(parsed.scope).toBe("cron/test");
  });

  it("nested children merge scopes / fields rather than overriding", () => {
    const child = log.child("cron/test", { orgId: "o1" });
    child.warn("watch out", { extra: 1 });
    const parsed = parseLast(stdoutLines);
    expect(parsed.scope).toBe("cron/test");
    expect(parsed.orgId).toBe("o1");
    expect(parsed.extra).toBe(1);
  });

  it("error() works with non-Error throwables", () => {
    log.error("string-thrown", undefined, "just a string");
    const parsed = parseLast(stderrLines);
    expect((parsed.error as { name: string }).name).toBe("NonError");
    expect((parsed.error as { message: string }).message).toBe("just a string");
  });

  it("emits valid JSON one line per call", () => {
    log.info("a");
    log.warn("b");
    log.error("c");
    const all = [...stdoutLines, ...stderrLines];
    for (const line of all) {
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line.trim())).not.toThrow();
    }
  });
});
