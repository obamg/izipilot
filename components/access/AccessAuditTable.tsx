"use client";

import Link from "next/link";

interface AuditRow {
  id: string;
  occurredAt: string;
  actorId: string;
  actorName: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  reason: string | null;
  outcome: string;
}

interface AccessAuditTableProps {
  rows: AuditRow[];
  page: number;
  pageSize: number;
  total: number;
}

export function AccessAuditTable({ rows, page, pageSize, total }: AccessAuditTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <a
          href="/api/access/audit/export"
          className="rounded-[7px] border border-border-soft bg-white px-3 py-1.5 text-[11px] font-medium text-dark hover:bg-izi-gray-lt transition-colors"
        >
          Exporter en CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
          Aucun événement enregistré pour l&apos;instant.
        </div>
      ) : (
        <div className="rounded-[10px] border border-border-soft bg-white overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border-soft text-izi-gray text-left">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Acteur</th>
                <th className="px-4 py-2 font-medium">Événement</th>
                <th className="px-4 py-2 font-medium">Objet</th>
                <th className="px-4 py-2 font-medium">Bénéficiaire</th>
                <th className="px-4 py-2 font-medium">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-soft last:border-0">
                  <td className="px-4 py-2 font-mono text-izi-gray">
                    {new Date(r.occurredAt).toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo" })}
                  </td>
                  <td className="px-4 py-2 text-dark">{r.actorName ?? r.actorId}</td>
                  <td className="px-4 py-2 text-dark">{r.eventType}</td>
                  <td className="px-4 py-2 text-izi-gray">
                    {r.objectType}:{r.objectId}
                  </td>
                  <td className="px-4 py-2 text-izi-gray">{r.beneficiaryName ?? r.beneficiaryId ?? "—"}</td>
                  <td className="px-4 py-2 text-izi-gray">{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-[11px]">
          {page > 1 && (
            <Link href={`/access/audit?page=${page - 1}`} className="text-teal hover:text-teal-dk">
              Précédent
            </Link>
          )}
          <span className="text-izi-gray">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/access/audit?page=${page + 1}`} className="text-teal hover:text-teal-dk">
              Suivant
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
