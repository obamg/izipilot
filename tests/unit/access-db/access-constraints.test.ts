import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

describe("contraintes en base — gestion des accès", () => {
  let orgId: string;
  let userId: string;
  let assetId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Access Org", slug: `test-access-${Date.now()}` },
    });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        orgId,
        email: `test-access-${Date.now()}@example.com`,
        name: "Test User",
        role: "PO",
      },
    });
    userId = user.id;
    const asset = await prisma.accessAsset.create({
      data: { orgId, name: "Asset Test" },
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("rejette une deuxième affectation courante pour le même employé et le même actif", async () => {
    await prisma.accessAssignment.create({
      data: { orgId, userId, assetId, status: "ACTIVE", source: "LEGACY_IMPORT" },
    });

    await expect(
      prisma.accessAssignment.create({
        data: { orgId, userId, assetId, status: "ACTIVE", source: "LEGACY_IMPORT" },
      })
    ).rejects.toThrow();
  });

  it("rejette un deuxième titulaire CISO dans la même organisation", async () => {
    const secondUser = await prisma.user.create({
      data: {
        orgId,
        email: `test-ciso-2-${Date.now()}@example.com`,
        name: "Second CISO",
        role: "PO",
      },
    });

    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "CISO", userId },
    });

    await expect(
      prisma.accessRoleAssignment.create({
        data: { orgId, role: "CISO", userId: secondUser.id },
      })
    ).rejects.toThrow();
  });

  it("rejette un suppléant identique au titulaire", async () => {
    await expect(
      prisma.accessRoleAssignment.create({
        data: { orgId, role: "HR", userId, backupUserId: userId },
      })
    ).rejects.toThrow();
  });

  it("rejette une priorité de niveau dupliquée parmi les niveaux activés d'un même actif", async () => {
    await prisma.accessLevel.create({
      data: { assetId, name: "Lecture", priority: 1, isAdmin: false },
    });

    await expect(
      prisma.accessLevel.create({
        data: { assetId, name: "Lecture avancée", priority: 1, isAdmin: false },
      })
    ).rejects.toThrow();
  });
});
