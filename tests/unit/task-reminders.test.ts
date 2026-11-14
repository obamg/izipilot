import { describe, expect, it } from "vitest";
import { personalMessage, personalReminders, teamMessage, nextWindowEnd } from "@/lib/task-reminders";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const task = (id: string, due: string, assigneeId: string | null = "u1") => ({ id, title: `T${id}`, dueDate: d(due), assigneeId });

describe("personalReminders", () => {
  it("range en retard / aujourd'hui / demain, ignore plus tard et sans assigné", () => {
    const today = d("2026-11-17"); // mardi
    const r = personalReminders(
      [task("a", "2026-11-12"), task("b", "2026-11-17"), task("c", "2026-11-18"), task("d", "2026-11-19"), task("e", "2026-11-10", null)],
      today,
    ).get("u1")!;
    expect(r.overdue.map((t) => t.id)).toEqual(["a"]);
    expect(r.dueToday.map((t) => t.id)).toEqual(["b"]);
    expect(r.dueNext.map((t) => t.id)).toEqual(["c"]);
  });

  it("le vendredi, le prochain jour ouvré couvre samedi, dimanche et lundi", () => {
    const friday = d("2026-11-20");
    expect(nextWindowEnd(friday)).toEqual(d("2026-11-24"));
    const r = personalReminders([task("sat", "2026-11-21"), task("mon", "2026-11-23"), task("tue", "2026-11-24")], friday).get("u1")!;
    expect(r.dueNext.map((t) => t.id)).toEqual(["sat", "mon"]);
  });
});

describe("messages", () => {
  it("met en avant la tâche la plus en retard", () => {
    const today = d("2026-11-17");
    const r = personalReminders([task("a", "2026-11-16"), task("b", "2026-11-12"), task("c", "2026-11-18")], today).get("u1")!;
    expect(personalMessage(r, today)).toEqual({
      title: "Tâches en retard",
      body: "2 en retard, 1 pour le prochain jour ouvré. Le plus urgent : « Tb » (5 j de retard).",
    });
  });

  it("résume les retards par équipe", () => {
    expect(teamMessage([{ name: "IT", overdue: 3 }, { name: "Africapart", overdue: 1 }]).body).toBe(
      "4 tâches en retard (IT : 3, Africapart : 1).",
    );
  });
});
