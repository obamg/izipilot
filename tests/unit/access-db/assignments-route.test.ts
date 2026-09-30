import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// vi.mock est hissé au-dessus des imports : le mock doit être créé par vi.hoisted.
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: () => sessionMock() }));

import { GET } from "@/app/api/access/assignments/route";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("GET /api/access/assignments", () => {
  let orgId: string;
  let otherOrgId: string;
  let otherDeptId: string;
  let d1: string;
  const u: Record<string, string> = {};

  async function call(query: string, as: string | null) {
    sessionMock.mockResolvedValue(as ? { user: { id: u[as], orgId } } : null);
    return GET(new Request(`http://localhost/api/access/assignments?${query}`));
  }

  beforeAll(async () => {
    orgId = (await prisma.organization.create({
      data: { name: "Test Route Org", slug: `test-route-${stamp}` },
    })).id;
    otherOrgId = (await prisma.organization.create({
      data: { name: "Test Route Other", slug: `test-route-other-${stamp}` },
    })).id;
    for (const label of ["head", "emp", "ciso"]) {
      u[label] = (await prisma.user.create({
        data: { orgId, email: `test-route-${label}-${stamp}@example.com`, name: `Route ${label}`, role: "PO" },
      })).id;
    }
    const otherUser = (await prisma.user.create({
      data: { orgId: otherOrgId, email: `test-route-other-${stamp}@example.com`, name: "Route other", role: "PO" },
    })).id;
    d1 = (await prisma.department.create({
      data: { orgId, code: `RT1-${stamp}`, name: "Route D1", color: "#000000", ownerId: u.head },
    })).id;
    otherDeptId = (await prisma.department.create({
      data: { orgId: otherOrgId, code: `RTX-${stamp}`, name: "Route DX", color: "#000000", ownerId: otherUser },
    })).id;
    await prisma.accessProfile.create({ data: { orgId, userId: u.emp, primaryDepartmentId: d1 } });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: u.ciso } });
    const asset = await prisma.accessAsset.create({ data: { orgId, name: `Route asset ${stamp}` } });
    await prisma.accessAssignment.createMany({
      data: [
        { orgId, userId: u.emp, assetId: asset.id, status: "ACTIVE" },
        { orgId, userId: u.head, assetId: asset.id, status: "ACTIVE" },
      ],
    });
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await prisma.accessTaskEvent.deleteMany({ where: { orgId: id } });
      await prisma.accessFulfilmentTask.deleteMany({ where: { orgId: id } });
      await prisma.accessAssignment.deleteMany({ where: { orgId: id } });
      await prisma.accessAsset.deleteMany({ where: { orgId: id } });
      await prisma.accessRoleAssignment.deleteMany({ where: { orgId: id } });
      await prisma.accessProfile.deleteMany({ where: { orgId: id } });
      await prisma.department.deleteMany({ where: { orgId: id } });
      await prisma.user.deleteMany({ where: { orgId: id } });
      await prisma.organization.delete({ where: { id } });
    }
  });

  it("401 sans session", async () => {
    expect((await call("view=me", null)).status).toBe(401);
  });

  it("200 Mes accès, forme { data, total, page, pageSize }", async () => {
    const res = await call("view=me", "emp");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(body.data[0].userId).toBe(u.emp);
  });

  it("un filtre q sur Mes accès ne révèle aucun autre employé", async () => {
    const body = await (await call("view=me&q=head", "emp")).json();
    expect(body.total).toBe(0);
  });

  it("404 pour un employé simple sur la vue département", async () => {
    expect((await call(`view=department&departmentId=${d1}`, "emp")).status).toBe(404);
  });

  it("404 pour le CISO sur un département d'une autre organisation", async () => {
    expect((await call(`view=department&departmentId=${otherDeptId}`, "ciso")).status).toBe(404);
  });

  it("200 pour le chef sur son département, total avant pagination", async () => {
    const body = await (await call(`view=department&departmentId=${d1}&pageSize=1`, "head")).json();
    expect(body.total).toBe(1); // seul emp a d1 comme département principal
    expect(body.data).toHaveLength(1);
  });

  it("400 sur paramètre invalide ou vue département sans departmentId", async () => {
    expect((await call("view=nimporte", "emp")).status).toBe(400);
    expect((await call("view=department", "head")).status).toBe(400);
  });
});
