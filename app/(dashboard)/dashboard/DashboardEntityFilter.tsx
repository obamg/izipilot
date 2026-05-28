"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface EntityOption {
  code: string;
  name: string;
}

interface DashboardEntityFilterProps {
  products: EntityOption[];
  departments: EntityOption[];
  selected: string | null;
}

export function DashboardEntityFilter({
  products,
  departments,
  selected,
}: DashboardEntityFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(entity: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (entity) params.set("entity", entity);
    else params.delete("entity");
    const qs = params.toString();
    router.push(qs ? `/dashboard?${qs}` : "/dashboard");
  }

  return (
    <div className="inline-flex items-center gap-2">
      <label
        htmlFor="dashboard-entity"
        className="text-xs font-semibold tracking-wide uppercase text-izi-gray"
      >
        Filtre
      </label>
      <select
        id="dashboard-entity"
        value={selected ?? ""}
        onChange={(e) => navigate(e.target.value || null)}
        className="rounded-md border border-teal-md bg-white px-2 py-1.5 text-sm text-dark-md focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
      >
        <option value="">Tous les périmètres</option>
        {products.length > 0 && (
          <optgroup label="Produits">
            {products.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {departments.length > 0 && (
          <optgroup label="Départements">
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} · {d.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selected && (
        <button
          onClick={() => navigate(null)}
          className="text-xs text-teal hover:text-teal-dk font-medium cursor-pointer"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
