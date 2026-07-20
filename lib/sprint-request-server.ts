import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";
import type { ViewerTeams } from "@/lib/sprint-request";

/**
 * Resolve the viewer's team memberships used to route requests: departments
 * they belong to (via DepartmentMember) and products they own.
 */
export async function loadViewerTeams(
  orgId: string,
  userId: string,
  role: UserRole
): Promise<ViewerTeams> {
  const [memberships, ownedProducts] = await Promise.all([
    prisma.departmentMember.findMany({
      where: { userId },
      select: { departmentId: true },
    }),
    prisma.product.findMany({
      where: { orgId, ownerId: userId },
      select: { id: true },
    }),
  ]);
  return {
    userId,
    role,
    departmentIds: memberships.map((m) => m.departmentId),
    productIds: ownedProducts.map((p) => p.id),
  };
}
