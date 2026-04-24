import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { HistoryChart } from "./HistoryChart";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const { entity: entityCode } = await searchParams;

  // Fetch all products and departments for the selector
  const [products, departments] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true, color: true },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true, color: true },
    }),
  ]);

  // Fetch all KRs with their weekly entries for charting
  const keyResults = await prisma.keyResult.findMany({
    where: { orgId, isActive: true },
    include: {
      objective: {
        select: {
          id: true,
          title: true,
          entityType: true,
          productId: true,
          departmentId: true,
        },
      },
      weeklyEntries: {
        orderBy: { weekNumber: "asc" },
        select: {
          weekNumber: true,
          year: true,
          scoreAtEntry: true,
          progress: true,
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const entities = [
    ...products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      color: p.color,
      type: "PRODUCT" as const,
    })),
    ...departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      color: d.color,
      type: "DEPARTMENT" as const,
    })),
  ];

  const krData = keyResults.map((kr) => ({
    id: kr.id,
    title: kr.title,
    entityId: kr.objective.productId || kr.objective.departmentId || "",
    entityType: kr.objective.entityType,
    objectiveTitle: kr.objective.title,
    weeklyData: kr.weeklyEntries.map((e) => ({
      week: `S${String(e.weekNumber).padStart(2, "0")}`,
      score: Math.round(Number(e.scoreAtEntry) * 100),
      progress: Math.round(e.progress * 100),
    })),
  }));

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-[20px] text-dark">
          Historique &amp; courbes
        </h1>
        <p className="text-[11px] text-izi-gray mt-0.5">
          Progression sur 13 semaines par produit, d&eacute;partement ou KR
        </p>
      </div>

      <HistoryChart
        entities={entities}
        keyResults={krData}
        defaultEntityCode={entityCode}
      />
    </div>
  );
}
