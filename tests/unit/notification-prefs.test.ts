import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma module before importing the helper
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationPreference: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PREFS,
  filterRecipientsByPref,
  shouldNotify,
} from "@/lib/notification-prefs";

const findUnique = prisma.notificationPreference.findUnique as ReturnType<
  typeof vi.fn
>;
const findMany = prisma.notificationPreference.findMany as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
});

describe("DEFAULT_PREFS", () => {
  it("matches the pre-feature email behavior", () => {
    expect(DEFAULT_PREFS.weeklyReminder).toBe(true);
    expect(DEFAULT_PREFS.weeklyDigest).toBe(true);
    expect(DEFAULT_PREFS.krBlockedManual).toBe(true);
    expect(DEFAULT_PREFS.escalation48h).toBe(false);
    expect(DEFAULT_PREFS.entryMissing).toBe(false);
  });
});

describe("shouldNotify", () => {
  it("returns the default when the user has no prefs row", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await shouldNotify("u1", "weeklyReminder")).toBe(true);

    findUnique.mockResolvedValueOnce(null);
    expect(await shouldNotify("u1", "escalation48h")).toBe(false);
  });

  it("returns the stored value when the user has a prefs row", async () => {
    findUnique.mockResolvedValueOnce({ weeklyReminder: false });
    expect(await shouldNotify("u1", "weeklyReminder")).toBe(false);

    findUnique.mockResolvedValueOnce({ escalation48h: true });
    expect(await shouldNotify("u1", "escalation48h")).toBe(true);
  });
});

describe("filterRecipientsByPref", () => {
  it("returns empty array for empty input without querying DB", async () => {
    const result = await filterRecipientsByPref([], "weeklyDigest");
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("excludes users who opted out and keeps users with no row when default is true", async () => {
    findMany.mockResolvedValueOnce([
      { userId: "opted-out", weeklyDigest: false },
      { userId: "opted-in", weeklyDigest: true },
    ]);

    const recipients = [
      { id: "opted-out", email: "a@x" },
      { id: "opted-in", email: "b@x" },
      { id: "no-row", email: "c@x" },
    ];

    const kept = await filterRecipientsByPref(recipients, "weeklyDigest");
    expect(kept.map((r) => r.id)).toEqual(["opted-in", "no-row"]);
  });

  it("excludes users with no row when the default for that event is false", async () => {
    findMany.mockResolvedValueOnce([
      { userId: "opted-in", escalation48h: true },
    ]);

    const recipients = [
      { id: "opted-in", email: "a@x" },
      { id: "no-row", email: "b@x" },
    ];

    const kept = await filterRecipientsByPref(recipients, "escalation48h");
    expect(kept.map((r) => r.id)).toEqual(["opted-in"]);
  });
});
