import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { EntityDetailView, type EntityDetailData } from "@/components/entity/EntityDetailView";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { code } = await params;
  const orgId = session.user.orgId;

  const product = await prisma.product.findFirst({
    where: { orgId, code, isActive: true },
    include: {
      objectives: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        include: {
          keyResults: {
            where: { isActive: true, deletedAt: null },
            orderBy: { sortOrder: "asc" },
            include: {
              owner: { select: { name: true } },
              actions: {
                orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
                include: {
                  assignee: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!product) notFound();

  const objectives = product.objectives.map((obj) => {
    const krs = obj.keyResults.map((kr) => ({
      id: kr.id,
      title: kr.title,
      score: Math.round(Number(kr.score) * 100),
      status: kr.status,
      ownerName: kr.owner.name,
    }));
    const avgScore =
      krs.length > 0
        ? Math.round(krs.reduce((a, b) => a + b.score, 0) / krs.length)
        : 0;
    return { id: obj.id, title: obj.title, krs, avgScore };
  });

  const allKrScores = objectives.flatMap((o) => o.krs.map((k) => k.score));
  const avgScore =
    allKrScores.length > 0
      ? Math.round(allKrScores.reduce((a, b) => a + b, 0) / allKrScores.length)
      : 0;

  const actions = product.objectives.flatMap((obj) =>
    obj.keyResults.flatMap((kr) =>
      kr.actions.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        priority: a.priority,
        assigneeName: a.assignee.name,
        dueDate: a.dueDate?.toISOString() ?? null,
        krId: kr.id,
        krTitle: kr.title,
      }))
    )
  );

  const data: EntityDetailData = {
    code: product.code,
    name: product.name,
    color: product.color,
    type: "PRODUCT",
    avgScore,
    objectives,
    actions,
  };

  return <EntityDetailView entity={data} />;
}
