import Link from "next/link";
import { KrProgressBar } from "@/components/ui/KrProgressBar";
import { ActionStatusBadge } from "@/components/ui/ActionStatusBadge";
import { ActionPriorityBadge } from "@/components/ui/ActionPriorityBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { ActionStatus, ActionPriority, KrStatus } from "@prisma/client";

interface ActionItem {
  id: string;
  title: string;
  status: ActionStatus;
  priority: ActionPriority;
  assigneeName: string;
  dueDate: string | null;
  krId: string;
  krTitle: string;
}

interface KrItem {
  id: string;
  title: string;
  score: number;
  status: KrStatus;
  ownerName: string;
}

interface ObjectiveItem {
  id: string;
  title: string;
  krs: KrItem[];
  avgScore: number;
}

export interface EntityDetailData {
  code: string;
  name: string;
  color: string;
  type: "PRODUCT" | "DEPARTMENT";
  avgScore: number;
  objectives: ObjectiveItem[];
  actions: ActionItem[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export function EntityDetailView({ entity }: { entity: EntityDetailData }) {
  const openActions = entity.actions.filter(
    (a) => a.status !== "DONE" && a.status !== "CANCELLED"
  );
  const closedActions = entity.actions.filter(
    (a) => a.status === "DONE" || a.status === "CANCELLED"
  );

  const typeLabel = entity.type === "PRODUCT" ? "Produit" : "Département";
  const backHref = "/dashboard";

  const scoreColor =
    entity.avgScore >= 70
      ? "var(--green)"
      : entity.avgScore >= 40
      ? "var(--gold)"
      : "var(--red)";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-[11px] text-izi-gray mb-2">
        <Link href={backHref} className="hover:text-teal no-underline">
          Dashboard
        </Link>
        <span className="mx-1.5">/</span>
        <span>{typeLabel}s</span>
        <span className="mx-1.5">/</span>
        <span className="text-dark font-medium">{entity.code}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5 mb-4">
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-sm font-semibold px-2.5 py-1 rounded"
            style={{ backgroundColor: entity.color + "20", color: entity.color }}
          >
            {entity.code}
          </span>
          <h1 className="font-serif text-2xl text-dark flex-1">{entity.name}</h1>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-izi-gray font-semibold">
              Score moyen
            </div>
            <div
              className="font-mono text-2xl font-bold"
              style={{ color: scoreColor }}
            >
              {entity.avgScore}%
            </div>
          </div>
        </div>
      </div>

      {/* Objectives + KRs */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5 mb-4">
        <h2 className="text-base font-semibold text-dark mb-4">Objectifs &amp; KRs</h2>
        {entity.objectives.length === 0 && (
          <p className="text-sm text-izi-gray py-4">Aucun objectif d&eacute;fini.</p>
        )}
        {entity.objectives.map((obj, i) => (
          <div
            key={obj.id}
            className={`mb-5 pb-5 ${
              i < entity.objectives.length - 1 ? "border-b border-izi-gray-lt" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-dark flex-1">{obj.title}</h3>
              <span
                className="font-mono text-sm font-bold ml-3"
                style={{
                  color:
                    obj.avgScore >= 70
                      ? "var(--green)"
                      : obj.avgScore >= 40
                      ? "var(--gold)"
                      : "var(--red)",
                }}
              >
                {obj.avgScore}%
              </span>
            </div>
            <div className="space-y-1">
              {obj.krs.map((kr) => (
                <Link
                  key={kr.id}
                  href={`/kr/${kr.id}`}
                  className="block px-2 py-1.5 rounded hover:bg-izi-gray-lt no-underline transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <KrProgressBar
                        score={Math.round(kr.score)}
                        label={kr.title}
                        className="py-0"
                      />
                    </div>
                    <StatusBadge status={kr.status} />
                  </div>
                  <div className="text-[10px] text-izi-gray mt-0.5 ml-1">
                    Resp. {kr.ownerName}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl border border-[#deeaea] p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-dark">Actions</h2>
            <p className="text-sm text-izi-gray mt-0.5">
              {openActions.length} ouverte{openActions.length > 1 ? "s" : ""} &middot;{" "}
              {closedActions.length} ferm&eacute;e{closedActions.length > 1 ? "s" : ""}
            </p>
          </div>
          <Link
            href="/actions"
            className="text-[11px] text-teal hover:text-teal-dk no-underline font-medium"
          >
            Voir toutes &rarr;
          </Link>
        </div>

        {entity.actions.length === 0 && (
          <p className="text-sm text-izi-gray py-4">Aucune action sur ce p&eacute;rim&egrave;tre.</p>
        )}

        {openActions.length > 0 && (
          <div className="space-y-1.5">
            {openActions.slice(0, 10).map((a) => {
              const isOverdue =
                a.dueDate && new Date(a.dueDate) < new Date();
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#deeaea] hover:border-teal-md transition-colors"
                >
                  <ActionStatusBadge status={a.status} />
                  <ActionPriorityBadge priority={a.priority} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-dark truncate">
                      {a.title}
                    </div>
                    <div className="text-[10px] text-izi-gray truncate">
                      {a.krTitle} &middot; Assign&eacute; &agrave; {a.assigneeName}
                    </div>
                  </div>
                  {a.dueDate && (
                    <div
                      className={`text-[10px] font-medium shrink-0 ${
                        isOverdue ? "text-red" : "text-izi-gray"
                      }`}
                    >
                      {formatDate(a.dueDate)}
                    </div>
                  )}
                </div>
              );
            })}
            {openActions.length > 10 && (
              <div className="text-[11px] text-izi-gray text-center pt-2">
                + {openActions.length - 10} autre{openActions.length - 10 > 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
