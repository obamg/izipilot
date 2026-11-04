import { describe, expect, it } from "vitest";
import { dcrRequestSchema } from "@/lib/validations/oauth";

const register = (uri: string) =>
  dcrRequestSchema.safeParse({ redirect_uris: [uri] }).success;

describe("DCR redirect_uris", () => {
  it("accepts https and loopback http", () => {
    expect(register("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(register("http://localhost:33418/callback")).toBe(true);
    expect(register("http://127.0.0.1:5000/cb")).toBe(true);
  });

  it("rejects javascript:, data: and non-loopback http", () => {
    expect(register("javascript:alert(1)")).toBe(false);
    expect(register("data:text/html,hi")).toBe(false);
    expect(register("http://evil.example/cb")).toBe(false);
  });
});
