import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron";

function makeRequest(authHeader: string | null): NextRequest {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/cron/test", { headers });
}

describe("verifyCronSecret", () => {
  const ORIGINAL = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-with-some-length-1234567890";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it("accepts the matching Bearer header", () => {
    expect(
      verifyCronSecret(
        makeRequest(`Bearer ${process.env.CRON_SECRET}`)
      )
    ).toBe(true);
  });

  it("rejects a mismatched secret of the same length", () => {
    expect(
      verifyCronSecret(
        makeRequest("Bearer x3cret-with-some-length-1234567890")
      )
    ).toBe(false);
  });

  it("rejects a header of different length", () => {
    expect(verifyCronSecret(makeRequest("Bearer too-short"))).toBe(false);
  });

  it("rejects when the Authorization header is missing", () => {
    expect(verifyCronSecret(makeRequest(null))).toBe(false);
  });

  it("rejects when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret(makeRequest("Bearer anything"))).toBe(false);
  });

  it("rejects a header missing the Bearer prefix", () => {
    expect(
      verifyCronSecret(makeRequest(process.env.CRON_SECRET!))
    ).toBe(false);
  });
});
