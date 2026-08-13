"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  APPRAISAL_COMPETENCIES,
  overallScore,
  type AppraisalGoal,
  type CompetencyScores,
} from "@/lib/appraisal";
import type { SerializedAppraisal } from "@/lib/appraisal-serialize";
import { APPRAISAL_STATUS_META } from "@/lib/appraisal-serialize";
import {
  saveSelfAssessment,
  saveManagerAssessment,
  acknowledgeAppraisal,
} from "@/app/(dashboard)/appraisals/actions";

function scoreColor(v: number): string {
  if (v >= 4) return "var(--green)";
  if (v >= 3) return "var(--teal)";
  if (v >= 2) return "var(--gold)";
  return "var(--red)";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

let goalSeq = 0;
function newGoalId(): string {
  goalSeq += 1;
  return `g_${goalSeq}_${goalSeq * 7 + 3}`;
}

export function AppraisalDetail({
  appraisal,
  isSubject,
  isManager,
}: {
  appraisal: SerializedAppraisal;
  isSubject: boolean;
  isManager: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [selfComp, setSelfComp] = useState<CompetencyScores>(appraisal.selfCompetencies);
  const [selfComment, setSelfComment] = useState(appraisal.selfComment ?? "");
  const [mgrComp, setMgrComp] = useState<CompetencyScores>(appraisal.managerCompetencies);
  const [strengths, setStrengths] = useState(appraisal.strengths ?? "");
  const [improvements, setImprovements] = useState(appraisal.improvements ?? "");
  const [devPlan, setDevPlan] = useState(appraisal.developmentPlan ?? "");
  const [mgrComment, setMgrComment] = useState(appraisal.managerComment ?? "");
  const [goals, setGoals] = useState<AppraisalGoal[]>(appraisal.goals);
  const [ackComment, setAckComment] = useState("");

  const status = appraisal.status;
  const selfEditable = isSubject && status === "SELF_ASSESSMENT";
  const managerEditable = isManager && status === "MANAGER_ASSESSMENT";
  const canAck = isSubject && status === "SHARED";
  const rollup = appraisal.monthlyRollup;

  const previewOverall = useMemo(
    () => overallScore({ managerCompetencies: mgrComp, goals, monthlyAvg: rollup?.avgOverall ?? null }),
    [mgrComp, goals, rollup]
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Erreur");
      else router.refresh();
    });
  }

  const meta = APPRAISAL_STATUS_META[status];

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[24px] text-dark">
            Bilan {appraisal.quarter} {appraisal.year}
          </h1>
          <p className="text-[13px] text-izi-gray mt-0.5">
            {appraisal.subject.name} · évalué par {appraisal.manager.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {appraisal.overall != null && (
            <span
              className="font-mono text-[20px] font-bold tabular-nums"
              style={{ color: scoreColor(appraisal.overall) }}
            >
              {appraisal.overall.toFixed(1)}/5
            </span>
          )}
          <span
            className="text-[11px] font-semibold px-2 py-1 rounded-full"
            style={{ color: meta.color, backgroundColor: meta.bg }}
          >
            {meta.label}
          </span>
        </div>
      </div>

      {error && (
        <p className="rounded-[8px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">{error}</p>
      )}

      {/* Monthly rollup — objective context */}
      <Section title="Contexte — évaluations mensuelles du trimestre">
        {rollup && rollup.count > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat label="Global moyen" value={rollup.avgOverall} big />
            <Stat label="Livraison" value={rollup.avgDelivery} />
            <Stat label="Qualité" value={rollup.avgQuality} />
            <Stat label="Collaboration" value={rollup.avgCollaboration} />
            <Stat label="Initiative" value={rollup.avgInitiative} />
          </div>
        ) : (
          <p className="text-[13px] text-izi-gray">
            Aucune évaluation mensuelle enregistrée sur ce trimestre.
          </p>
        )}
      </Section>

      {/* Self-assessment */}
      <Section
        title="Auto-évaluation du collègue"
        subtitle={
          appraisal.selfSubmittedAt ? `Soumise le ${fmtDate(appraisal.selfSubmittedAt)}` : undefined
        }
      >
        <CompetencyRows
          editable={selfEditable}
          scores={selfComp}
          onChange={(k, v) => setSelfComp({ ...selfComp, [k]: v })}
          disabled={pending}
        />
        <Field label="Commentaire du collègue" className="mt-3">
          {selfEditable ? (
            <textarea
              value={selfComment}
              onChange={(e) => setSelfComment(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Bilan de mon trimestre, réussites, difficultés…"
              className="w-full rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[13px] text-dark focus:outline-none focus:border-teal resize-none"
            />
          ) : (
            <ReadText value={appraisal.selfComment} />
          )}
        </Field>
      </Section>

      {/* Goals */}
      <Section title="Objectifs de la période">
        <GoalsSection
          goals={goals}
          setGoals={setGoals}
          mode={selfEditable ? "self" : managerEditable ? "manager" : "read"}
          disabled={pending}
        />
      </Section>

      {/* Manager assessment */}
      {(status !== "SELF_ASSESSMENT" || isManager) && (
        <Section
          title="Évaluation du manager"
          subtitle={
            appraisal.managerSubmittedAt
              ? `Finalisée le ${fmtDate(appraisal.managerSubmittedAt)}`
              : status === "SELF_ASSESSMENT"
                ? "En attente de l'auto-évaluation du collègue"
                : undefined
          }
        >
          <CompetencyRows
            editable={managerEditable}
            scores={mgrComp}
            onChange={(k, v) => setMgrComp({ ...mgrComp, [k]: v })}
            disabled={pending}
          />
          <div className="mt-3 space-y-3">
            <NarrativeField
              label="Points forts"
              value={strengths}
              set={setStrengths}
              readValue={appraisal.strengths}
              editable={managerEditable}
              placeholder="Ce qui a bien fonctionné…"
            />
            <NarrativeField
              label="Axes d'amélioration"
              value={improvements}
              set={setImprovements}
              readValue={appraisal.improvements}
              editable={managerEditable}
              placeholder="Ce qui peut progresser…"
            />
            <NarrativeField
              label="Plan de développement"
              value={devPlan}
              set={setDevPlan}
              readValue={appraisal.developmentPlan}
              editable={managerEditable}
              placeholder="Actions, formations, objectifs pour le trimestre à venir…"
            />
            <NarrativeField
              label="Commentaire général"
              value={mgrComment}
              set={setMgrComment}
              readValue={appraisal.managerComment}
              editable={managerEditable}
              placeholder="Synthèse…"
            />
          </div>

          {managerEditable && (
            <div className="mt-3 flex items-center justify-between rounded-[8px] bg-gray-lt px-3 py-2">
              <span className="text-[12px] text-izi-gray">Note globale (aperçu)</span>
              <span
                className="font-mono text-[16px] font-bold tabular-nums"
                style={{ color: previewOverall != null ? scoreColor(previewOverall) : "var(--gray)" }}
              >
                {previewOverall != null ? `${previewOverall.toFixed(1)}/5` : "—"}
              </span>
            </div>
          )}
        </Section>
      )}

      {/* Sign-off */}
      {status === "ACKNOWLEDGED" && (
        <Section title="Signature du collègue" subtitle={`Signé le ${fmtDate(appraisal.acknowledgedAt)}`}>
          <ReadText value={appraisal.acknowledgeComment || "Bilan pris en connaissance."} />
        </Section>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 -mx-1 bg-gray-lt/80 backdrop-blur px-1 py-3">
        {selfEditable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="ghost" disabled={pending} onClick={() => run(() => saveSelfAssessment({ id: appraisal.id, competencies: selfComp, goals, comment: selfComment, submit: false }))}>
              Enregistrer
            </Btn>
            <Btn disabled={pending} onClick={() => run(() => saveSelfAssessment({ id: appraisal.id, competencies: selfComp, goals, comment: selfComment, submit: true }))}>
              {pending ? "…" : "Soumettre au manager"}
            </Btn>
          </div>
        )}
        {managerEditable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="ghost" disabled={pending} onClick={() => run(() => saveManagerAssessment({ id: appraisal.id, competencies: mgrComp, goals, strengths, improvements, developmentPlan: devPlan, comment: mgrComment, finalize: false }))}>
              Enregistrer
            </Btn>
            <Btn disabled={pending} onClick={() => run(() => saveManagerAssessment({ id: appraisal.id, competencies: mgrComp, goals, strengths, improvements, developmentPlan: devPlan, comment: mgrComment, finalize: true }))}>
              {pending ? "…" : "Finaliser & partager"}
            </Btn>
          </div>
        )}
        {canAck && (
          <div className="space-y-2">
            <textarea
              value={ackComment}
              onChange={(e) => setAckComment(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Un mot en retour (optionnel)…"
              className="w-full rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[13px] text-dark focus:outline-none focus:border-teal resize-none"
            />
            <div className="flex justify-end">
              <Btn disabled={pending} onClick={() => run(() => acknowledgeAppraisal({ id: appraisal.id, comment: ackComment || null }))}>
                {pending ? "…" : "Signer le bilan"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-[10px] border border-border-soft p-4">
      <div className="mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">{title}</h2>
        {subtitle && <p className="text-[11px] text-izi-gray mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function CompetencyRows({
  editable,
  scores,
  onChange,
  disabled,
}: {
  editable: boolean;
  scores: CompetencyScores;
  onChange: (key: string, value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="divide-y divide-border-soft">
      {APPRAISAL_COMPETENCIES.map((c) => (
        <div key={c.key} className="flex items-center justify-between gap-3 py-2">
          <span className="text-[13px] text-dark">{c.label}</span>
          {editable ? (
            <RatingPicker value={scores[c.key]} onChange={(v) => onChange(c.key, v)} disabled={disabled} />
          ) : (
            <ReadRating value={scores[c.key]} />
          )}
        </div>
      ))}
    </div>
  );
}

function RatingPicker({
  value,
  onChange,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`h-7 w-7 rounded-[6px] text-[12px] font-mono font-semibold border transition-colors disabled:opacity-50 ${
            value === n ? "border-transparent text-white" : "border-border-soft text-izi-gray hover:bg-gray-lt"
          }`}
          style={value === n ? { backgroundColor: scoreColor(n) } : undefined}
          aria-label={`Note ${n} sur 5`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ReadRating({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-[12px] text-izi-gray">—</span>;
  return (
    <span
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] px-1.5 text-[12px] font-mono font-semibold text-white"
      style={{ backgroundColor: scoreColor(value) }}
    >
      {value}
    </span>
  );
}

function Stat({ label, value, big }: { label: string; value: number | null; big?: boolean }) {
  return (
    <div>
      <div
        className={`font-mono font-bold tabular-nums ${big ? "text-[22px]" : "text-[18px]"}`}
        style={{ color: value != null ? scoreColor(value) : "var(--gray)" }}
      >
        {value != null ? value.toFixed(1) : "—"}
      </div>
      <div className="text-[10px] text-izi-gray mt-0.5">{label}</div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-medium text-izi-gray mb-1">{label}</label>
      {children}
    </div>
  );
}

function NarrativeField({
  label,
  value,
  set,
  readValue,
  editable,
  placeholder,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  readValue: string | null;
  editable: boolean;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      {editable ? (
        <textarea
          value={value}
          onChange={(e) => set(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder={placeholder}
          className="w-full rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[13px] text-dark focus:outline-none focus:border-teal resize-none"
        />
      ) : (
        <ReadText value={readValue} />
      )}
    </Field>
  );
}

function ReadText({ value }: { value: string | null }) {
  return (
    <p className="text-[13px] text-dark whitespace-pre-wrap leading-snug">
      {value?.trim() ? value : <span className="text-izi-gray">—</span>}
    </p>
  );
}

function GoalsSection({
  goals,
  setGoals,
  mode,
  disabled,
}: {
  goals: AppraisalGoal[];
  setGoals: (g: AppraisalGoal[]) => void;
  mode: "self" | "manager" | "read";
  disabled?: boolean;
}) {
  function patch(id: string, p: Partial<AppraisalGoal>) {
    setGoals(goals.map((g) => (g.id === id ? { ...g, ...p } : g)));
  }

  if (goals.length === 0 && mode !== "self") {
    return <p className="text-[13px] text-izi-gray">Aucun objectif renseigné.</p>;
  }

  return (
    <div className="space-y-2">
      {goals.map((g) => (
        <div key={g.id} className="rounded-[8px] border border-border-soft p-3">
          {mode === "self" ? (
            <input
              value={g.title}
              onChange={(e) => patch(g.id, { title: e.target.value })}
              maxLength={200}
              placeholder="Intitulé de l'objectif"
              className="w-full rounded-[6px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] font-medium text-dark focus:outline-none focus:border-teal"
            />
          ) : (
            <p className="text-[13px] font-medium text-dark">{g.title}</p>
          )}

          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
                  Collègue
                </span>
                {mode === "self" ? (
                  <RatingPicker value={g.selfRating} onChange={(v) => patch(g.id, { selfRating: v })} disabled={disabled} />
                ) : (
                  <ReadRating value={g.selfRating} />
                )}
              </div>
              {mode === "self" ? (
                <input
                  value={g.selfComment ?? ""}
                  onChange={(e) => patch(g.id, { selfComment: e.target.value })}
                  maxLength={2000}
                  placeholder="Note (optionnel)"
                  className="w-full rounded-[6px] border border-border-soft bg-white px-2.5 py-1 text-[12px] text-dark focus:outline-none focus:border-teal"
                />
              ) : (
                g.selfComment && <p className="text-[12px] text-dark">{g.selfComment}</p>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
                  Manager
                </span>
                {mode === "manager" ? (
                  <RatingPicker value={g.managerRating} onChange={(v) => patch(g.id, { managerRating: v })} disabled={disabled} />
                ) : (
                  <ReadRating value={g.managerRating} />
                )}
              </div>
              {mode === "manager" ? (
                <input
                  value={g.managerComment ?? ""}
                  onChange={(e) => patch(g.id, { managerComment: e.target.value })}
                  maxLength={2000}
                  placeholder="Note (optionnel)"
                  className="w-full rounded-[6px] border border-border-soft bg-white px-2.5 py-1 text-[12px] text-dark focus:outline-none focus:border-teal"
                />
              ) : (
                g.managerComment && <p className="text-[12px] text-dark">{g.managerComment}</p>
              )}
            </div>
          </div>

          {mode === "self" && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setGoals(goals.filter((x) => x.id !== g.id))}
                className="text-[11px] text-red hover:underline"
              >
                Retirer
              </button>
            </div>
          )}
        </div>
      ))}

      {mode === "self" && (
        <button
          type="button"
          onClick={() => setGoals([...goals, { id: newGoalId(), title: "" }])}
          className="text-[12px] font-medium text-teal hover:text-teal-dk"
        >
          + Ajouter un objectif
        </button>
      )}
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[8px] px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-50 ${
        variant === "primary"
          ? "bg-teal text-white hover:bg-teal-dk"
          : "border border-border-soft text-dark hover:bg-gray-lt"
      }`}
    >
      {children}
    </button>
  );
}
