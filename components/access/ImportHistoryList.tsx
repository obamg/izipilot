interface BatchSummary {
  id: string;
  mode: string;
  fileName: string;
  actorName: string | null;
  totalRows: number;
  committedAt: string | null;
  createdAt: string;
}

const MODE_LABELS: Record<string, string> = {
  CATALOGUE_SEED: "Amorçage catalogue",
  BASELINE_ASSIGNMENTS: "Base d'affectations",
};

export function ImportHistoryList({ batches }: { batches: BatchSummary[] }) {
  if (batches.length === 0) {
    return <p className="text-[12px] text-izi-gray">Aucun import effectué pour l&apos;instant.</p>;
  }
  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4">
      <h2 className="font-serif text-[16px] text-dark mb-3">Historique des imports</h2>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-izi-gray text-left">
            <th className="py-1 font-medium">Date</th>
            <th className="py-1 font-medium">Mode</th>
            <th className="py-1 font-medium">Fichier</th>
            <th className="py-1 font-medium">Par</th>
            <th className="py-1 font-medium">Lignes</th>
            <th className="py-1 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-t border-border-soft">
              <td className="py-1">{new Date(b.createdAt).toLocaleString("fr-FR")}</td>
              <td className="py-1">{MODE_LABELS[b.mode] ?? b.mode}</td>
              <td className="py-1">{b.fileName}</td>
              <td className="py-1">{b.actorName ?? "—"}</td>
              <td className="py-1">{b.totalRows}</td>
              <td className="py-1">{b.committedAt ? "Importé" : "Bloqué / en attente"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
