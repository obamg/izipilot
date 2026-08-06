"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { overallScore, MONTH_LABELS_FR } from "@/lib/evaluation";
import { EvaluationTrends, type TrendData } from "./EvaluationTrends";

interface DeliveryVM {
  deliveredPoints: number;
  committedPoints: number;
  ratio: number | null;
  tasksDone: number;
  tasksTotal: number;
  onTimeRate: number | null;
}

interface EvaluationVM {
  scoreQuality: number;
  scoreCollaboration: number;
  scoreInitiative: number;
  overall: number;
  comment: string | null;
}

export interface SubjectVM {
  id: string;
  name: string;
  role: UserRole;
  delivery: DeliveryVM | null;
  deliveryScore: number | null;
  evaluation: EvaluationVM | null;
}

interface Props {
  month: number;
  year: number;
  subjects: SubjectVM[];
  trend: TrendData;
}

const ROLE_LABELS: Record<UserRole, string> = {
  CEO: "CEO",
  MANAGEMENT: "Management",
  PO: "PO",
  CONTRIBUTOR: "Contributeur",
  VIEWER: "Observateur",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

export function EvaluationsView({ month, year, subjects, trend }: Props) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "trends">("board");

  function go(m: number, y: number) {
    router.push(`/evaluations?month=${m}&year=${y}`);
  }
  function prev() {
    month === 1 ? go(12, year - 1) : go(month - 1, year);
  }
  function next() {
    month === 12 ? go(1, year + 1) : go(month + 1, year);
  }

  const rated = subjects.filter((s) => s.evaluation).length;

  return (
    <div className="space-y-4">
      {/* Month selector + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-[8px] border border-border-soft bg-white px-1">
          <button
            type="button"
            onClick={prev}
            aria-label="Mois précédent"
            className="flex h-7 w-7 items-center justify-center text-izi-gray hover:text-teal"
          >
            ‹
          </button>
          <span className="px-2 text-[13px] font-medium text-dark min-w-[120px] text-center">
            {MONTH_LABELS_FR[month - 1]} {year}
          </span>
          <button
            type="button"
            onClick={next}
            aria-label="Mois suivant"
            className="flex h-7 w-7 items-center justify-center text-izi-gray hover:text-teal"
          >
            ›
          </button>
        </div>

        <div className="inline-flex rounded-[8px] border border-border-soft bg-white p-0.5">
          {(["board", "trends"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-[6px] px-3 py-1 text-[12px] font-medium transition-colors ${
                view === v ? "bg-teal text-white" : "text-izi-gray hover:text-dark"
              }`}
            >
              {v === "board" ? "Évaluer" : "Tendances"}
            </button>
          ))}
        </div>
      </div>

      {view === "board" ? (
        <>
          <div className="flex justify-end">
            <span className="text-[11px] text-izi-gray">
              {rated}/{subjects.length} évalué{rated > 1 ? "s" : ""} · {MONTH_LABELS_FR[month - 1]}{" "}
              {year}
            </span>
          </div>
          {subjects.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
              Personne à évaluer sur cette période.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {subjects.map((s) => (
                <SubjectCard key={s.id} subject={s} month={month} year={year} />
              ))}
            </div>
          )}
        </>
      ) : (
        <EvaluationTrends trend={trend} />
      )}
    </div>
  );
}

function SubjectCard({
  subject,
  month,
  year,
}: {
  subject: SubjectVM;
  month: number;
  year: number;
}) {
  const router = useRouter();
  const ev = subject.evaluation;
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState(ev?.scoreQuality ?? 3);
  const [collaboration, setCollaboration] = useState(ev?.scoreCollaboration ?? 3);
  const [initiative, setInitiative] = useState(ev?.scoreInitiative ?? 3);
  const [comment, setComment] = useState(ev?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = subject.delivery;
  const livePreview = overallScore(subject.deliveryScore, {
    quality,
    collaboration,
    initiative,
  });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: subject.id,
          periodMonth: month,
          periodYear: year,
          scoreQuality: quality,
          scoreCollaboration: collaboration,
          scoreInitiative: initiative,
          comment: comment.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'enregistrement");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-border-soft bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-dark truncate">{subject.name}</span>
            <span className="rounded-full bg-izi-gray-lt px-1.5 py-0.5 text-[9px] font-semibold text-izi-gray">
              {ROLE_LABELS[subject.role]}
            </span>
          </div>
          {/* Delivery stats — the objective basis */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-izi-gray">
            <span>
              <span className="font-mono font-semibold text-dark">
                {d ? `${d.deliveredPoints}/${d.committedPoints}` : "—"}
              </span>{" "}
              pts livrés
            </span>
            <span>·</span>
            <span>{d ? `${d.tasksDone}/${d.tasksTotal} tâches` : "—"}</span>
            <span>·</span>
            <span>ponctualité {d ? pct(d.onTimeRate) : "—"}</span>
          </div>
          <div className="mt-1 text-[11px]">
            Livraison auto :{" "}
            <span className="font-mono font-semibold text-teal">
              {subject.deliveryScore != null ? `${subject.deliveryScore.toFixed(1)}/5` : "n/a"}
            </span>
            {d?.ratio != null && (
              <span className="text-izi-gray"> · {pct(d.ratio)} de l&apos;engagé</span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-[22px] font-semibold leading-none text-dark">
            {ev ? ev.overall.toFixed(1) : "—"}
            <span className="text-[12px] text-izi-gray">/5</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-1.5 rounded-[7px] border border-border-soft bg-white px-2.5 py-1 text-[11px] font-medium text-izi-gray hover:border-teal-md hover:text-teal transition-colors"
          >
            {ev ? "Modifier" : "Évaluer"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t border-border-soft pt-3 space-y-3">
          <ScoreRow label="Qualité du travail" value={quality} onChange={setQuality} />
          <ScoreRow label="Collaboration" value={collaboration} onChange={setCollaboration} />
          <ScoreRow
            label="Initiative / valeur ajoutée"
            value={initiative}
            onChange={setInitiative}
          />

          <div>
            <label className="block text-[11px] font-semibold text-izi-gray mb-1">
              Commentaire (optionnel)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={2000}
              className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark resize-none focus:outline-none focus:border-teal"
              placeholder="Points forts, axes d'amélioration…"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-[11px] text-izi-gray">
              Global estimé :{" "}
              <span className="font-mono text-[15px] font-semibold text-dark">
                {livePreview.toFixed(1)}
              </span>
              /5
              <span className="ml-1 text-izi-gray">
                (60 % livraison + 40 % critères)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[7px] border border-border-soft bg-white px-3 py-1.5 text-[12px] font-medium text-izi-gray hover:bg-gray-lt"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[11px] text-red">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-dark">{label}</span>
      <div className="inline-flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${label} : ${n} sur 5`}
            aria-pressed={value === n}
            className={`h-7 w-7 rounded-[6px] text-[12px] font-mono font-semibold transition-colors ${
              value >= n
                ? "bg-teal text-white"
                : "bg-izi-gray-lt text-izi-gray hover:bg-teal-lt"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
