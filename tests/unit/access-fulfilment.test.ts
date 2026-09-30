import { describe, it, expect } from "vitest";
import {
  assignmentEffect,
  canTransition,
  fulfilmentNavFlags,
  nextTaskState,
  outcomeFor,
  ownerRoleFor,
  partialRemovalEffect,
  readOldRemovedAt,
  shortTaskReference,
  taskActionForKind,
  validateCompletionInput,
  type AssignmentSnapshot,
  type TaskState,
  type TaskTerms,
  type TaskTransition,
} from "@/lib/access/fulfilment";

const AT = new Date("2026-10-05T10:00:00.000Z");
const START = new Date("2026-10-01T00:00:00.000Z");
const END = new Date("2026-12-31T00:00:00.000Z");

function terms(over: Partial<TaskTerms> = {}): TaskTerms {
  return { fromLevelId: null, toLevelId: "L2", periodStart: START, periodEnd: null, oldRemoved: false, ...over };
}
function snap(over: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
  return { status: "ACTIVE", levelId: "L1", periodStart: START, periodEnd: null, ...over };
}

describe("taskActionForKind", () => {
  it("associe chaque type de demande à une action d'exécution", () => {
    expect(taskActionForKind("GRANT")).toBe("GRANT");
    expect(taskActionForKind("UPGRADE")).toBe("CHANGE_LEVEL");
    expect(taskActionForKind("REDUCE")).toBe("CHANGE_LEVEL");
    expect(taskActionForKind("RENEW")).toBe("RENEW");
    expect(taskActionForKind("REVOKE")).toBe("REVOKE");
  });
});

describe("machine à états des tâches", () => {
  const valid: [TaskState, TaskTransition, TaskState][] = [
    ["READY", "CLAIM", "CLAIMED"],
    ["CLAIMED", "HANDOVER", "CLAIMED"],
    ["BLOCKED", "HANDOVER", "BLOCKED"],
    ["CLAIMED", "BLOCK", "BLOCKED"],
    ["CLAIMED", "PARTIAL_REMOVAL", "BLOCKED"],
    ["BLOCKED", "RESUME", "CLAIMED"],
    ["CLAIMED", "COMPLETE", "COMPLETED"],
    ["READY", "CANCEL", "CANCELLED"],
    ["CLAIMED", "RECONCILE", "CANCELLED"],
    ["BLOCKED", "RECONCILE", "CANCELLED"],
  ];
  it.each(valid)("%s --%s--> %s", (from, transition, to) => {
    expect(nextTaskState(from, transition)).toBe(to);
    expect(canTransition(from, transition)).toBe(true);
  });

  const invalid: [TaskState, TaskTransition][] = [
    ["READY", "COMPLETE"],
    ["READY", "BLOCK"],
    ["READY", "RECONCILE"],
    ["READY", "HANDOVER"],
    ["CLAIMED", "CLAIM"],
    ["CLAIMED", "CANCEL"],
    ["BLOCKED", "COMPLETE"],
    ["BLOCKED", "CANCEL"],
  ];
  it.each(invalid)("%s --%s--> refusé", (from, transition) => {
    expect(nextTaskState(from, transition)).toBeNull();
    expect(canTransition(from, transition)).toBe(false);
  });

  it("COMPLETED et CANCELLED sont immuables", () => {
    const all: TaskTransition[] = ["CLAIM", "HANDOVER", "BLOCK", "PARTIAL_REMOVAL", "RESUME", "COMPLETE", "CANCEL", "RECONCILE"];
    for (const t of all) {
      expect(canTransition("COMPLETED", t)).toBe(false);
      expect(canTransition("CANCELLED", t)).toBe(false);
    }
  });
});

describe("outcomeFor", () => {
  it("donne le résultat métier de chaque action", () => {
    expect(outcomeFor("GRANT")).toBe("PROVISIONED");
    expect(outcomeFor("CHANGE_LEVEL")).toBe("CHANGED");
    expect(outcomeFor("RENEW")).toBe("RENEWED");
    expect(outcomeFor("REVOKE")).toBe("REVOKED");
    expect(outcomeFor("EXPIRY_REMOVAL")).toBe("REMOVED");
  });
});

