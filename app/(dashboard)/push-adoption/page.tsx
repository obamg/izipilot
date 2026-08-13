import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<UserRole, string> = {
  CEO: "CEO",
  MANAGEMENT: "Management",
  PO: "PO",
  CONTRIBUTOR: "Contributeur",
  VIEWER: "Viewer",
};
const ROLE_ORDER: UserRole[] = ["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR", "VIEWER"];

function rateColor(pct: number): string {
  if (pct >= 70) return "var(--green)";
  if (pct >= 40) return "var(--gold)";
  if (pct > 0) return "var(--red)";
  return "var(--gray)";
}

export default async function PushAdoptionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (role !== "CEO" && role !== "MANAGEMENT") redirect("/dashboard");

  const orgId = session.user.orgId;

  const [activeSprints, users, subs] = await Promise.all([
    prisma.sprint.findMany({
      where: { orgId, status: "ACTIVE" },
      select: {
        tasks: { select: { assigneeId: true } },
        capacities: { select: { userId: true } },
      },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.pushSubscription.findMany({
      where: { orgId },
      select: { userId: true },
    }),
  ]);

  // Users expected to file a daily report: assignees + capacity members of any
  // ACTIVE sprint, excluding VIEWERs (read-only) — mirrors the reminder cron.
  const eligibleIds = new Set<string>();
  for (const s of activeSprints) {
    for (const t of s.tasks) if (t.assigneeId) eligibleIds.add(t.assigneeId);
    for (const c of s.capacities) eligibleIds.add(c.userId);
  }

  const subUserIds = new Set(subs.map((s) => s.userId));
  const totalDevices = subs.length;

  const eligible = users.filter((u) => eligibleIds.has(u.id) && u.role !== "VIEWER");
  const eligibleWithPush = eligible.filter((u) => subUserIds.has(u.id));
  const eligibleWithout = eligible.filter((u) => !subUserIds.has(u.id));
  const eligiblePct =
    eligible.length > 0 ? Math.round((eligibleWithPush.length / eligible.length) * 100) : 0;

  const usersWithPush = users.filter((u) => subUserIds.has(u.id)).length;

  // Per-role adoption across all active users.
  const byRole = ROLE_ORDER.map((r) => {
    const total = users.filter((u) => u.role === r).length;
    const withPush = users.filter((u) => u.role === r && subUserIds.has(u.id)).length;
    return { role: r, total, withPush, pct: total > 0 ? Math.round((withPush / total) * 100) : 0 };
  }).filter((r) => r.total > 0);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-serif text-[24px] text-dark">Adoption des notifications</h1>
        <p className="text-[13px] text-izi-gray mt-0.5">
          Le rappel de rapport quotidien est envoyé <strong>uniquement par
          notification push</strong> (sans email). Cette page suit combien de
          personnes l&apos;ont activée. Elle se met à jour à chaque visite.
        </p>
      </div>

      {/* Hero — daily-report participants */}
      <div className="bg-white rounded-[10px] border border-border-soft p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray mb-2">
          Participants du rapport quotidien
        </div>
        <div className="flex items-end gap-3">
          <span
            className="font-mono text-[40px] font-bold leading-none tabular-nums"
            style={{ color: rateColor(eligiblePct) }}
          >
            {eligiblePct}%
          </span>
          <span className="text-[15px] text-dark mb-1">
            {eligibleWithPush.length} / {eligible.length} ont activé les notifications
          </span>
        </div>
        <div className="mt-3 h-2.5 w-full rounded-full bg-gray-lt overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${eligiblePct}%`, backgroundColor: rateColor(eligiblePct) }}
          />
        </div>
        <p className="text-[11px] text-izi-gray mt-2">
          {eligibleWithout.length === 0
            ? "Toute l'équipe est couverte 🎉"
            : `${eligibleWithout.length} personne(s) ne recevront pas encore le rappel push.`}
        </p>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Appareils enregistrés" value={totalDevices} />
        <StatCard label="Utilisateurs avec push" value={usersWithPush} />
        <StatCard label="Utilisateurs actifs" value={users.length} muted />
      </div>

      {/* By role */}
      <div className="bg-white rounded-[10px] border border-border-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
          Par rôle
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-izi-gray text-left">
              <th className="font-medium px-4 py-2">Rôle</th>
              <th className="font-medium px-4 py-2 text-right">Activés</th>
              <th className="font-medium px-4 py-2 text-right">Total</th>
              <th className="font-medium px-4 py-2 text-right">Taux</th>
            </tr>
          </thead>
          <tbody>
            {byRole.map((r) => (
              <tr key={r.role} className="border-t border-border-soft">
                <td className="px-4 py-2 text-dark">{ROLE_LABELS[r.role]}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-dark">{r.withPush}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-izi-gray">{r.total}</td>
                <td
                  className="px-4 py-2 text-right font-mono tabular-nums font-semibold"
                  style={{ color: rateColor(r.pct) }}
                >
                  {r.pct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Who hasn't enabled */}
      {eligibleWithout.length > 0 && (
        <div className="bg-white rounded-[10px] border border-border-soft p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray mb-2">
            Participants sans notifications ({eligibleWithout.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {eligibleWithout.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-gray-lt px-2.5 py-1 text-[12px] text-dark"
              >
                {u.name}
                <span className="text-[10px] text-izi-gray">{ROLE_LABELS[u.role]}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] text-izi-gray mt-3">
            Ces personnes peuvent activer les notifications depuis{" "}
            <Link href="/settings/notifications" className="text-teal hover:text-teal-dk font-medium">
              Paramètres → Notifications
            </Link>{" "}
            (une bannière les y invite aussi). Sur iPhone, l&apos;app doit
            d&apos;abord être ajoutée à l&apos;écran d&apos;accueil.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="bg-white rounded-[10px] border border-border-soft p-4">
      <div
        className={`font-mono text-[24px] font-bold tabular-nums ${muted ? "text-izi-gray" : "text-dark"}`}
      >
        {value}
      </div>
      <div className="text-[11px] text-izi-gray mt-0.5">{label}</div>
    </div>
  );
}
