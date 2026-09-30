import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listAssignments,
  getOwnedAssetIds,
  getRegisterNav,
  RegisterNotFoundError,
} from "@/lib/access/register-server";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe("register-server — vues de lecture du registre", () => {
  let orgId: string;
  let otherOrgId: string;
  let otherDeptId: string;
  const u: Record<string, string> = {};
  let d1: string;
  let d2: string;
  let assetX: string;
  let assetY: string;
  let assetArchived: string;

  async function createUser(orgIdArg: string, label: string) {
    const user = await prisma.user.create({
      data: {
        orgId: orgIdArg,
        email: `test-register-${label}-${stamp}@example.com`,
        name: `Register ${label}`,
        role: "PO",
      },
    });
    return user.id;
  }

  beforeAll(async () => {
    orgId = (await prisma.organization.create({
      data: { name: "Test Register Org", slug: `test-register-${stamp}` },
    })).id;
    otherOrgId = (await prisma.organization.create({
      data: { name: "Test Register Other Org", slug: `test-register-other-${stamp}` },
    })).id;

    for (const label of ["head1", "head2", "backupHead1", "emp1", "emp2", "ciso", "owner", "backupOwner", "adminOnly", "plain"]) {
      u[label] = await createUser(orgId, label);
    }
    const otherOwner = await createUser(otherOrgId, "otherOwner");

    d1 = (await prisma.department.create({
      data: { orgId, code: `RG1-${stamp}`, name: "Register D1", color: "#000000", ownerId: u.head1 },
    })).id;
    d2 = (await prisma.department.create({
      data: { orgId, code: `RG2-${stamp}`, name: "Register D2", color: "#000000", ownerId: u.head2 },
    })).id;
    otherDeptId = (await prisma.department.create({
      data: { orgId: otherOrgId, code: `RGX-${stamp}`, name: "Other D", color: "#000000", ownerId: otherOwner },
    })).id;

    await prisma.accessProfile.createMany({
      data: [
        { orgId, userId: u.emp1, primaryDepartmentId: d1 },
        { orgId, userId: u.emp2, primaryDepartmentId: d2 },
        { orgId, userId: u.head1, primaryDepartmentId: d1 },
        { orgId, userId: u.plain, primaryDepartmentId: null },
      ],
    });

    // Suppléant de d1, titulaire (head1) disponible et non marqué indisponible.
    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "DEPARTMENT_HEAD", departmentId: d1, backupUserId: u.backupHead1 },
    });
    await prisma.accessRoleAssignment.create({ data: { orgId, role: "CISO", userId: u.ciso } });
    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "ASSET_ADMINISTRATOR", userId: u.adminOnly },
    });

    assetX = (await prisma.accessAsset.create({
      data: { orgId, name: `Register X ${stamp}`, ownerId: u.owner, backupOwnerId: u.backupOwner },
    })).id;
    assetY = (await prisma.accessAsset.create({ data: { orgId, name: `Register Y ${stamp}` } })).id;
    assetArchived = (await prisma.accessAsset.create({
      data: { orgId, name: `Register Z ${stamp}`, ownerId: u.owner, archivedAt: new Date() },
    })).id;

    await prisma.accessAssignment.createMany({
      data: [
        { orgId, userId: u.emp1, assetId: assetX, status: "ACTIVE", verification: "IMPORTED_UNREVIEWED" },
        { orgId, userId: u.emp1, assetId: assetY, status: "EXPIRED_REMOVAL_PENDING" },
        { orgId, userId: u.emp2, assetId: assetX, status: "ACTIVE" },
        { orgId, userId: u.emp2, assetId: assetY, status: "REVOKED" },
        { orgId, userId: u.head1, assetId: assetY, status: "ACTIVE" },
        { orgId, userId: u.plain, assetId: assetArchived, status: "ACTIVE" },
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

  const page = { page: 1, pageSize: 25 };
  const viewer = (label: string) => ({ userId: u[label], orgId });

  it("Mes accès : uniquement les siens, REVOKED exclu, retrait en attente inclus", async () => {
    const { rows, total } = await listAssignments({
      viewer: viewer("emp1"), view: { kind: "SELF" }, filters: {}, pagination: page,
    });
    expect(total).toBe(2);
    expect(rows.every((r) => r.userId === u.emp1)).toBe(true);
    expect(rows.map((r) => r.status).sort()).toEqual(["ACTIVE", "EXPIRED_REMOVAL_PENDING"]);
    const x = rows.find((r) => r.assetId === assetX)!;
    expect(x.departmentName).toBe("Register D1");
    expect(x.verification).toBe("IMPORTED_UNREVIEWED");
    expect(x).not.toHaveProperty("email");
  });

  it("Mes accès : une recherche sur un autre nom ne révèle rien", async () => {
    const { rows, total } = await listAssignments({
      viewer: viewer("emp1"), view: { kind: "SELF" }, filters: { q: "emp2" }, pagination: page,
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it("chef de d1 : voit d1, pas d2", async () => {
    const { rows } = await listAssignments({
      viewer: viewer("head1"), view: { kind: "DEPARTMENT", departmentId: d1 }, filters: {}, pagination: page,
    });
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([u.emp1, u.head1]));
    await expect(
      listAssignments({
        viewer: viewer("head1"), view: { kind: "DEPARTMENT", departmentId: d2 }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("suppléant de chef avec titulaire disponible : pas de vue département", async () => {
    await expect(
      listAssignments({
        viewer: viewer("backupHead1"), view: { kind: "DEPARTMENT", departmentId: d1 }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("suit le département principal actuel", async () => {
    await prisma.accessProfile.update({ where: { userId: u.emp1 }, data: { primaryDepartmentId: d2 } });
    try {
      const d1Rows = await listAssignments({
        viewer: viewer("head1"), view: { kind: "DEPARTMENT", departmentId: d1 }, filters: {}, pagination: page,
      });
      expect(d1Rows.rows.some((r) => r.userId === u.emp1)).toBe(false);
      const d2Rows = await listAssignments({
        viewer: viewer("head2"), view: { kind: "DEPARTMENT", departmentId: d2 }, filters: {}, pagination: page,
      });
      expect(d2Rows.rows.some((r) => r.userId === u.emp1)).toBe(true);
    } finally {
      await prisma.accessProfile.update({ where: { userId: u.emp1 }, data: { primaryDepartmentId: d1 } });
    }
  });

  it("CISO : « Toutes » couvre l'org, n'importe quel département, et « Sans département » en dernier", async () => {
    const all = await listAssignments({
      viewer: viewer("ciso"), view: { kind: "DEPARTMENT", departmentId: "ALL" }, filters: {}, pagination: page,
    });
    expect(all.total).toBe(5); // 6 affectations − 1 REVOKED
    expect(all.rows.at(-1)?.departmentName).toBeNull(); // « plain », sans département
    const d2Rows = await listAssignments({
      viewer: viewer("ciso"), view: { kind: "DEPARTMENT", departmentId: d2 }, filters: {}, pagination: page,
    });
    expect(d2Rows.rows.map((r) => r.userId)).toEqual([u.emp2]);
  });

  it("CISO : un département d'une autre organisation donne NOT_FOUND, pas une liste vide", async () => {
    await expect(
      listAssignments({
        viewer: viewer("ciso"), view: { kind: "DEPARTMENT", departmentId: otherDeptId }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("propriétaire et suppléant d'actif voient toutes les affectations de l'actif, tous départements", async () => {
    for (const label of ["owner", "backupOwner"]) {
      const { rows } = await listAssignments({
        viewer: viewer(label), view: { kind: "ASSET" }, filters: {}, pagination: page,
      });
      expect(new Set(rows.map((r) => r.userId))).toEqual(new Set([u.emp1, u.emp2]));
      expect(rows.every((r) => r.assetId === assetX)).toBe(true);
    }
  });

  it("actif archivé : hors de la portée propriétaire, mais visible dans Mes accès", async () => {
    expect(await getOwnedAssetIds(orgId, u.owner)).toEqual([assetX]);
    await expect(
      listAssignments({
        viewer: viewer("owner"), view: { kind: "ASSET", assetId: assetArchived }, filters: {}, pagination: page,
      })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
    const mine = await listAssignments({
      viewer: viewer("plain"), view: { kind: "SELF" }, filters: {}, pagination: page,
    });
    expect(mine.rows[0]?.assetArchived).toBe(true);
  });

  it("propriétaire indisponible (OFFBOARDING) : plus de portée sur ses actifs", async () => {
    await prisma.accessProfile.create({ data: { orgId, userId: u.owner, lifecycle: "OFFBOARDING" } });
    try {
      expect(await getOwnedAssetIds(orgId, u.owner)).toEqual([]);
      await expect(
        listAssignments({ viewer: viewer("owner"), view: { kind: "ASSET" }, filters: {}, pagination: page })
      ).rejects.toBeInstanceOf(RegisterNotFoundError);
    } finally {
      await prisma.accessProfile.delete({ where: { userId: u.owner } });
    }
    expect(await getOwnedAssetIds(orgId, u.owner)).toEqual([assetX]);
  });

  it("Administrateur des actifs sans actif possédé : pas de vue actifs", async () => {
    await expect(
      listAssignments({ viewer: viewer("adminOnly"), view: { kind: "ASSET" }, filters: {}, pagination: page })
    ).rejects.toBeInstanceOf(RegisterNotFoundError);
  });

  it("le total est compté après filtrage et avant pagination", async () => {
    const { rows, total } = await listAssignments({
      viewer: viewer("ciso"),
      view: { kind: "DEPARTMENT", departmentId: "ALL" },
      filters: { assetId: assetX },
      pagination: { page: 1, pageSize: 1 },
    });
    expect(total).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it("getRegisterNav reflète les portées", async () => {
    const plain = await getRegisterNav(orgId, u.plain);
    expect(plain).toMatchObject({
      hasDepartmentView: false, hasOwnedAssetsView: false, canSeeAll: false, defaultDepartmentId: null,
    });

    const head = await getRegisterNav(orgId, u.head1);
    expect(head).toMatchObject({ hasDepartmentView: true, canSeeAll: false, defaultDepartmentId: d1 });
    expect(head.departments.map((d) => d.id)).toEqual([d1]);

    const ciso = await getRegisterNav(orgId, u.ciso);
    expect(ciso).toMatchObject({ hasDepartmentView: true, canSeeAll: true, defaultDepartmentId: "ALL" });
    expect(ciso.departments.map((d) => d.id).sort()).toEqual([d1, d2].sort());

    const owner = await getRegisterNav(orgId, u.owner);
    expect(owner.hasOwnedAssetsView).toBe(true);
    expect(owner.ownedAssets.map((a) => a.id)).toEqual([assetX]);
  });
});
