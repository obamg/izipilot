import { describe, it, expect } from "vitest";
import { isAvailable, resolveActingUser } from "@/lib/access/roles";
import type { RoleAssignmentLike, UserAvailability } from "@/lib/access/types";

function availability(overrides: Partial<UserAvailability> = {}): UserAvailability {
  return { userId: "u1", isActive: true, lifecycle: "ACTIVE", ...overrides };
}

describe("isAvailable", () => {
  it("est disponible si actif et ACTIVE", () => {
    expect(isAvailable(availability())).toBe(true);
  });

  it("est indisponible si désactivé, même sans lifecycle DEPARTED", () => {
    expect(isAvailable(availability({ isActive: false }))).toBe(false);
  });

  it("est indisponible si OFFBOARDING ou DEPARTED", () => {
    expect(isAvailable(availability({ lifecycle: "OFFBOARDING" }))).toBe(false);
    expect(isAvailable(availability({ lifecycle: "DEPARTED" }))).toBe(false);
  });

  it("est disponible si lifecycle est absent (pas encore de profil)", () => {
    expect(isAvailable(availability({ lifecycle: null }))).toBe(true);
  });
});

describe("resolveActingUser", () => {
  const availabilityMap = new Map<string, UserAvailability>([
    ["primary", availability({ userId: "primary" })],
    ["backup", availability({ userId: "backup" })],
  ]);

  it("le titulaire disponible agit en tant que titulaire", () => {
    const assignment: RoleAssignmentLike = {
      role: "HR",
      userId: "primary",
      departmentId: null,
      backupUserId: "backup",
      primaryUnavailable: false,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toEqual({
      userId: "primary",
      actsAsPrimary: true,
    });
  });

  it("le suppléant agit quand le titulaire est marqué indisponible", () => {
    const assignment: RoleAssignmentLike = {
      role: "HR",
      userId: "primary",
      departmentId: null,
      backupUserId: "backup",
      primaryUnavailable: true,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toEqual({
      userId: "backup",
      actsAsPrimary: false,
    });
  });

  it("le suppléant agit quand le titulaire est désactivé, sans bascule explicite", () => {
    const map = new Map(availabilityMap);
    map.set("primary", availability({ userId: "primary", isActive: false }));
    const assignment: RoleAssignmentLike = {
      role: "HR",
      userId: "primary",
      departmentId: null,
      backupUserId: "backup",
      primaryUnavailable: false,
    };
    expect(resolveActingUser(assignment, map)).toEqual({
      userId: "backup",
      actsAsPrimary: false,
    });
  });

  it("ne renvoie personne si le titulaire est indisponible et qu'il n'y a pas de suppléant", () => {
    const assignment: RoleAssignmentLike = {
      role: "HR",
      userId: "primary",
      departmentId: null,
      backupUserId: null,
      primaryUnavailable: true,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toBeNull();
  });

  it("ne renvoie personne si le suppléant lui-même est désactivé", () => {
    const map = new Map(availabilityMap);
    map.set("backup", availability({ userId: "backup", isActive: false }));
    const assignment: RoleAssignmentLike = {
      role: "HR",
      userId: "primary",
      departmentId: null,
      backupUserId: "backup",
      primaryUnavailable: true,
    };
    expect(resolveActingUser(assignment, map)).toBeNull();
  });

  it("le titulaire agit même si un suppléant est configuré, tant qu'il est disponible", () => {
    const assignment: RoleAssignmentLike = {
      role: "ASSET_ADMINISTRATOR",
      userId: "primary",
      departmentId: null,
      backupUserId: "backup",
      primaryUnavailable: false,
    };
    expect(resolveActingUser(assignment, availabilityMap)).toEqual({
      userId: "primary",
      actsAsPrimary: true,
    });
  });
});
