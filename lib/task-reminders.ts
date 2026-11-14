/**
 * Rappel de 9h sur les tâches de sprint — logique pure, sans Prisma, pour que
 * le tri « en retard / aujourd'hui / prochain jour ouvré » soit testable.
 *
 * Les dates sont des « jours » : `dueDate` est stocké à minuit UTC du jour
 * choisi, et `today` est minuit UTC du jour WAT courant (watDateOnly).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderTask {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string | null;
}

export interface PersonalReminder {
  overdue: ReminderTask[];
  dueToday: ReminderTask[];
  dueNext: ReminderTask[];
}

/**
 * Fin (exclue) de la fenêtre « prochain jour ouvré » : le lendemain, sauf le
 * vendredi où elle couvre le week-end et le lundi — sinon une tâche due samedi
 * ou lundi ne serait annoncée nulle part avant d'être en retard.
 */
export function nextWindowEnd(today: Date): Date {
  const days = today.getUTCDay() === 5 ? 4 : 2;
  return new Date(today.getTime() + days * DAY_MS);
}

/** Jours de retard d'une tâche (≥ 1 si en retard). */
export function daysLate(due: Date, today: Date): number {
  return Math.round((today.getTime() - due.getTime()) / DAY_MS);
}

/** Regroupe les tâches ouvertes par personne assignée. */
export function personalReminders(
  tasks: ReadonlyArray<ReminderTask>,
  today: Date,
): Map<string, PersonalReminder> {
  const start = today.getTime();
  const tomorrow = start + DAY_MS;
  const end = nextWindowEnd(today).getTime();
  const out = new Map<string, PersonalReminder>();
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    const due = t.dueDate.getTime();
    const bucket =
      due < start ? "overdue" : due < tomorrow ? "dueToday" : due < end ? "dueNext" : null;
    if (!bucket) continue;
    let r = out.get(t.assigneeId);
    if (!r) out.set(t.assigneeId, (r = { overdue: [], dueToday: [], dueNext: [] }));
    r[bucket].push(t);
  }
  for (const r of out.values()) {
    // Le plus en retard / le plus proche d'abord.
    for (const list of [r.overdue, r.dueToday, r.dueNext]) {
      list.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    }
  }
  return out;
}

/** Texte de la notification personnelle. */
export function personalMessage(r: PersonalReminder, today: Date): { title: string; body: string } {
  const parts: string[] = [];
  if (r.overdue.length) parts.push(`${r.overdue.length} en retard`);
  if (r.dueToday.length) parts.push(`${r.dueToday.length} à rendre aujourd'hui`);
  if (r.dueNext.length) parts.push(`${r.dueNext.length} pour le prochain jour ouvré`);
  const top = r.overdue[0] ?? r.dueToday[0] ?? r.dueNext[0];
  const focus = r.overdue[0]
    ? `Le plus urgent : « ${top.title} » (${daysLate(top.dueDate, today)} j de retard).`
    : `Le plus urgent : « ${top.title} ».`;
  return {
    title: r.overdue.length ? "Tâches en retard" : "Tâches à rendre",
    body: `${capitalize(parts.join(", "))}. ${focus}`,
  };
}

/** Texte du résumé envoyé à un responsable d'équipe. */
export function teamMessage(
  teams: ReadonlyArray<{ name: string; overdue: number }>,
): { title: string; body: string } {
  const total = teams.reduce((n, t) => n + t.overdue, 0);
  const detail = teams.map((t) => `${t.name} : ${t.overdue}`).join(", ");
  return {
    title: "Retards de l'équipe",
    body: `${total} tâche${total > 1 ? "s" : ""} en retard (${detail}).`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