describe("assignmentEffect — tableau §5 ligne par ligne", () => {
  it("GRANT sans affectation → ACTIVE au niveau cible, période de la version, grantedAt = date réelle", () => {
    const e = assignmentEffect("GRANT", null, terms({ periodEnd: END }), AT);
    expect(e).toEqual({
      ok: true,
      write: { status: "ACTIVE", levelId: "L2", periodStart: START, periodEnd: END, grantedAt: AT, revokedAt: null },
    });
  });

  it("GRANT sur une ligne REVOKED ou EXPIRED_REMOVAL_PENDING (D-23) → ACTIVE", () => {
    expect(assignmentEffect("GRANT", snap({ status: "REVOKED", levelId: null }), terms(), AT).ok).toBe(true);
    expect(assignmentEffect("GRANT", snap({ status: "EXPIRED_REMOVAL_PENDING" }), terms(), AT).ok).toBe(true);
  });

  it("GRANT sur une ligne ACTIVE avec niveau → refusé (l'affectation a changé)", () => {
    expect(assignmentEffect("GRANT", snap(), terms(), AT)).toEqual({ ok: false, reason: "L'affectation a changé depuis l'approbation" });
  });

  it("CHANGE_LEVEL depuis le niveau attendu → niveau cible, période de la version", () => {
    const e = assignmentEffect("CHANGE_LEVEL", snap(), terms({ fromLevelId: "L1", periodEnd: END }), AT);
    expect(e).toEqual({
      ok: true,
      write: { status: "ACTIVE", levelId: "L2", periodStart: START, periodEnd: END, grantedAt: AT, revokedAt: null },
    });
  });

  it("CHANGE_LEVEL alors que le niveau courant n'est plus celui attendu → refusé", () => {
    expect(assignmentEffect("CHANGE_LEVEL", snap({ levelId: "L9" }), terms({ fromLevelId: "L1" }), AT).ok).toBe(false);
    expect(assignmentEffect("CHANGE_LEVEL", null, terms({ fromLevelId: "L1" }), AT).ok).toBe(false);
  });

  it("CHANGE_LEVEL après retrait partiel : attend « aucun accès » (REVOKED, niveau nul)", () => {
    const after = snap({ status: "REVOKED", levelId: null });
    expect(assignmentEffect("CHANGE_LEVEL", after, terms({ fromLevelId: "L1", oldRemoved: true }), AT).ok).toBe(true);
    expect(assignmentEffect("CHANGE_LEVEL", snap(), terms({ fromLevelId: "L1", oldRemoved: true }), AT).ok).toBe(false);
  });

  it("RENEW sur ACTIVE ou EXPIRED_REMOVAL_PENDING → ACTIVE, nouvelle fin, niveau et grantedAt inchangés", () => {
    for (const status of ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] as const) {
      const e = assignmentEffect("RENEW", snap({ status, periodEnd: AT }), terms({ toLevelId: "L1", periodEnd: END }), AT);
      expect(e).toEqual({
        ok: true,
        write: { status: "ACTIVE", levelId: "L1", periodStart: START, periodEnd: END, revokedAt: null },
      });
    }
  });

  it("RENEW sur une ligne REVOKED ou d'un autre niveau → refusé", () => {
    expect(assignmentEffect("RENEW", snap({ status: "REVOKED", levelId: null }), terms({ toLevelId: "L1" }), AT).ok).toBe(false);
    expect(assignmentEffect("RENEW", snap({ levelId: "L3" }), terms({ toLevelId: "L1" }), AT).ok).toBe(false);
  });

  it("REVOKE et EXPIRY_REMOVAL sur ACTIVE/EXPIRED_REMOVAL_PENDING → REVOKED, niveau nul, revokedAt = date réelle", () => {
    for (const action of ["REVOKE", "EXPIRY_REMOVAL"] as const) {
      for (const status of ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] as const) {
        const e = assignmentEffect(action, snap({ status, periodEnd: END }), terms({ toLevelId: null }), AT);
        expect(e).toEqual({
          ok: true,
          write: { status: "REVOKED", levelId: null, periodStart: START, periodEnd: END, revokedAt: AT },
        });
      }
    }
  });

  it("REVOKE sans affectation ou déjà REVOKED → refusé", () => {
    expect(assignmentEffect("REVOKE", null, terms({ toLevelId: null }), AT).ok).toBe(false);
    expect(assignmentEffect("REVOKE", snap({ status: "REVOKED", levelId: null }), terms({ toLevelId: null }), AT).ok).toBe(false);
  });
});

describe("partialRemovalEffect (D-10, A18)", () => {
  it("retire l'ancien niveau : REVOKED, niveau nul", () => {
    const e = partialRemovalEffect(snap(), terms({ fromLevelId: "L1" }), AT);
    expect(e).toEqual({
      ok: true,
      write: { status: "REVOKED", levelId: null, periodStart: START, periodEnd: null, revokedAt: AT },
    });
  });
  it("refusé si déjà enregistré ou si le niveau courant n'est pas l'ancien niveau", () => {
    expect(partialRemovalEffect(snap(), terms({ fromLevelId: "L1", oldRemoved: true }), AT).ok).toBe(false);
    expect(partialRemovalEffect(snap({ levelId: "L7" }), terms({ fromLevelId: "L1" }), AT).ok).toBe(false);
  });
});

