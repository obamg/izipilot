// tests/unit/access-db/fulfilment-routes.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// vi.mock est hissé au-dessus des imports : le mock doit être créé par vi.hoisted.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: () => sessionMock() }));

import { GET as listTasks } from "@/app/api/access/tasks/route";
import { POST as claim } from "@/app/api/access/tasks/[taskId]/claim/route";
import { POST as handover } from "@/app/api/access/tasks/[taskId]/handover/route";
import { POST as block } from "@/app/api/access/tasks/[taskId]/block/route";
import { POST as resume } from "@/app/api/access/tasks/[taskId]/resume/route";
import { POST as complete } from "@/app/api/access/tasks/[taskId]/complete/route";
import { POST as reconcile } from "@/app/api/access/tasks/[taskId]/reconcile/route";
import { POST as claimBatch } from "@/app/api/access/tasks/claim-batch/route";
import { POST as completeBatch } from "@/app/api/access/tasks/complete-batch/route";
import {
  approvedSelfRequest,
  cleanupFulfilmentFixture,
  createFulfilmentFixture,
  newEmployee,
  taskForVersion,
  type FulfilmentFixture,
} from "./fulfilment-fixtures";

type TaskRoute = (request: Request, ctx: { params: Promise<{ taskId: string }> }) => Promise<Response>;

