import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { PushNudgeBanner } from "@/components/push/PushNudgeBanner";
import { SWRegister } from "@/components/pwa/SWRegister";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { getISOWeek } from "@/lib/date";
import { evaluatePushGate } from "@/lib/push-gate-server";
import { evaluateOneMember } from "@/lib/member-compliance-server";
import {
  alertVisibilityWhere,
  departmentVisibilityWhere,
  krVisibilityWhere,
} from "@/lib/visibility";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";

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

  // Obligation d'activer les notifications. Ici et pas dans le middleware : la
  // décision demande la base (sprint actif, abonnements), et le middleware
  // tourne sur l'edge sans accès à Prisma — même raison que la redirection PO.
  //
  // Deux protections contre l'accident : la clé VAPID absente laisse tout
  // passer (sinon un oubli de variable d'environnement enfermerait toute
  // l'organisation dehors), et une erreur de la porte n'empêche jamais
  // d'accéder à l'application.
  if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    let gate: Awaited<ReturnType<typeof evaluatePushGate>> = "OK";
    try {
      gate = await evaluatePushGate(orgId, userId, session.user.role);
    } catch {
      gate = "OK";
    }
    if (gate === "REQUIRED") redirect("/notifications-requises");
  }

  // Suivi des membres : une tâche en cours, et le rapport quotidien rempli.
  // Passe APRÈS la porte des notifications, pour qu'une personne concernée par
  // les deux règle d'abord celle qui ne dépend pas de l'heure.
  //
  // Même filet que ci-dessus : une erreur d'évaluation laisse passer. Un
  // manquement qu'on ne peut pas lever soi-même (aucune tâche assignée) n'est
  // jamais bloquant — cf. lib/member-compliance.ts.
  let blocked = false;
  try {
    blocked = (await evaluateOneMember(orgId, userId, session.user.role)).blocking;
  } catch {
    blocked = false;
  }
  if (blocked) redirect("/mon-point-du-jour");

  // Fetch sidebar data: products + departments with average scores
  const [products, departments, unresolvedAlertCount, myNotificationCount, accessRoles] = await Promise.all([
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
    getEffectiveRoleHolders(orgId, userId),
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

  const hasAnyAccessRole = accessRoles.length > 0 || session.user.role === "CEO";

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
      showAccessMenu={hasAnyAccessRole}
    >
      {vapidPublicKey && <PushNudgeBanner vapidPublicKey={vapidPublicKey} />}
      {children}
      <SWRegister />
      <InstallPrompt />
    </DashboardShell>
  );
}
