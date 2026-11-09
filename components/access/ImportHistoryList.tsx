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
      <div className="overflow-x-auto">
      <table className="izi-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Mode</th>
            <th>Fichier</th>
            <th>Par</th>
            <th>Lignes</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td>{new Date(b.createdAt).toLocaleString("fr-FR")}</td>
              <td>{MODE_LABELS[b.mode] ?? b.mode}</td>
              <td>{b.fileName}</td>
              <td>{b.actorName ?? "—"}</td>
              <td>{b.totalRows}</td>
              <td>{b.committedAt ? "Importé" : "Bloqué / en attente"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
