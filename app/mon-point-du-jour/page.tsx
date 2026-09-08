import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateOneMember } from "@/lib/member-compliance-server";
import { watDateOnly } from "@/lib/standup";
import { loadWorkflows, resolveWorkflowId } from "@/lib/board-column-server";
import { equivalentColumn } from "@/lib/board-column";
import { DailyCheckScreen } from "@/components/compliance/DailyCheckScreen";

export const dynamic = "force-dynamic";

/**
 * L'écran de mise à jour quotidienne. HORS du groupe (dashboard) : c'est son
 * layout qui redirige ici, l'y placer ferait une boucle.
 *
 * Il ne se contente PAS de constater le manquement : il embarque de quoi le
 * lever. Une porte qui dit « allez démarrer une tâche » tout en interdisant
 * l'accès au tableau n'aurait aucune issue.
 */
export default async function MonPointDuJourPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const state = await evaluateOneMember(orgId, session.user.id, session.user.role);
  if (!state.blocking || !state.sprintId) redirect("/dashboard");

  const needsTask = state.issues.includes("NO_ONGOING_TASK");
  const needsStandup = state.issues.includes("NO_STANDUP");

  // Les tâches qu'il peut démarrer, avec la colonne « en cours » de LEUR flux :
  // on envoie un columnId et non un statut brut, sinon la carte resterait
  // affichée dans « À faire » avec un statut qui dit le contraire.
  let startable: { id: string; title: string; columnId: string | null }[] = [];
  if (needsTask) {
    const [tasks, workflows] = await Promise.all([
      prisma.sprintTask.findMany({
        where: {
          orgId,
          sprintId: state.sprintId,
          assigneeId: session.user.id,
          status: { in: ["TODO", "BLOCKED"] },
        },
        select: {
          id: true,
          title: true,
          status: true,
          departmentId: true,
          productId: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      loadWorkflows(orgId),
    ]);
    const byId = new Map(workflows.map((w) => [w.id, w]));
    startable = await Promise.all(
      tasks.map(async (t) => {
        const wfId = await resolveWorkflowId(orgId, {
          departmentId: t.departmentId,
          productId: t.productId,
        });
        const col = equivalentColumn(byId.get(wfId)?.columns ?? [], "IN_PROGRESS");
        return { id: t.id, title: t.title, columnId: col?.id ?? null };
      })
    );
  }

  const mine = needsStandup
    ? await prisma.standupEntry.findFirst({
        where: {
          orgId,
          userId: session.user.id,
          sprintId: state.sprintId,
          date: watDateOnly(),
        },
        select: { yesterday: true, today: true, blockers: true },
      })
    : null;

  return (
    <DailyCheckScreen
      userName={session.user.name}
      sprintId={state.sprintId}
      needsTask={needsTask}
      needsStandup={needsStandup}
      startableTasks={startable}
      standup={mine}
    />
  );
}
