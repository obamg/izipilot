import { describe, it, expect } from "vitest";
import {
  SUPPORT_PRIORITY_META,
  allowedTransitions,
  canTransition,
  compareQueue,
  computeDueAt,
  computeStats,
  formatHours,
  formatReference,
  hoursBetween,
  isOpenStatus,
  isOverdue,
  isTerminalStatus,
  type StatsInput,
} from "@/lib/support-request";

const T0 = new Date("2026-08-24T08:00:00.000Z");

describe("statuts", () => {
  it("classe les statuts ouverts et terminaux sans recouvrement", () => {
    expect(isOpenStatus("SUBMITTED")).toBe(true);
    expect(isOpenStatus("ON_HOLD")).toBe(true);
    expect(isOpenStatus("RESOLVED")).toBe(false);
    expect(isTerminalStatus("CLOSED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    // RESOLVED n'est ni ouvert ni terminal : la demande attend la clôture.
    expect(isOpenStatus("RESOLVED")).toBe(false);
    expect(isTerminalStatus("RESOLVED")).toBe(false);
  });
});

describe("transitions", () => {
  it("laisse le support piloter le traitement", () => {
    expect(allowedTransitions("SUBMITTED", "SUPPORT")).toContain("TRIAGED");
    expect(canTransition("IN_PROGRESS", "RESOLVED", "SUPPORT")).toBe(true);
    expect(canTransition("SUBMITTED", "CLOSED", "SUPPORT")).toBe(false);
  });

  it("limite le demandeur à l'annulation tant que rien n'est traité", () => {
    expect(allowedTransitions("SUBMITTED", "REQUESTER")).toEqual(["CANCELLED"]);
    expect(allowedTransitions("IN_PROGRESS", "REQUESTER")).toEqual(["CANCELLED"]);
    expect(canTransition("IN_PROGRESS", "RESOLVED", "REQUESTER")).toBe(false);
  });

  it("laisse le demandeur accepter ou refuser une résolution", () => {
    const opts = allowedTransitions("RESOLVED", "REQUESTER");
    expect(opts).toContain("CLOSED");
    expect(opts).toContain("IN_PROGRESS");
  });

  it("autorise la réouverture d'une demande close ou refusée", () => {
    expect(canTransition("CLOSED", "IN_PROGRESS", "SUPPORT")).toBe(true);
    expect(canTransition("REJECTED", "IN_PROGRESS", "SUPPORT")).toBe(true);
  });

  it("fige définitivement une demande annulée", () => {
    expect(allowedTransitions("CANCELLED", "SUPPORT")).toEqual([]);
    expect(allowedTransitions("CANCELLED", "REQUESTER")).toEqual([]);
  });
});

describe("SLA", () => {
  it("dérive l'échéance de la priorité", () => {
    expect(computeDueAt("URGENT", T0).toISOString()).toBe("2026-08-24T12:00:00.000Z");
    expect(computeDueAt("NORMAL", T0).toISOString()).toBe("2026-08-27T08:00:00.000Z");
  });

  it("ordonne les SLA du plus court au plus long", () => {
    expect(SUPPORT_PRIORITY_META.URGENT.slaHours).toBeLessThan(
      SUPPORT_PRIORITY_META.HIGH.slaHours
    );
    expect(SUPPORT_PRIORITY_META.HIGH.slaHours).toBeLessThan(
      SUPPORT_PRIORITY_META.NORMAL.slaHours
    );
    expect(SUPPORT_PRIORITY_META.NORMAL.slaHours).toBeLessThan(
      SUPPORT_PRIORITY_META.LOW.slaHours
    );
  });

  it("ne signale en retard qu'une demande encore ouverte", () => {
    const past = new Date("2026-08-23T08:00:00.000Z");
    expect(isOverdue({ status: "IN_PROGRESS", dueAt: past }, T0)).toBe(true);
    // Résolue en retard : ce n'est plus une demande à relancer.
    expect(isOverdue({ status: "RESOLVED", dueAt: past }, T0)).toBe(false);
    expect(isOverdue({ status: "CLOSED", dueAt: past }, T0)).toBe(false);
    expect(isOverdue({ status: "IN_PROGRESS", dueAt: null }, T0)).toBe(false);
  });

  it("accepte une échéance sérialisée en ISO", () => {
    expect(isOverdue({ status: "SUBMITTED", dueAt: "2026-08-23T08:00:00.000Z" }, T0)).toBe(true);
  });
});

describe("références", () => {
  it("formate avec un padding sur 4 chiffres", () => {
    expect(formatReference("IT", 2026, 42)).toBe("IT-2026-0042");
    expect(formatReference("it", 2026, 1)).toBe("IT-2026-0001");
  });

  it("garde le tri lexicographique cohérent avec le tri numérique", () => {
    const refs = [9, 10, 100, 1000].map((n) => formatReference("IT", 2026, n));
    expect([...refs].sort()).toEqual(refs);
  });
});

describe("file de traitement", () => {
  it("place l'urgent avant l'ancien", () => {
    const urgent = { priority: "URGENT" as const, createdAt: new Date("2026-08-24T10:00:00Z") };
    const oldNormal = { priority: "NORMAL" as const, createdAt: new Date("2026-08-01T10:00:00Z") };
    expect(compareQueue(urgent, oldNormal)).toBeLessThan(0);
  });

  it("départage deux demandes de même priorité par ancienneté", () => {
    const older = { priority: "NORMAL" as const, createdAt: new Date("2026-08-01T10:00:00Z") };
    const newer = { priority: "NORMAL" as const, createdAt: new Date("2026-08-20T10:00:00Z") };
    expect(compareQueue(older, newer)).toBeLessThan(0);
  });
});

describe("statistiques", () => {
  const base: StatsInput = {
    status: "SUBMITTED",
    priority: "NORMAL",
    category: "INCIDENT",
    assigneeId: null,
    dueAt: null,
    createdAt: T0,
    firstResponseAt: null,
    resolvedAt: null,
  };

  it("compte ouvertes, non assignées et en retard", () => {
    const stats = computeStats(
      [
        { ...base, dueAt: new Date("2026-08-23T08:00:00Z") },
        { ...base, status: "IN_PROGRESS", assigneeId: "u1" },
        { ...base, status: "CLOSED", assigneeId: "u1" },
      ],
      T0
    );
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(2);
    expect(stats.unassigned).toBe(1);
    expect(stats.overdue).toBe(1);
  });

  it("ignore les demandes non résolues dans le délai moyen", () => {
    const stats = computeStats(
      [
        { ...base, status: "CLOSED", resolvedAt: new Date("2026-08-24T12:00:00Z") },
        { ...base, status: "IN_PROGRESS" },
      ],
      T0
    );
    // 4 h sur la seule demande résolue — la seconde ne tire pas la moyenne à 2 h.
    expect(stats.avgResolutionHours).toBe(4);
    expect(stats.resolvedThisPeriod).toBe(1);
  });

  it("renvoie null plutôt que zéro quand rien n'est mesurable", () => {
    const stats = computeStats([base], T0);
    expect(stats.avgResolutionHours).toBeNull();
    expect(stats.avgFirstResponseHours).toBeNull();
  });

  it("trie les répartitions par volume décroissant", () => {
    const stats = computeStats(
      [
        { ...base, category: "ACCESS" },
        { ...base, category: "INCIDENT" },
        { ...base, category: "INCIDENT" },
      ],
      T0
    );
    expect(stats.byCategory[0]).toEqual({ category: "INCIDENT", count: 2 });
  });

  it("gère un périmètre vide", () => {
    const stats = computeStats([], T0);
    expect(stats).toMatchObject({ total: 0, open: 0, overdue: 0, unassigned: 0 });
    expect(stats.byCategory).toEqual([]);
  });
});

describe("formatage", () => {
  it("calcule un écart en heures au dixième", () => {
    expect(hoursBetween(T0, new Date("2026-08-24T11:30:00Z"))).toBe(3.5);
  });

  it("affiche les durées en minutes, heures puis jours", () => {
    expect(formatHours(null)).toBe("—");
    expect(formatHours(0.5)).toBe("30 min");
    expect(formatHours(6)).toBe("6 h");
    expect(formatHours(48)).toBe("2 j");
    expect(formatHours(52)).toBe("2 j 4 h");
  });
});
