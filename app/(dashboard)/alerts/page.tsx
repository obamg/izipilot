import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AlertsList } from "./AlertsList";
import type { AlertSeverity, AlertType } from "@prisma/client";

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const userRole = session.user.role;

  const isOwnerScoped = userRole === "PO" || userRole === "MANAGEMENT";

  const alerts = await prisma.alert.findMany({
    where: {
      orgId,
      ...(isOwnerScoped && {
        keyResult: { ownerId: session.user.id },
      }),
    },
    include: {
      keyResult: {
        select: {
          id: true,
          title: true,
          status: true,
          score: true,
          objective: {
            select: {
              title: true,
              product: { select: { code: true, name: true } },
              department: { select: { code: true, name: true } },
            },
          },
          weeklyEntries: {
            where: { status: "BLOCKED" },
            orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
            take: 1,
            select: {
              blocker: true,
              proposedSolution: true,
              actionNeeded: true,
              comment: true,
              weekNumber: true,
              year: true,
              submittedAt: true,
            },
          },
        },
      },
      triggerer: { select: { name: true } },
      resolver: { select: { name: true } },
    },
    orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }],
  });

  const alertData = alerts.map((a) => {
    const entity =
      a.keyResult.objective.product || a.keyResult.objective.department;
    const latestBlockedEntry = a.keyResult.weeklyEntries[0];
    return {
      id: a.id,
      type: a.type,
      severity: a.severity,
      message: a.message,
      isResolved: a.isResolved,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      resolution: a.resolution,
      krTitle: a.keyResult.title,
      krScore: Math.round(Number(a.keyResult.score) * 100),
      krStatus: a.keyResult.status,
      entityCode: entity?.code ?? "",
      entityName: entity?.name ?? "",
      triggeredByName: a.triggerer.name,
      resolvedByName: a.resolver?.name ?? null,
      poNotes: latestBlockedEntry
        ? {
            blocker: latestBlockedEntry.blocker,
            proposedSolution: latestBlockedEntry.proposedSolution,
            actionNeeded: latestBlockedEntry.actionNeeded,
            comment: latestBlockedEntry.comment,
            weekNumber: latestBlockedEntry.weekNumber,
            year: latestBlockedEntry.year,
          }
        : null,
    };
  });

  const canResolve = ["CEO", "MANAGEMENT"].includes(userRole);

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-[20px] text-dark">
          Alertes &amp; d&eacute;cisions
        </h1>
        <p className="text-[11px] text-izi-gray mt-0.5">
          {alerts.filter((a) => !a.isResolved).length} alerte(s) active(s)
        </p>
      </div>

      <AlertsList alerts={alertData} canResolve={canResolve} />
    </div>
  );
}