describe("routes /api/access/tasks/** — 401 / 400 / 404 / 409", () => {
  let fx: FulfilmentFixture;

  function as(userId: string | null) {
    sessionMock.mockResolvedValue(userId ? { user: { id: userId, orgId: fx.orgId } } : null);
  }
  function post(route: TaskRoute, taskId: string, body: unknown) {
    const request = new Request(`http://localhost/api/access/tasks/${taskId}/x`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return route(request, { params: Promise.resolve({ taskId }) });
  }
  function postBatch(route: (request: Request) => Promise<Response>, body: unknown) {
    return route(
      new Request("http://localhost/api/access/tasks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }
  async function readyTaskId(label: string) {
    const emp = await newEmployee(fx, label);
    const final = await approvedSelfRequest(fx, emp, fx.levels.reader);
    return (await taskForVersion(final.id)).id;
  }
  const evidence = () => ({ completedAt: new Date().toISOString(), reference: "REF-1" });

  beforeAll(async () => {
    fx = await createFulfilmentFixture("routes");
  });
  afterAll(async () => {
    await cleanupFulfilmentFixture(fx.orgId);
  });

  it("401 sans session sur chaque route", async () => {
    as(null);
    const taskId = "peu-importe";
    const routes: TaskRoute[] = [claim, handover, block, resume, complete, reconcile];
    for (const route of routes) {
      const res = await post(route, taskId, { expectedRevision: 1 });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Non authentifié" });
    }
    expect((await listTasks(new Request("http://localhost/api/access/tasks"))).status).toBe(401);
    expect((await postBatch(claimBatch, { items: [] })).status).toBe(401);
    expect((await postBatch(completeBatch, { items: [] })).status).toBe(401);
  });

  it("400 sur corps invalide, avec code VALIDATION (Review Focus #5 : preuve vide, date future)", async () => {
    as(fx.users.owner);
    const taskId = await readyTaskId("Bad");
    const bad: [TaskRoute, unknown][] = [
      [claim, {}],
      [resume, { expectedRevision: 0 }],
      [handover, { toUserId: fx.users.backup, reason: "x", expectedRevision: 1 }],
      [block, { reason: "", expectedRevision: 1 }],
      [reconcile, { expectedRevision: 1 }],
      [complete, { completedAt: new Date().toISOString(), reference: "  ", note: "", expectedRevision: 1 }],
      [complete, { completedAt: new Date(Date.now() + 3_600_000).toISOString(), reference: "R", expectedRevision: 1 }],
    ];
    for (const [route, body] of bad) {
      const res = await post(route, taskId, body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION");
    }
    const notJson = await claim(
      new Request("http://localhost/x", { method: "POST", body: "pas du json" }),
      { params: Promise.resolve({ taskId }) }
    );
    expect(notJson.status).toBe(400);
    expect((await postBatch(claimBatch, { items: [] })).status).toBe(400);
    expect((await postBatch(completeBatch, { items: [{ taskId, expectedRevision: 1, completedAt: new Date().toISOString() }] })).status).toBe(400);
    expect((await listTasks(new Request("http://localhost/api/access/tasks?view=tout"))).status).toBe(400);
  });

  it("404 hors périmètre : un tiers ne voit ni ne touche une tâche ; tâche inexistante", async () => {
    const taskId = await readyTaskId("Scope");
    as(fx.users.stranger);
    expect((await listTasks(new Request("http://localhost/api/access/tasks?view=mine"))).status).toBe(404);
    expect((await listTasks(new Request("http://localhost/api/access/tasks?view=oversight"))).status).toBe(404);
    const routes: [TaskRoute, unknown][] = [
      [claim, { expectedRevision: 1 }],
      [resume, { expectedRevision: 1 }],
      [handover, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 1 }],
      [block, { reason: "bloqué", expectedRevision: 1 }],
      [reconcile, { reason: "rien fait", expectedRevision: 1 }],
      [complete, { ...evidence(), expectedRevision: 1 }],
    ];
    for (const [route, body] of routes) {
      const res = await post(route, taskId, body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Tâche introuvable", code: "NOT_FOUND" });
    }
    as(fx.users.owner);
    expect((await post(claim, "tache-inexistante", { expectedRevision: 1 })).status).toBe(404);
  });

  it("409 : révision périmée (STALE) et transition invalide (INVALID_TRANSITION), codes distinguables", async () => {
    as(fx.users.owner);
    const taskId = await readyTaskId("Conflict");
    const stale = await post(claim, taskId, { expectedRevision: 5 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "La tâche a changé, rechargez", code: "STALE" });

    const invalid: [TaskRoute, unknown][] = [
      [resume, { expectedRevision: 1 }],
      [block, { reason: "bloqué", expectedRevision: 1 }],
      [handover, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 1 }],
      [reconcile, { reason: "rien fait", expectedRevision: 1 }],
      [complete, { ...evidence(), expectedRevision: 1 }],
    ];
    for (const [route, body] of invalid) {
      const res = await post(route, taskId, body);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("INVALID_TRANSITION");
    }
  });

  it("200 : parcours complet par les routes (liste, réclamer, bloquer, reprendre, passer la main, confirmer)", async () => {
    const taskId = await readyTaskId("Happy");
    as(fx.users.owner);
    const list = await listTasks(new Request("http://localhost/api/access/tasks?view=mine&state=open&pageSize=100"));
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody).toMatchObject({ page: 1, pageSize: 100 });
    expect(listBody.data.some((t: { id: string }) => t.id === taskId)).toBe(true);

    expect((await (await post(claim, taskId, { expectedRevision: 1 })).json()).data).toEqual({ taskId, state: "CLAIMED", revision: 2 });
    expect((await post(block, taskId, { reason: "attente fournisseur", expectedRevision: 2 })).status).toBe(200);
    expect((await post(resume, taskId, { expectedRevision: 3 })).status).toBe(200);
    expect((await post(handover, taskId, { toUserId: fx.users.backup, reason: "congés", expectedRevision: 4 })).status).toBe(200);

    as(fx.users.backup);
    const done = await post(complete, taskId, { ...evidence(), expectedRevision: 5 });
    expect(done.status).toBe(200);
    expect((await done.json()).data).toMatchObject({ state: "COMPLETED", outcome: "PROVISIONED", replayed: false });
    expect((await prisma.accessFulfilmentTask.findUniqueOrThrow({ where: { id: taskId } })).completedById).toBe(fx.users.backup);
  });

  it("lots : 200 avec un résultat par élément et un correlationId", async () => {
    as(fx.users.owner);
    const a = await readyTaskId("LotA");
    const res = await postBatch(claimBatch, { items: [{ taskId: a, expectedRevision: 1 }, { taskId: "inconnue", expectedRevision: 1 }] });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.results.map((r: { ok: boolean; code: string | null }) => [r.ok, r.code])).toEqual([[true, null], [false, "NOT_FOUND"]]);

    const done = await postBatch(completeBatch, { items: [{ taskId: a, ...evidence(), expectedRevision: 2 }] });
    expect(done.status).toBe(200);
    expect((await done.json()).data.results).toEqual([{ taskId: a, ok: true, error: null, code: null }]);
  });
});
