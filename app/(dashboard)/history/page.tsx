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

  // The chart shows 13 weeks. Loading every entry ever ballooned to ~7,000
  // rows on a fully-seeded year — pre-filter to the last 13 ISO weeks via
  // weekStart so the page stays fast as data accumulates.
  const thirteenWeeksAgo = new Date();
  thirteenWeeksAgo.setDate(thirteenWeeksAgo.getDate() - 13 * 7);

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
        where: { weekStart: { gte: thirteenWeeksAgo } },
        // Year first so S52/2025 sorts before S03/2026.
        orderBy: [{ year: "asc" }, { weekNumber: "asc" }],
        select: {
          weekNumber: true,
          year: true,
          scoreAtEntry: true,
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
      year: e.year,
      weekNumber: e.weekNumber,
      // The chart shows the persisted OKR score (currentValue/target or the
      // krType-specific formula), not the raw slider position. Using
      // `progress` here caused the line to disagree with the donut on the
      // same KR for BINARY/DATE types.
      score: Math.round(Number(e.scoreAtEntry) * 100),
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
