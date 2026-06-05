import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { PushPermissionModal } from "@/components/push/PushPermissionModal";
import { getISOWeek } from "@/lib/date";
import {
  alertVisibilityWhere,
  departmentVisibilityWhere,
  krVisibilityWhere,
} from "@/lib/visibility";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { weekNumber, year } = getISOWeek(new Date());
  const orgId = session.user.orgId;
  const userId = session.user.id;

  // Fetch sidebar data: products + departments with average scores
  const [products, departments, unresolvedAlertCount, myNotificationCount] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        objectives: {
          where: { isActive: true },
          include: {
            keyResults: {
              where: { isActive: true },
              select: { score: true },
            },
          },
        },
      },
    }),
    prisma.department.findMany({
      where: {
        orgId,
        isActive: true,
        ...departmentVisibilityWhere(session.user.role),
      },
      orderBy: { sortOrder: "asc" },
      include: {
        objectives: {
          where: { isActive: true },
          include: {
            keyResults: {
              where: { isActive: true, ...krVisibilityWhere(session.user.role) },
              select: { score: true },
            },
          },
        },
      },
    }),
    prisma.alert.count({
      where: { orgId, isResolved: false, ...alertVisibilityWhere(session.user.role) },
    }),
    prisma.alert.count({
      where: {
        orgId,
        isResolved: false,
        OR: [
          { keyResult: { ownerId: userId } },
          { keyResult: { objective: { product: { ownerId: userId } } } },
          { keyResult: { objective: { department: { ownerId: userId } } } },
        ],
        ...alertVisibilityWhere(session.user.role),
      },
    }),
  ]);

  // Compute average score for each entity
  function computeAvgScore(
    objectives: { keyResults: { score: unknown }[] }[]
  ): number {
    const allScores = objectives.flatMap((o) =>
      o.keyResults.map((kr) => Number(kr.score))
    );
    if (allScores.length === 0) return 0;
    const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    return Math.round(avg * 100);
  }

  const sidebarProducts = products.map((p) => ({
    code: p.code,
    name: p.name,
    color: p.color,
    scorePercent: computeAvgScore(p.objectives),
  }));

  const sidebarDepartments = departments.map((d) => ({
    code: d.code,
    name: d.name,
    color: d.color,
    scorePercent: computeAvgScore(d.objectives),
  }));

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <DashboardShell
      userName={session.user.name}
      userRole={session.user.role}
      weekNumber={weekNumber}
      year={year}
      alertCount={unresolvedAlertCount}
      notificationCount={myNotificationCount}
      products={sidebarProducts}
      departments={sidebarDepartments}
    >
      {children}
      {vapidPublicKey && <PushPermissionModal vapidPublicKey={vapidPublicKey} />}
    </DashboardShell>
  );
}
