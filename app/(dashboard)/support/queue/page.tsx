import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isSupportAdmin,
  supportedDepartmentIds,
  supportRequestInclude,
} from "@/lib/support-request-server";
import { serializeSupportRequest } from "@/lib/support-request-serialize";
import {
  OPEN_STATUSES,
  SUPPORT_CATEGORY_META,
  SUPPORT_PRIORITY_META,
  SUPPORT_STATUS_META,
  computeStats,
  formatHours,
} from "@/lib/support-request";
import { supportQueueFilterSchema } from "@/lib/validations/support-request";
import { SupportRequestList } from "@/components/support/SupportRequestList";

export const dynamic = "force-dynamic";

/** File de traitement du guichet — réservée aux personnes qui la tiennent. */
export default async function SupportQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const viewer = {
    id: session.user.id,
    orgId: session.user.orgId,
    role: session.user.role,
  };

  const admin = isSupportAdmin(viewer.role);
  const supported = await supportedDepartmentIds(viewer);
  if (viewer.role === "VIEWER" || (!admin && supported.length === 0)) {
    redirect("/support");
  }

  const raw = await searchParams;
  const parsed = supportQueueFilterSchema.safeParse({
    status: pick(raw.status) ?? undefined,
    category: pick(raw.category) ?? undefined,
    priority: pick(raw.priority) ?? undefined,
    assignee: pick(raw.assignee) ?? undefined,
    q: pick(raw.q) ?? undefined,
  });
  // Un filtre invalide (URL bricolée) retombe sur la vue par défaut plutôt que
  // de faire planter la page.
  const filter = parsed.success ? parsed.data : supportQueueFilterSchema.parse({});

  const scope: Prisma.SupportRequestWhereInput = admin
    ? { orgId: viewer.orgId }
    : { orgId: viewer.orgId, departmentId: { in: supported } };

  const where: Prisma.SupportRequestWhereInput = {
    ...scope,
    ...(filter.status === "OPEN"
      ? { status: { in: [...OPEN_STATUSES] } }
      : filter.status === "ALL"
        ? {}
        : { status: filter.status }),
    ...(filter.category === "ALL" ? {} : { category: filter.category }),
    ...(filter.priority === "ALL" ? {} : { priority: filter.priority }),
    ...(filter.assignee === "ALL"
      ? {}
      : filter.assignee === "me"
        ? { assigneeId: viewer.id }
        : filter.assignee === "none"
          ? { assigneeId: null }
          : { assigneeId: filter.assignee }),
    ...(filter.q
      ? {
          OR: [
            { title: { contains: filter.q, mode: "insensitive" } },
            { reference: { contains: filter.q, mode: "insensitive" } },
            { description: { contains: filter.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [requests, statsRows] = await Promise.all([
    prisma.supportRequest.findMany({
      where,
      include: supportRequestInclude,
      // Urgentes d'abord, puis les plus anciennes : c'est l'ordre de traitement.
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 200,
    }),
    // Les stats couvrent tout le périmètre, indépendamment des filtres — sinon
    // le taux de retard change en cliquant sur un filtre, ce qui n'a aucun sens.
    prisma.supportRequest.findMany({
      where: scope,
      select: {
        status: true,
        priority: true,
        category: true,
        assigneeId: true,
        dueAt: true,
        createdAt: true,
        firstResponseAt: true,
        resolvedAt: true,
      },
    }),
  ]);

  const now = new Date();
  const stats = computeStats(statsRows, now);
  const serialized = requests.map((r) => serializeSupportRequest(r, now));

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[24px] text-dark">File du support</h1>
          <p className="mt-0.5 text-[13px] text-izi-gray">
            {admin
              ? "Toutes les demandes internes de l'organisation."
              : "Les demandes adressées à votre guichet."}
          </p>
        </div>
        <Link
          href="/support"
          className="shrink-0 text-[13px] text-izi-gray hover:text-dark no-underline"
        >
          Mes demandes →
        </Link>
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="En cours" value={String(stats.open)} />
        <Kpi
          label="En retard"
          value={String(stats.overdue)}
          tone={stats.overdue > 0 ? "red" : undefined}
        />
        <Kpi label="Non assignées" value={String(stats.unassigned)} />
        <Kpi label="Délai moyen" value={formatHours(stats.avgResolutionHours)} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-[10px] border border-border-soft bg-white p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
            Par type
          </h2>
          {stats.byCategory.length === 0 ? (
            <p className="text-[13px] text-izi-gray">Aucune donnée.</p>
          ) : (
            <Bars
              rows={stats.byCategory.map((c) => ({
                label: SUPPORT_CATEGORY_META[c.category].label,
                count: c.count,
                color: "var(--teal)",
              }))}
              total={stats.total}
            />
          )}
        </div>
        <div className="rounded-[10px] border border-border-soft bg-white p-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
            Par priorité
          </h2>
          {stats.byPriority.length === 0 ? (
            <p className="text-[13px] text-izi-gray">Aucune donnée.</p>
          ) : (
            <Bars
              rows={stats.byPriority.map((p) => ({
                label: SUPPORT_PRIORITY_META[p.priority].label,
                count: p.count,
                color: SUPPORT_PRIORITY_META[p.priority].color,
              }))}
              total={stats.total}
            />
          )}
          <p className="mt-2 text-[11px] text-izi-gray">
            Première réponse : {formatHours(stats.avgFirstResponseHours)} en moyenne
          </p>
        </div>
      </div>

      {/* ── Filtres (formulaire GET — aucun JS requis) ───────────── */}
      <form method="get" className="rounded-[10px] border border-border-soft bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <Select name="status" label="Statut" value={filter.status}>
            <option value="OPEN">En cours</option>
            <option value="ALL">Toutes</option>
            {Object.entries(SUPPORT_STATUS_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </Select>
          <Select name="category" label="Type" value={filter.category}>
            <option value="ALL">Tous</option>
            {Object.entries(SUPPORT_CATEGORY_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </Select>
          <Select name="priority" label="Priorité" value={filter.priority}>
            <option value="ALL">Toutes</option>
            {Object.entries(SUPPORT_PRIORITY_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </Select>
          <Select name="assignee" label="Assignée à" value={filter.assignee}>
            <option value="ALL">Tout le monde</option>
            <option value="me">Moi</option>
            <option value="none">Personne</option>
          </Select>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder="Rechercher (référence, objet, description)…"
            className="flex-1 rounded-[8px] border border-border-soft px-3 py-2 text-[13px] text-dark focus:outline-none focus:border-teal"
            aria-label="Rechercher une demande"
          />
          <button
            type="submit"
            className="rounded-[8px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors"
          >
            Filtrer
          </button>
        </div>
      </form>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
          {serialized.length} demande{serialized.length > 1 ? "s" : ""}
          {requests.length === 200 ? " (200 premières)" : ""}
        </h2>
        <SupportRequestList
          requests={serialized}
          showRequester
          emptyLabel="Aucune demande ne correspond à ces filtres."
        />
      </section>
    </div>
  );
}

function pick(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
        {label}
      </div>
      <div
        className="font-mono text-[24px] font-bold tabular-nums"
        style={{ color: tone === "red" ? "var(--red)" : "var(--dark)" }}
      >
        {value}
      </div>
    </div>
  );
}

function Bars({
  rows,
  total,
}: {
  rows: Array<{ label: string; count: number; color: string }>;
  total: number;
}) {
  return (
    <ul className="space-y-1.5 list-none p-0 m-0">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="w-[110px] shrink-0 truncate text-[12px] text-dark-md">{r.label}</span>
          <span className="h-2 flex-1 rounded-full bg-gray-lt">
            <span
              className="block h-2 rounded-full"
              style={{
                width: total > 0 ? `${Math.round((r.count / total) * 100)}%` : "0%",
                backgroundColor: r.color,
              }}
            />
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-[12px] tabular-nums text-dark">
            {r.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Select({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="w-full rounded-[8px] border border-border-soft bg-white px-2 py-2 text-[13px] text-dark focus:outline-none focus:border-teal"
      >
        {children}
      </select>
    </label>
  );
}
