import { describe, it, expect } from "vitest";
import {
  pushGateDecision,
  isExemptReason,
  EXEMPT_REASONS,
  type PushGateInput,
} from "@/lib/push-gate";

// Cas de base : quelqu'un de concerné, sans abonnement, sans dérogation.
const base: PushGateInput = {
  role: "CONTRIBUTOR",
  owesDailyReport: true,
  hasSubscription: false,
  isExempt: false,
};
const g = (over: Partial<PushGateInput> = {}) =>
  pushGateDecision({ ...base, ...over });

describe("pushGateDecision", () => {
  it("bloque un participant sans abonnement", () => {
    expect(g()).toBe("REQUIRED");
  });

  it("laisse passer dès qu'un abonnement existe", () => {
    expect(g({ hasSubscription: true })).toBe("OK");
  });

  it("ne bloque JAMAIS un VIEWER", () => {
    // Lecture seule : on ne lui notifie rien, on ne lui demande rien.
    expect(g({ role: "VIEWER" })).toBe("OK");
  });

  it("ne bloque pas quelqu'un hors du rapport quotidien", () => {
    // Même périmètre que le cron de rappel : bloquer quelqu'un à qui on ne
    // demande jamais rien serait gratuit.
    expect(g({ owesDailyReport: false })).toBe("OK");
  });

  it("laisse passer une dérogation, en la distinguant d'un abonnement", () => {
    // EXEMPT et non OK : le management doit pouvoir compter ces gens à part,
    // ils ne recevront aucun rappel.
    expect(g({ isExempt: true })).toBe("EXEMPT");
  });

  it("un abonnement l'emporte sur une dérogation devenue caduque", () => {
    // Quelqu'un exempté puis passé sur un navigateur capable : il est couvert,
    // pas « dérogé ». Sinon il resterait affiché en dérogation pour toujours.
    expect(g({ isExempt: true, hasSubscription: true })).toBe("OK");
  });

  it("le VIEWER prime sur tout le reste", () => {
    expect(g({ role: "VIEWER", owesDailyReport: true, isExempt: false })).toBe("OK");
  });

  it.each(["CEO", "MANAGEMENT", "PO", "CONTRIBUTOR"] as const)(
    "bloque aussi un %s — l'obligation ne connaît pas de rang",
    (role) => {
      expect(g({ role })).toBe("REQUIRED");
    }
  );
});

describe("isExemptReason", () => {
  it("accepte les motifs de la liste fermée", () => {
    for (const k of Object.keys(EXEMPT_REASONS)) {
      expect(isExemptReason(k)).toBe(true);
    }
  });

  it("refuse un refus de permission déguisé en motif", () => {
    // Volontairement absent de la liste : un refus se rattrape dans les
    // réglages du navigateur, l'accepter ici viderait l'obligation.
    expect(isExemptReason("DENIED")).toBe(false);
    expect(isExemptReason("PERMISSION_DENIED")).toBe(false);
  });

  it("refuse n'importe quoi d'autre", () => {
    expect(isExemptReason("")).toBe(false);
    expect(isExemptReason(null)).toBe(false);
    expect(isExemptReason(42)).toBe(false);
    expect(isExemptReason("toString")).toBe(false);
  });
});
