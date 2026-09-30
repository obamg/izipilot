// tests/unit/access-processor-route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Le processeur réel parcourt toutes les organisations actives de la base :
// on le remplace ici pour ne tester que la route (secret, forme de réponse).
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("@/lib/access/access-processor", () => ({ runAccessProcessor: runMock }));

import { GET } from "@/app/api/cron/access-processor/route";

function makeRequest(authHeader: string | null): NextRequest {
  const headers = new Headers();
  if (authHeader !== null) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/cron/access-processor", { headers });
}

describe("GET /api/cron/access-processor", () => {
  const ORIGINAL = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-with-some-length-1234567890";
    runMock.mockReset();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it("401 sans secret ou avec un mauvais secret, sans lancer le processeur", async () => {
    expect((await GET(makeRequest(null))).status).toBe(401);
    expect((await GET(makeRequest("Bearer mauvais-secret"))).status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("200 avec le secret : lance le processeur et renvoie son rapport", async () => {
    runMock.mockResolvedValue({ released: 1, repaired: 0, expired: 2, revisionRequired: 0, errors: 0 });
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: 1, repaired: 0, expired: 2, revisionRequired: 0, errors: 0 });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("500 si le processeur échoue, sans détail interne dans la réponse", async () => {
    runMock.mockRejectedValue(new Error("connexion base perdue"));
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Erreur interne" });
  });
});
