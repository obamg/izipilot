"use client";

import { useEffect, useMemo, useState } from "react";
import { mergeStandups, type RosterMember, type StandupRecord } from "@/lib/standup";

interface DailyReportProps {
  sprintId: string;
  today: string; // yyyy-mm-dd (WAT)
  roster: RosterMember[];
  initialStandups: StandupRecord[]; // today's standups, server-provided
  currentUserId: string;
  canSubmit: boolean;
  /**
   * Personnes retenues par les filtres du sprint, ou null si aucun filtre.
   * Calculé à partir des tâches de la sélection : filtrer sur une équipe montre
   * les standups des gens qui y travaillent. L'appartenance vient des tâches
   * d'aujourd'hui même quand on remonte à un jour passé — les tâches n'ont pas
   * d'historique d'affectation.
   */
  visibleMemberIds?: readonly string[] | null;
}

function shiftDate(key: string, deltaDays: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function dateLabel(key: string): string {
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function DailyReport({
  sprintId,
  today,
  roster,
  initialStandups,
  currentUserId,
  canSubmit,
  visibleMemberIds = null,
}: DailyReportProps) {
  const [date, setDate] = useState(today);
  const [standups, setStandups] = useState<StandupRecord[]>(initialStandups);
  const [loading, setLoading] = useState(false);

  const isToday = date === today;

  async function load(forDate: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/standups?date=${forDate}`);
      if (res.ok) {
        const json = await res.json();
        setStandups(json.standups as StandupRecord[]);
      }
    } finally {
      setLoading(false);
    }
  }

  // Refetch whenever the day changes (today is preloaded from the server).
  useEffect(() => {
    if (date === today) {
      setStandups(initialStandups);
      return;
    }
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Filtrer le roster AVANT la fusion : compteurs, blocages et lignes restent
  // ainsi cohérents entre eux sans code de comptage séparé.
  const visibleRoster = useMemo(() => {
    if (!visibleMemberIds) return roster;
    const keep = new Set(visibleMemberIds);
    return roster.filter((m) => keep.has(m.id));
  }, [roster, visibleMemberIds]);
  const filtered = visibleMemberIds != null;

  const report = useMemo(
    () => mergeStandups(visibleRoster, standups),
    [visibleRoster, standups]
  );
  // Mon formulaire ne dépend pas du filtre : filtrer une vue ne doit jamais
  // m'empêcher de saisir mon propre standup.
  const mine = standups.find((s) => s.userId === currentUserId) ?? null;

  return (
    <div className="space-y-4">
      {/* Date selector + participation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDate(shiftDate(date, -1))}
            className="rounded-[7px] border border-border-soft bg-white px-2 py-1 text-[13px] text-izi-gray hover:bg-gray-lt"
            aria-label="Jour précédent"
          >
            ‹
          </button>
          <span className="text-[13px] font-medium text-dark capitalize min-w-[180px] text-center">
            {dateLabel(date)}
            {isToday && <span className="ml-1.5 text-[11px] text-teal">· aujourd&apos;hui</span>}
          </span>
          <button
            type="button"
            onClick={() => setDate(shiftDate(date, 1))}
            disabled={isToday}
            className="rounded-[7px] border border-border-soft bg-white px-2 py-1 text-[13px] text-izi-gray hover:bg-gray-lt disabled:opacity-40"
            aria-label="Jour suivant"
          >
            ›
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(today)}
              className="ml-1 text-[11px] font-medium text-teal hover:text-teal-dk"
            >
              Aujourd&apos;hui
            </button>
          )}
        </div>
        <span className="text-[11px] text-izi-gray">
          {report.submittedCount}/{report.totalCount} standup
          {report.totalCount > 1 ? "s" : ""}
          {filtered && (
            <span className="ml-1">· {report.totalCount} membre
              {report.totalCount > 1 ? "s" : ""} sur {roster.length}
            </span>
          )}
        </span>
      </div>

      {/* My standup (today only) */}
      {isToday && canSubmit && (
        <MyStandupForm
          sprintId={sprintId}
          mine={mine}
          onSaved={() => load(today)}
        />
      )}

      {/* Blockers highlight */}
      {report.blockers.length > 0 && (
        <div className="rounded-[10px] border border-red/30 bg-red-lt px-3.5 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-red mb-2">
            🚧 Blocages ({report.blockers.length})
          </h3>
          <ul className="space-y-1.5">
            {report.blockers.map((b) => (
              <li key={b.userId} className="text-[12px] text-dark">
                <span className="font-medium">{b.userName} :</span> {b.blockers}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Member standups */}
      {loading ? (
        <p className="text-[13px] text-izi-gray py-6 text-center">Chargement…</p>
      ) : report.rows.length === 0 ? (
        <p className="text-[13px] text-izi-gray py-6 text-center">
          {filtered
            ? "Aucun membre ne correspond aux filtres."
            : "Aucun membre rattaché à ce sprint."}
        </p>
      ) : (
        <div className="space-y-2">
          {report.rows.map((r) => (
            <div
              key={r.userId}
              className={`rounded-[10px] border bg-white p-3.5 ${
                r.blockers ? "border-red/30" : "border-border-soft"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-dark">
                  {r.userName}
                  {r.userId === currentUserId && (
                    <span className="ml-1.5 text-[10px] text-teal">(moi)</span>
                  )}
                </span>
                {!r.submitted && (
                  <span className="text-[10px] text-izi-gray italic">Pas encore de standup</span>
                )}
              </div>
              {r.submitted && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <StandupCol label="Hier" value={r.yesterday} />
                  <StandupCol label="Aujourd'hui" value={r.today} />
                  <StandupCol label="Blocage" value={r.blockers} accent={Boolean(r.blockers)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StandupCol({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-[9px] font-semibold uppercase tracking-[0.06em] mb-0.5 ${
          accent ? "text-red" : "text-izi-gray"
        }`}
      >
        {label}
      </div>
      <p className="text-[12px] text-dark whitespace-pre-wrap leading-snug">
        {value?.trim() ? value : <span className="text-izi-gray">—</span>}
      </p>
    </div>
  );
}

function MyStandupForm({
  sprintId,
  mine,
  onSaved,
}: {
  sprintId: string;
  mine: StandupRecord | null;
  onSaved: () => void;
}) {
  const [yesterday, setYesterday] = useState(mine?.yesterday ?? "");
  const [today, setToday] = useState(mine?.today ?? "");
  const [blockers, setBlockers] = useState(mine?.blockers ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(mine?.updatedAt ?? null);

  // Re-sync when the underlying entry changes (e.g. after a reload).
  useEffect(() => {
    setYesterday(mine?.yesterday ?? "");
    setToday(mine?.today ?? "");
    setBlockers(mine?.blockers ?? "");
    setSavedAt(mine?.updatedAt ?? null);
  }, [mine?.yesterday, mine?.today, mine?.blockers, mine?.updatedAt]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/standups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yesterday: yesterday.trim() || null,
          today: today.trim() || null,
          blockers: blockers.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Échec de l'enregistrement");
        return;
      }
      const json = await res.json();
      setSavedAt(json.data?.updatedAt ?? null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[10px] border border-teal-md bg-teal-lt/50 p-3.5"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-semibold text-teal-dk">Mon standup</h3>
        {savedAt && (
          <span className="text-[10px] text-izi-gray">
            Enregistré à{" "}
            {new Date(savedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Hier" value={yesterday} onChange={setYesterday} placeholder="Ce que j'ai fait hier…" />
        <Field label="Aujourd'hui" value={today} onChange={setToday} placeholder="Ce que je vais faire…" />
        <Field
          label="Blocage"
          value={blockers}
          onChange={setBlockers}
          placeholder="Ce qui me bloque (optionnel)…"
        />
      </div>
      {error && <p className="mt-2 text-[11px] text-red">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : "Enregistrer mon standup"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-izi-gray mb-0.5">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={placeholder}
        className="w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal resize-none"
      />
    </div>
  );
}
