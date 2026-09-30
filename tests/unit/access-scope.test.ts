import { describe, it, expect } from "vitest";
import { resolveReadScopes } from "@/lib/access/scope";
import type { EffectiveRole } from "@/lib/access/scope";

describe("resolveReadScopes", () => {
  it("un employé sans rôle du module ne voit que ses propres accès", () => {
    expect(resolveReadScopes("u1", [], [])).toEqual([{ kind: "SELF", userId: "u1" }]);
  });

  it("un chef de département voit son département en plus de lui-même", () => {
    const roles: EffectiveRole[] = [
      { role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "d1" },
    ];
    expect(resolveReadScopes("u1", roles, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
    ]);
  });

  it("CISO et COO voient tout", () => {
    const rolesCiso: EffectiveRole[] = [
      { role: "CISO", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", rolesCiso, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "ALL" },
    ]);

    const rolesCoo: EffectiveRole[] = [
      { role: "COO", actsAsPrimary: false, departmentId: null },
    ];
    expect(resolveReadScopes("u1", rolesCoo, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "ALL" },
    ]);
  });

  it("un propriétaire ou suppléant d'actif voit ses actifs, sans aucun rôle du module", () => {
    expect(resolveReadScopes("u1", [], ["asset-1", "asset-2"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1", "asset-2"] },
    ]);
  });

  it("l'Administrateur des actifs sans actif possédé ne voit que lui-même", () => {
    const roles: EffectiveRole[] = [
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, [])).toEqual([{ kind: "SELF", userId: "u1" }]);
  });

  it("l'Administrateur des actifs qui possède un actif le voit comme propriétaire", () => {
    const roles: EffectiveRole[] = [
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1"] },
    ]);
  });

  it("un Audit Viewer effectif obtient la portée AUDIT en plus de SELF", () => {
    const roles: EffectiveRole[] = [
      { role: "AUDIT_VIEWER", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, [])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "AUDIT" },
    ]);
  });

  it("cumule plusieurs portées dans un ordre stable", () => {
    const roles: EffectiveRole[] = [
      { role: "CISO", actsAsPrimary: true, departmentId: null },
      { role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "d1" },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1"] },
      { kind: "ALL" },
    ]);
  });
});
