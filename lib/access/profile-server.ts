// lib/access/profile-server.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Crée le profil d'accès d'un utilisateur s'il n'existe pas déjà, avec le
 * département principal déduit automatiquement quand l'utilisateur
 * appartient à exactement un département (conception §5) — sinon laissé vide
 * pour que l'administrateur de plateforme le choisisse (spec §3).
 */
export async function ensureAccessProfile(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string
): Promise<void> {
  const existing = await tx.accessProfile.findUnique({ where: { userId } });
  if (existing) return;

  const primaryDepartmentId = await resolvePrimaryDepartment(tx, userId);

  await tx.accessProfile.create({
    data: { orgId, userId, primaryDepartmentId, lifecycle: "ACTIVE" },
  });
}

export async function resolvePrimaryDepartment(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<string | null> {
  const memberships = await tx.departmentMember.findMany({
    where: { userId },
    select: { departmentId: true },
  });
  return memberships.length === 1 ? memberships[0].departmentId : null;
}

export async function listConfigIssues(orgId: string) {
  const profiles = await prisma.accessProfile.findMany({
    where: { orgId, primaryDepartmentId: null },
    select: {
      userId: true,
      user: { select: { name: true } },
    },
  });

  const userIds = profiles.map((p) => p.userId);
  const membershipCounts = userIds.length
    ? await prisma.departmentMember.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _count: { userId: true },
      })
    : [];
  const countByUser = new Map(membershipCounts.map((m) => [m.userId, m._count.userId]));

  const usersWithoutPrimaryDepartment = profiles.map((p) => ({
    id: p.userId,
    name: p.user.name,
    departmentCount: countByUser.get(p.userId) ?? 0,
  }));

  return { usersWithoutPrimaryDepartment };
}
