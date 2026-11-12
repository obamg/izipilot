import Link from "next/link";
import type { ReactNode } from "react";
import type { AssignmentRowDTO } from "@/lib/access/register-server";
import { formatPeriod } from "@/lib/access/register";

interface AssignmentsTableProps {
  rows: AssignmentRowDTO[];
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  baseQuery: Record<string, string>;
  showEmployee: boolean;
  showDepartment: boolean;
  groupBy: "employee" | "asset" | null;
  emptyMessage: string;
}

const SOURCE_LABEL: Record<AssignmentRowDTO["source"], string> = {
  LEGACY_IMPORT: "Import",
  REQUEST: "Demande",
};

const LIFECYCLE_SUFFIX: Record<string, string> = {
  OFFBOARDING: " — départ en cours",
  DEPARTED: " — parti",
};

function pageHref(basePath: string, baseQuery: Record<string, string>, page: number) {
  const params = new URLSearchParams(baseQuery);
  params.set("page", String(page));
  return `${basePath}?${params.toString()}`;
}

function Badge({ children, tone }: { children: ReactNode; tone: "gray" | "gold" | "red" }) {
  // Texte sombre sur fond blanc ou gris clair : jamais gold sur gold-lt (WCAG, CLAUDE.md).
  const cls = {
    gray: "bg-izi-gray-lt text-izi-gray border-border-soft",
    gold: "bg-white text-dark-md border-gold",
    red: "bg-white text-dark-md border-izi-red",
  }[tone];
  return (
    <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function AssignmentsTable({
  rows,
  total,
  page,
  pageSize,
  basePath,
  baseQuery,
  showEmployee,
  showDepartment,
  groupBy,
  emptyMessage,
}: AssignmentsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = 4 + (showEmployee ? 1 : 0) + (showDepartment ? 1 : 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
        {emptyMessage}
      </div>
    );
  }

  let previousGroup: string | null = null;

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] border border-border-soft bg-white overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border-soft text-izi-gray text-left">
              {showEmployee && <th className="px-4 py-2 font-medium">Employé</th>}
              {showDepartment && <th className="px-4 py-2 font-medium">Département</th>}
              <th className="px-4 py-2 font-medium">Application</th>
              <th className="px-4 py-2 font-medium">Niveau</th>
              <th className="px-4 py-2 font-medium">Période</th>
              <th className="px-4 py-2 font-medium">Provenance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const groupKey = groupBy === "employee" ? r.userId : groupBy === "asset" ? r.assetId : null;
              const groupLabel =
                groupBy === "employee"
                  ? `${r.userName}${r.lifecycle ? LIFECYCLE_SUFFIX[r.lifecycle] ?? "" : ""}`
                  : r.assetName;
              const groupHeader = groupKey !== null && groupKey !== previousGroup ? groupLabel : null;
              // eslint-disable-next-line react-hooks/immutability
              previousGroup = groupKey;
              return (
                <AssignmentRow
                  key={r.id}
                  row={r}
                  groupHeader={groupHeader}
                  columnCount={columnCount}
                  showEmployee={showEmployee}
                  showDepartment={showDepartment}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2 text-[11px]">
          {page > 1 && (
            <Link href={pageHref(basePath, baseQuery, page - 1)} className="text-teal hover:text-teal-dk">
              Précédent
            </Link>
          )}
          <span className="text-izi-gray">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageHref(basePath, baseQuery, page + 1)} className="text-teal hover:text-teal-dk">
              Suivant
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function AssignmentRow({
  row: r,
  groupHeader,
  columnCount,
  showEmployee,
  showDepartment,
}: {
  row: AssignmentRowDTO;
  groupHeader: string | null;
  columnCount: number;
  showEmployee: boolean;
  showDepartment: boolean;
}) {
  return (
    <>
      {groupHeader !== null && (
        <tr className="bg-izi-gray-lt">
          <th colSpan={columnCount} scope="colgroup" className="px-4 py-1.5 text-left text-[11px] font-semibold text-dark">
            {groupHeader}
          </th>
        </tr>
      )}
      <tr className="border-b border-border-soft last:border-0">
        {showEmployee && (
          <td className="px-4 py-2 text-dark">
            {r.userName}
            {r.lifecycle === "OFFBOARDING" && <Badge tone="red">Départ en cours</Badge>}
            {r.lifecycle === "DEPARTED" && <Badge tone="red">Parti</Badge>}
          </td>
        )}
        {showDepartment && (
          <td className="px-4 py-2 text-izi-gray">{r.departmentName ?? "Sans département"}</td>
        )}
        <td className="px-4 py-2 text-dark">
          {r.assetName}
          {r.assetArchived && <Badge tone="gray">Archivé</Badge>}
        </td>
        <td className="px-4 py-2 text-dark">
          {r.levelName ?? "—"}
          {r.status === "EXPIRED_REMOVAL_PENDING" && <Badge tone="gold">Retrait en attente</Badge>}
        </td>
        <td className="px-4 py-2 font-mono text-izi-gray">{formatPeriod(r.periodStart, r.periodEnd)}</td>
        <td className="px-4 py-2 text-izi-gray">
          {SOURCE_LABEL[r.source]}
          {r.verification === "IMPORTED_UNREVIEWED" && <Badge tone="gray">Importé — non vérifié</Badge>}
        </td>
      </tr>
    </>
  );
}
