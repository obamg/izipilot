interface Option {
  id: string;
  name: string;
}

interface RegisterFilterFormProps {
  action: string;
  view: "department" | "owned-assets";
  departments?: { options: Option[]; selected: string; allowAll: boolean };
  assets?: { options: Option[]; selected?: string; label: string };
  levels?: { options: Option[]; selected?: string };
  search?: { value?: string };
}

const fieldCls =
  "rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal";

// Formulaire GET natif : fonctionne sans JavaScript, chaque filtre devient un
// paramètre d'URL validé côté serveur par registerQuerySchema. L'option
// « Toutes » / « Tous » envoie une chaîne vide, que le schéma traite comme absente.
export function RegisterFilterForm({ action, view, departments, assets, levels, search }: RegisterFilterFormProps) {
  const departmentChoices = departments ? departments.options.length + (departments.allowAll ? 1 : 0) : 0;

  return (
    <form method="get" action={action} className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <input type="hidden" name="view" value={view} />
      {departments && departmentChoices > 1 && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          Département
          <select name="departmentId" defaultValue={departments.selected} className={fieldCls}>
            {departments.allowAll && <option value="ALL">Toutes</option>}
            {departments.options.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}
      {departments && departmentChoices <= 1 && (
        <input type="hidden" name="departmentId" value={departments.selected} />
      )}
      {assets && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          {assets.label}
          <select name="assetId" defaultValue={assets.selected ?? ""} className={fieldCls}>
            <option value="">Toutes</option>
            {assets.options.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
      )}
      {levels && levels.options.length > 0 && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          Niveau
          <select name="levelId" defaultValue={levels.selected ?? ""} className={fieldCls}>
            <option value="">Tous</option>
            {levels.options.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      )}
      {search && (
        <label className="flex flex-col gap-1 text-[11px] text-izi-gray">
          Employé
          <input
            type="search"
            name="q"
            defaultValue={search.value ?? ""}
            maxLength={100}
            placeholder="Nom de l'employé"
            className={fieldCls}
          />
        </label>
      )}
      <button
        type="submit"
        className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors"
      >
        Filtrer
      </button>
    </form>
  );
}
