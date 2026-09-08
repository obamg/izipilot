import { describe, it, expect } from "vitest";
import {
  evaluateMember,
  isStandupDue,
  STANDUP_CUTOFF_HOUR,
  type MemberComplianceInput,
} from "@/lib/member-compliance";

const base: MemberComplianceInput = {
  assignedCount: 3,
  inProgressCount: 1,
  startableCount: 2,
  hasStandupToday: true,
  standupDue: true,
};
const m = (over: Partial<MemberComplianceInput> = {}) =>
  evaluateMember({ ...base, ...over });

describe("evaluateMember", () => {
  it("ne reproche rien à quelqu'un en règle", () => {
    expect(m()).toEqual({ issues: [], blocking: false });
  });

  it("bloque celui qui a des tâches mais n'en a démarré aucune", () => {
    const r = m({ inProgressCount: 0, startableCount: 2 });
    expect(r.issues).toEqual(["NO_ONGOING_TASK"]);
    expect(r.blocking).toBe(true);
  });

  it("signale SANS bloquer celui qui n'a aucune tâche assignée", () => {
    // Il ne peut pas s'en assigner depuis l'écran de blocage : le bloquer
    // serait le punir d'une décision qui ne lui appartient pas.
    const r = m({ assignedCount: 0, inProgressCount: 0, startableCount: 0 });
    expect(r.issues).toEqual(["NO_TASK_ASSIGNED"]);
    expect(r.blocking).toBe(false);
  });

  it("ne bloque JAMAIS celui qui a tout terminé", () => {
    // Cas trouvé en conditions réelles : une personne dont l'unique tâche est
    // DONE n'a rien en cours ET rien à démarrer. La bloquer l'enfermerait
    // dehors pour avoir fini son travail, sans aucun moyen d'en sortir.
    const r = m({ assignedCount: 2, inProgressCount: 0, startableCount: 0 });
    expect(r.issues).toEqual(["NO_TASK_TO_START"]);
    expect(r.blocking).toBe(false);
  });

  it("bloque en revanche celui qui a de quoi démarrer et ne l'a pas fait", () => {
    const r = m({ assignedCount: 2, inProgressCount: 0, startableCount: 1 });
    expect(r.issues).toEqual(["NO_ONGOING_TASK"]);
    expect(r.blocking).toBe(true);
  });

  it("« tout terminé » n'empêche pas le standup d'être bloquant", () => {
    // Les deux règles sont indépendantes : avoir fini son travail ne dispense
    // pas de dire ce qu'on a fait.
    const r = m({
      assignedCount: 2,
      inProgressCount: 0,
      startableCount: 0,
      hasStandupToday: false,
    });
    expect(r.issues).toEqual(["NO_TASK_TO_START", "NO_STANDUP"]);
    expect(r.blocking).toBe(true);
  });

  it("ne cumule pas « aucune tâche » et « aucune démarrée »", () => {
    // Les deux seraient vrais littéralement, mais dire à quelqu'un qui n'a
    // rien qu'il n'a « rien démarré » est un reproche absurde.
    const r = m({ assignedCount: 0, inProgressCount: 0 });
    expect(r.issues).not.toContain("NO_ONGOING_TASK");
  });

  it("bloque le standup manquant quand il est exigible", () => {
    const r = m({ hasStandupToday: false });
    expect(r.issues).toEqual(["NO_STANDUP"]);
    expect(r.blocking).toBe(true);
  });

  it("ne reproche pas un standup pas encore exigible", () => {
    // Avant l'heure limite : la journée n'est pas finie.
    expect(m({ hasStandupToday: false, standupDue: false }).blocking).toBe(false);
  });

  it("cumule les deux manquements quand ils coexistent", () => {
    const r = m({ inProgressCount: 0, startableCount: 2, hasStandupToday: false });
    expect(r.issues).toEqual(["NO_ONGOING_TASK", "NO_STANDUP"]);
    expect(r.blocking).toBe(true);
  });

  it("bloque le standup même sans tâche assignée", () => {
    // Le standup ne dépend pas du fait d'avoir du travail assigné : on peut
    // toujours dire ce qu'on a fait et ce qui bloque.
    const r = m({ assignedCount: 0, inProgressCount: 0, startableCount: 0, hasStandupToday: false });
    expect(r.issues).toEqual(["NO_TASK_ASSIGNED", "NO_STANDUP"]);
    expect(r.blocking).toBe(true);
  });
});

describe("isStandupDue", () => {
  // 2026-09-08 est un mardi. WAT = UTC+1.
  const mardi = (hUtc: number) =>
    new Date(Date.UTC(2026, 8, 8, hUtc, 30, 0));

  it("n'exige rien avant l'heure limite", () => {
    // 08h30 UTC = 09h30 WAT, avant 11h.
    expect(isStandupDue(mardi(8))).toBe(false);
  });

  it("exige à partir de l'heure limite", () => {
    // 10h30 UTC = 11h30 WAT.
    expect(isStandupDue(mardi(10))).toBe(true);
  });

  it("bascule pile à l'heure limite, pas une minute avant", () => {
    const justeAvant = new Date(Date.UTC(2026, 8, 8, 9, 59, 0)); // 10h59 WAT
    const pile = new Date(Date.UTC(2026, 8, 8, 10, 0, 0)); // 11h00 WAT
    expect(isStandupDue(justeAvant)).toBe(false);
    expect(isStandupDue(pile)).toBe(true);
  });

  it("n'exige jamais rien le samedi ni le dimanche", () => {
    // 2026-09-12 samedi, 2026-09-13 dimanche — en pleine après-midi.
    expect(isStandupDue(new Date(Date.UTC(2026, 8, 12, 14, 0, 0)))).toBe(false);
    expect(isStandupDue(new Date(Date.UTC(2026, 8, 13, 14, 0, 0)))).toBe(false);
  });

  it("tient compte du décalage WAT pour le jour, pas seulement l'heure", () => {
    // Vendredi 23h30 UTC = samedi 00h30 WAT → plus de standup exigible.
    expect(isStandupDue(new Date(Date.UTC(2026, 8, 11, 23, 30, 0)))).toBe(false);
  });

  it("accepte une heure limite explicite", () => {
    expect(isStandupDue(mardi(8), 9)).toBe(true); // 09h30 WAT >= 9h
    expect(isStandupDue(mardi(8), 10)).toBe(false);
  });

  it("l'heure limite par défaut est bien 11h", () => {
    expect(STANDUP_CUTOFF_HOUR).toBe(11);
  });
});
