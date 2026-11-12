// Écran « Exécution » (phase 3b, D-15) : tâches autorisées des actifs dont le
// lecteur est propriétaire/suppléant, leur historique, et la supervision en
// lecture seule pour CISO/COO. Hors portée → notFound(), comme le registre.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { FulfilmentTaskList } from "@/components/access/FulfilmentTaskList";
import { FulfilmentError } from "@/lib/access/fulfilment-server";
import { getFulfilmentNav, listFulfilmentTasks } from "@/lib/access/fulfilment-read-server";

const PAGE_SIZE = 25;

type Tab = "todo" | "history" | "oversight";

const TAB_LABELS: Record<Tab, string> = { todo: "À faire", history: "Historique", oversight: "Supervision" };

const EMPTY_MESSAGES: Record<Tab, string> = {
  todo: "Aucune tâche à exécuter pour l'instant.",
  history: "Aucune tâche terminée.",
  oversight: "Aucune tâche dans cette vue.",
};

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function FulfilmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, orgId } = session.user;

  const nav = await getFulfilmentNav(orgId, userId);
  if (!nav.hasMine && !nav.canOversee) notFound();

  const params = await searchParams;
  const tabs: Tab[] = [...(nav.hasMine ? (["todo", "history"] as Tab[]) : []), ...(nav.canOversee ? (["oversight"] as Tab[]) : [])];
  // Paramètre invalide ou onglet non autorisé → premier onglet autorisé.
  const requested = first(params.tab) as Tab | undefined;
  const tab: Tab = requested && tabs.includes(requested) ? requested : tabs[0];
  const oversightState = first(params.state) === "history" ? "history" : "open";
  const page = Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1);

  let result;
  try {
    result = await listFulfilmentTasks(
      { orgId, userId },
      {
        view: tab === "oversight" ? "oversight" : "mine",
        state: tab === "history" ? "history" : tab === "oversight" ? oversightState : "open",
        page,
        pageSize: PAGE_SIZE,
      }
    );
  } catch (err) {
    if (err instanceof FulfilmentError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hrefFor = (p: number) => {
    const q = new URLSearchParams({ tab });
    if (tab === "oversight" && oversightState === "history") q.set("state", "history");
    if (p > 1) q.set("page", String(p));
    return `/access/fulfilment?${q.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Exécution"
        subtitle={`${result.total} tâche${result.total > 1 ? "s" : ""} · ${TAB_LABELS[tab].toLowerCase()}`}
      />

      <nav aria-label="Vues des tâches d'exécution" className="mb-3 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/access/fulfilment?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-[8px] px-3 py-2 text-[13px] font-medium no-underline ${
              t === tab ? "bg-teal text-white" : "border border-border-soft bg-white text-dark hover:bg-teal-lt"
            }`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {tab === "oversight" && (
        <div className="mb-3 flex gap-3 text-[13px]">
          <Link
            href="/access/fulfilment?tab=oversight"
            aria-current={oversightState === "open" ? "page" : undefined}
            className={oversightState === "open" ? "font-semibold text-dark" : "text-teal-dk"}
          >
            Ouvertes
          </Link>
          <Link
            href="/access/fulfilment?tab=oversight&state=history"
            aria-current={oversightState === "history" ? "page" : undefined}
            className={oversightState === "history" ? "font-semibold text-dark" : "text-teal-dk"}
          >
            Terminées
          </Link>
          <span className="text-izi-gray">Lecture seule</span>
        </div>
      )}

      <FulfilmentTaskList
        rows={result.rows}
        readOnly={tab === "oversight"}
        selectable={tab === "todo"}
        emptyMessage={EMPTY_MESSAGES[tab]}
      />

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px]">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className="text-teal-dk">
              ← Précédent
            </Link>
          ) : (
            <span />
          )}
          <span className="font-mono text-izi-gray">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={hrefFor(page + 1)} className="text-teal-dk">
              Suivant →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
