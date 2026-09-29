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

  it("un propriétaire d'actif voit les affectations de ses actifs possédés", () => {
    const roles: EffectiveRole[] = [
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1", "asset-2"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1", "asset-2"] },
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

  it("cumule plusieurs portées sans doublon", () => {
    const roles: EffectiveRole[] = [
      { role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "d1" },
      { role: "ASSET_ADMINISTRATOR", actsAsPrimary: true, departmentId: null },
    ];
    expect(resolveReadScopes("u1", roles, ["asset-1"])).toEqual([
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
      { kind: "OWNED_ASSETS", assetIds: ["asset-1"] },
    ]);
  });
});
