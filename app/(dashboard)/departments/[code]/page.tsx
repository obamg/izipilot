import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { EntityDetailView, type EntityDetailData } from "@/components/entity/EntityDetailView";

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { code } = await params;
  const orgId = session.user.orgId;

  const [department, orgUsers] = await Promise.all([
    prisma.department.findFirst({
      where: { orgId, code },
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
                    assignee: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!department) notFound();

  const objectives = department.objectives.map((obj) => {
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

  const actions = department.objectives.flatMap((obj) =>
    obj.keyResults.flatMap((kr) =>
      kr.actions.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        status: a.status,
        priority: a.priority,
        assigneeId: a.assignee.id,
        assigneeName: a.assignee.name,
        dueDate: a.dueDate?.toISOString() ?? null,
        krTitle: kr.title,
      }))
    )
  );

  const data: EntityDetailData = {
    code: department.code,
    name: department.name,
    color: department.color,
    type: "DEPARTMENT",
    avgScore,
    objectives,
    actions,
  };

  return (
    <EntityDetailView
      entity={data}
      users={orgUsers}
      currentUserRole={session.user.role}
    />
  );
}