describe("validateCompletionInput", () => {
  const now = AT;
  const claimedAt = new Date("2026-10-05T08:00:00.000Z");
  it("accepte une référence seule ou une note seule", () => {
    expect(validateCompletionInput({ completedAt: now, reference: "TICKET-1", note: null }, { now, claimedAt })).toBeNull();
    expect(validateCompletionInput({ completedAt: now, reference: null, note: "fait" }, { now, claimedAt })).toBeNull();
  });
  it("refuse l'absence de preuve, y compris des espaces seuls (Review Focus #5)", () => {
    expect(validateCompletionInput({ completedAt: now, reference: "   ", note: " \n " }, { now, claimedAt })).toBe(
      "Une référence ou une note d'exécution est obligatoire"
    );
  });
  it("tolère 5 minutes de décalage d'horloge, pas davantage (Review Focus #5)", () => {
    const in4min = new Date(now.getTime() + 4 * 60_000);
    const in6min = new Date(now.getTime() + 6 * 60_000);
    expect(validateCompletionInput({ completedAt: in4min, reference: "R", note: null }, { now, claimedAt })).toBeNull();
    expect(validateCompletionInput({ completedAt: in6min, reference: "R", note: null }, { now, claimedAt })).toBe(
      "La date d'exécution ne peut pas être dans le futur"
    );
  });
  it("refuse une date antérieure de plus d'un jour à la prise en charge", () => {
    const tooEarly = new Date(claimedAt.getTime() - 25 * 3_600_000);
    expect(validateCompletionInput({ completedAt: tooEarly, reference: "R", note: null }, { now, claimedAt })).toBe(
      "La date d'exécution précède de plus d'un jour la prise en charge de la tâche"
    );
  });
  it("refuse une date invalide et des textes trop longs", () => {
    expect(validateCompletionInput({ completedAt: new Date("x"), reference: "R", note: null }, { now, claimedAt })).toBe("Date d'exécution invalide");
    expect(validateCompletionInput({ completedAt: now, reference: "r".repeat(201), note: null }, { now, claimedAt })).toBe(
      "La référence dépasse 200 caractères"
    );
    expect(validateCompletionInput({ completedAt: now, reference: null, note: "n".repeat(2001) }, { now, claimedAt })).toBe(
      "La note dépasse 2000 caractères"
    );
  });
});

describe("ownerRoleFor", () => {
  it("propriétaire, suppléant, ou rien", () => {
    const asset = { ownerId: "o", backupOwnerId: "b" };
    expect(ownerRoleFor(asset, "o")).toBe("ASSET_OWNER");
    expect(ownerRoleFor(asset, "b")).toBe("ASSET_OWNER_BACKUP");
    expect(ownerRoleFor(asset, "x")).toBeNull();
    expect(ownerRoleFor({ ownerId: null, backupOwnerId: null }, "o")).toBeNull();
  });
});

describe("readOldRemovedAt", () => {
  it("lit progress.oldRemovedAt sans jamais planter", () => {
    expect(readOldRemovedAt({ oldRemovedAt: "2026-10-05T10:00:00.000Z" })).toBe("2026-10-05T10:00:00.000Z");
    expect(readOldRemovedAt(null)).toBeNull();
    expect(readOldRemovedAt([])).toBeNull();
    expect(readOldRemovedAt({ oldRemovedAt: 3 })).toBeNull();
  });
});

describe("fulfilmentNavFlags", () => {
  it("lien « Exécution » si au moins un actif d'exécution ou la portée ALL", () => {
    expect(fulfilmentNavFlags([{ kind: "SELF", userId: "u" }], [])).toEqual({ hasFulfilmentView: false, hasMineView: false, canOversee: false });
    expect(fulfilmentNavFlags([{ kind: "SELF", userId: "u" }], ["a1"])).toEqual({ hasFulfilmentView: true, hasMineView: true, canOversee: false });
    expect(fulfilmentNavFlags([{ kind: "SELF", userId: "u" }, { kind: "ALL" }], [])).toEqual({ hasFulfilmentView: true, hasMineView: false, canOversee: true });
  });
});

describe("shortTaskReference", () => {
  it("préfixe EX- et les 6 derniers caractères en majuscules", () => {
    expect(shortTaskReference("clx0000abcdef")).toBe("EX-ABCDEF");
  });
});
