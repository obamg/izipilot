import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { OkrManager } from "@/components/admin/OkrManager";

export default async function AdminOkrsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const [objectives, departments, products, users] = await Promise.all([
    prisma.objective.findMany({
      where: { orgId },
      include: {
        department: { select: { id: true, code: true, name: true, color: true } },
        product: { select: { id: true, code: true, name: true, color: true } },
        keyResults: {
          where: { isActive: true },
          include: {
            owner: { select: { id: true, name: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.product.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const activeCount = objectives.filter((o) => o.isActive).length;
  const krCount = objectives.reduce((sum, o) => sum + o.keyResults.length, 0);

  // Serialize Decimal fields for client component
  const serialized = objectives.map((o) => ({
    ...o,
    keyResults: o.keyResults.map((kr) => ({
      ...kr,
      score: Number(kr.score),
    })),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Objectifs & Key Results"
        subtitle={`${activeCount} objectif(s) \u00b7 ${krCount} KR(s) actif(s)`}
      />
      <OkrManager
        objectives={serialized}
        departments={departments}
        products={products}
        users={users}
      />
    </div>
  );
}
