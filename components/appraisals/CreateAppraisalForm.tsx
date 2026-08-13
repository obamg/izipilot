"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAppraisal } from "@/app/(dashboard)/appraisals/actions";
import { QUARTERS } from "@/lib/appraisal";

export function CreateAppraisalForm({
  subjects,
  defaultQuarter,
  defaultYear,
}: {
  subjects: { id: string; name: string }[];
  defaultQuarter: string;
  defaultYear: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [quarter, setQuarter] = useState(defaultQuarter);
  const [year, setYear] = useState(defaultYear);
  const [error, setError] = useState<string | null>(null);

  if (subjects.length === 0) return null;

  function submit() {
    setError(null);
    start(async () => {
      const res = await createAppraisal({ subjectId, quarter, year });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/appraisals/${res.data.id}`);
    });
  }

  const cls =
    "rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[13px] text-dark focus:outline-none focus:border-teal";

  return (
    <div className="bg-white rounded-[10px] border border-border-soft p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray mb-3">
        Ouvrir un bilan
      </h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[180px]">
          <span className="block text-[11px] text-izi-gray mb-1">Collègue</span>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={`${cls} w-full`}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-[11px] text-izi-gray mb-1">Trimestre</span>
          <select value={quarter} onChange={(e) => setQuarter(e.target.value)} className={cls}>
            {QUARTERS.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-[11px] text-izi-gray mb-1">Année</span>
          <input
            type="number"
            value={year}
            min={2024}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            className={`${cls} w-24`}
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !subjectId}
          className="rounded-[8px] bg-teal px-4 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          {pending ? "…" : "Ouvrir"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}
    </div>
  );
}
