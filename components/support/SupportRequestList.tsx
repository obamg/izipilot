import Link from "next/link";
import type { SerializedSupportRequest } from "@/lib/support-request-serialize";
import { CategoryPill, OverduePill, PriorityPill, StatusPill } from "./SupportBadges";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Porto-Novo",
});

export function SupportRequestList({
  requests,
  emptyLabel = "Aucune demande.",
  /** Affiche le demandeur — utile côté file support, redondant côté « mes demandes ». */
  showRequester = false,
}: {
  requests: SerializedSupportRequest[];
  emptyLabel?: string;
  showRequester?: boolean;
}) {
  if (requests.length === 0) {
    return <p className="py-8 text-center text-[13px] text-izi-gray">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2 list-none p-0 m-0">
      {requests.map((r) => (
        <li key={r.id}>
          <Link
            href={`/support/${r.id}`}
            className="block rounded-[10px] border border-border-soft bg-white p-3.5 hover:border-teal-md transition-colors no-underline"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] tracking-[0.06em] text-izi-gray">
                  {r.reference}
                </div>
                <div className="text-[14px] font-medium text-dark truncate">{r.title}</div>
                <div className="mt-0.5 text-[11px] text-izi-gray">
                  {showRequester ? `${r.requester.name} · ` : ""}
                  {r.department.code}
                  {r.assignee ? ` · ${r.assignee.name}` : " · non assignée"}
                  {" · "}
                  {dateFmt.format(new Date(r.createdAt))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusPill status={r.status} />
                {r.isOverdue && <OverduePill />}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CategoryPill category={r.category} />
              <PriorityPill priority={r.priority} />
              {r.commentCount > 0 && (
                <span className="text-[11px] text-izi-gray">💬 {r.commentCount}</span>
              )}
              {r.attachmentCount > 0 && (
                <span className="text-[11px] text-izi-gray">📎 {r.attachmentCount}</span>
              )}
              {r.task && (
                <span className="text-[11px] text-teal-dk">→ tâche de sprint</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
