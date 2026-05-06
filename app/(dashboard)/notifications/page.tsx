import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { AlertSeverity, AlertSource, AlertType, KrStatus } from "@prisma/client";

const SEVERITY_COLORS: Record<
  AlertSeverity,
  { bg: string; text: string; label: string }
> = {
  CRITICAL: { bg: "var(--red-lt)", text: "var(--red)", label: "Critique" },
  HIGH: { bg: "var(--red-lt)", text: "#8b1a1a", label: "Haute" },
  MEDIUM: { bg: "var(--gold-lt)", text: "#7a5500", label: "Moyenne" },
  LOW: { bg: "var(--gray-lt)", text: "var(--gray)", label: "Basse" },
};

const TYPE_LABELS: Record<AlertType, string> = {
  KR_BLOCKED: "KR Bloqu\u00e9",
  KR_DECLINING: "KR en baisse",
  ENTRY_MISSING: "Revue manquante",
  ESCALATION_48H: "Escalade 48h",
  SCORE_BELOW_40: "Score < 40%",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getScopeReasons(args: {
  userId: string;
  krOwnerId: string;
  productOwnerId: string | null;
  departmentOwnerId: string | null;
}): string[] {
  const reasons: string[] = [];
  if (args.krOwnerId === args.userId) reasons.push("KR dont vous \u00eates responsable");
  if (args.productOwnerId === args.userId) reasons.push("Produit que vous pilotez");
  if (args.departmentOwnerId === args.userId) reasons.push("D\u00e9partement que vous dirigez");
  return reasons;
}

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const userId = session.user.id;

  const alerts = await prisma.alert.findMany({
    where: {
      orgId,
      OR: [
        { keyResult: { ownerId: userId } },
        { keyResult: { objective: { product: { ownerId: userId } } } },
        { keyResult: { objective: { department: { ownerId: userId } } } },
      ],
    },
    include: {
      keyResult: {
        select: {
          id: true,
          title: true,
          score: true,
          ownerId: true,
          objective: {
            select: {
              title: true,
              product: { select: { code: true, name: true, ownerId: true } },
              department: { select: { code: true, name: true, ownerId: true } },
            },
          },
        },
      },
      triggerer: { select: { name: true } },
      resolver: { select: { name: true } },
    },
    orderBy: [{ isResolved: "asc" }, { createdAt: "desc" }],
  });

  const data = alerts.map((a) => {
    const entity = a.keyResult.objective.product || a.keyResult.objective.department;
    const reasons = getScopeReasons({
      userId,
      krOwnerId: a.keyResult.ownerId,
      productOwnerId: a.keyResult.objective.product?.ownerId ?? null,
      departmentOwnerId: a.keyResult.objective.department?.ownerId ?? null,
    });
    return {
      id: a.id,
      type: a.type,
      severity: a.severity,
      source: a.source,
      message: a.message,
      isResolved: a.isResolved,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      resolution: a.resolution,
      krId: a.keyResult.id,
      krTitle: a.keyResult.title,
      krScore: Math.round(Number(a.keyResult.score) * 100),
      entityCode: entity?.code ?? "",
      entityName: entity?.name ?? "",
      triggeredByName: a.triggerer.name,
      resolvedByName: a.resolver?.name ?? null,
      reasons,
    };
  });

  const active = data.filter((a) => !a.isResolved);
  const resolved = data.filter((a) => a.isResolved);

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-[20px] text-dark">Mes notifications</h1>
        <p className="text-[11px] text-izi-gray mt-0.5">
          Alertes sur les KRs, produits et d&eacute;partements dont vous &ecirc;tes responsable
          &middot;{" "}
          <span className="font-medium text-dark-md">
            {active.length} active{active.length > 1 ? "s" : ""}
          </span>
        </p>
      </div>

      {data.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">
            Aucune notification &mdash; tout est en ordre sur votre p&eacute;rim&egrave;tre.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2 mb-6">
              {active.map((a) => (
                <NotificationCard key={a.id} alert={a} />
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <>
              <h2 className="text-[11px] font-semibold tracking-wide uppercase text-izi-gray mb-2 mt-4">
                R&eacute;solues ({resolved.length})
              </h2>
              <div className="space-y-2">
                {resolved.map((a) => (
                  <NotificationCard key={a.id} alert={a} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function NotificationCard({
  alert,
}: {
  alert: {
    id: string;
    type: AlertType;
    severity: AlertSeverity;
    source: AlertSource;
    message: string;
    isResolved: boolean;
    createdAt: string;
    resolution: string | null;
    krId: string;
    krTitle: string;
    krScore: number;
    entityCode: string;
    entityName: string;
    triggeredByName: string;
    resolvedByName: string | null;
    reasons: string[];
  };
}) {
  const sev = SEVERITY_COLORS[alert.severity];

  return (
    <Link
      href={`/kr/${alert.krId}`}
      className={`block bg-white rounded-[10px] border border-[#deeaea] p-4 hover:border-teal-md transition-colors no-underline ${
        alert.isResolved ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0 text-xs mt-0.5"
          style={{ backgroundColor: sev.text }}
        >
          {alert.severity === "CRITICAL" || alert.severity === "HIGH"
            ? "\uD83D\uDD34"
            : alert.severity === "MEDIUM"
            ? "\uD83D\uDFE1"
            : "\u26AA"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-dark">
              {alert.entityCode} &mdash; {alert.krTitle}
            </span>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium"
              style={{ backgroundColor: sev.bg, color: sev.text }}
            >
              {sev.label}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-izi-gray-lt text-izi-gray font-medium">
              {TYPE_LABELS[alert.type]}
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                alert.source === "MANUAL"
                  ? "bg-teal-lt text-teal-dk"
                  : "bg-izi-gray-lt text-izi-gray"
              }`}
            >
              {alert.source === "MANUAL" ? "Manuelle" : "Auto"}
            </span>
            {alert.isResolved && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-izi-green-lt text-izi-green font-medium">
                R&eacute;solu
              </span>
            )}
          </div>

          <p className="text-[11px] text-dark mt-1">{alert.message}</p>

          <div className="flex items-center gap-3 mt-1.5 text-[9px] text-izi-gray">
            <span>
              Score:{" "}
              <span className="font-mono font-semibold">{alert.krScore}%</span>
            </span>
            <span>&middot;</span>
            <span>{formatDate(alert.createdAt)}</span>
            {alert.resolvedByName && (
              <>
                <span>&middot;</span>
                <span>R&eacute;solu par {alert.resolvedByName}</span>
              </>
            )}
          </div>

          {alert.reasons.length > 0 && (
            <div className="text-[9px] text-teal-dk mt-1">
              {alert.reasons.join(" \u00b7 ")}
            </div>
          )}

          {alert.resolution && (
            <div className="mt-2 p-2 bg-izi-green-lt rounded text-[10px] text-dark">
              <span className="font-semibold">R&eacute;solution :</span>{" "}
              {alert.resolution}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
