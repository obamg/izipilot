"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface StartableTask {
  id: string;
  title: string;
  /** Colonne « en cours » du flux de cette tâche ; null si le flux n'en a pas. */
  columnId: string | null;
}

interface Props {
  userName: string;
  sprintId: string;
  needsTask: boolean;
  needsStandup: boolean;
  startableTasks: StartableTask[];
  standup: { yesterday: string | null; today: string | null; blockers: string | null } | null;
}

/**
 * L'écran qui bloque — et qui donne les moyens de se débloquer. Chaque
 * manquement y a son remède sur place ; on ne renvoie jamais vers une page que
 * la porte interdit par ailleurs.
 */
export function DailyCheckScreen({
  userName,
  sprintId,
  needsTask,
  needsStandup,
  startableTasks,
  standup,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [yesterday, setYesterday] = useState(standup?.yesterday ?? "");
  const [today, setToday] = useState(standup?.today ?? "");
  const [blockers, setBlockers] = useState(standup?.blockers ?? "");

  async function startTask(t: StartableTask) {
    setBusy(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/sprint-tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // columnId de préférence : l'API en dérive le statut, libellé et
        // sémantique restent alignés. Repli sur le statut si le flux de
        // l'équipe n'a pas de colonne « en cours ».
        body: JSON.stringify(
          t.columnId ? { columnId: t.columnId } : { status: "IN_PROGRESS" }
        ),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Impossible de démarrer cette tâche");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function saveStandup(e: React.FormEvent) {
    e.preventDefault();
    setBusy("standup");
    setError(null);
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
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Échec de l'enregistrement");
      }
      router.refresh();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  const canSaveStandup = Boolean(today.trim() || yesterday.trim() || blockers.trim());

  return (
    <main className="min-h-screen bg-gray-lt py-8 px-4">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div>
          <h1 className="font-serif text-xl text-dark">
            Votre point du jour, {userName}
          </h1>
          <p className="text-[13px] text-izi-gray mt-0.5">
            Deux choses avant de reprendre : une tâche en cours, et votre rapport
            quotidien. Tout se fait depuis cet écran.
          </p>
        </div>

        {needsTask && (
          <section className="rounded-[12px] border border-border-soft bg-white p-5">
            <h2 className="text-[13px] font-semibold text-dark mb-1">
              Aucune tâche démarrée
            </h2>
            <p className="text-[12px] text-izi-gray mb-3">
              Vous avez du travail assigné sur le sprint, mais rien n&apos;est en
              cours. Démarrez ce sur quoi vous travaillez aujourd&apos;hui.
            </p>
            {startableTasks.length === 0 ? (
              <p className="text-[12px] text-izi-gray">
                Aucune tâche à démarrer — prévenez votre PO.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {startableTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-[8px] border border-border-soft px-3 py-2"
                  >
                    <span className="text-[12px] text-dark min-w-0 truncate">
                      {t.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => startTask(t)}
                      disabled={busy !== null}
                      className="shrink-0 rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
                    >
                      {busy === t.id ? "…" : "Démarrer"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {needsStandup && (
          <form
            onSubmit={saveStandup}
            className="rounded-[12px] border border-border-soft bg-white p-5"
          >
            <h2 className="text-[13px] font-semibold text-dark mb-1">
              Rapport quotidien
            </h2>
            <p className="text-[12px] text-izi-gray mb-3">
              Trois lignes suffisent. Elles alimentent le point d&apos;équipe.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Field label="Hier" value={yesterday} onChange={setYesterday} placeholder="Ce que j'ai fait hier…" />
              <Field label="Aujourd'hui" value={today} onChange={setToday} placeholder="Ce que je vais faire…" />
              <Field label="Blocage" value={blockers} onChange={setBlockers} placeholder="Ce qui me bloque (optionnel)…" />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={busy !== null || !canSaveStandup}
                className="rounded-[7px] bg-teal px-4 py-2 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
              >
                {busy === "standup" ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
            {error}
          </p>
        )}
      </div>
    </main>
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
