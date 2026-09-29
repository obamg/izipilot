import { describe, it, expect } from "vitest";
import { canInitiateDepartmentReduction } from "@/lib/access/requests-read-server";

describe("canInitiateDepartmentReduction", () => {
  it("le chef effectif DU département autorise", () => {
    const result = canInitiateDepartmentReduction(
      [{ role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "dept-1" }],
      "dept-1"
    );
    expect(result).toBe(true);
  });

  it("le chef effectif d'un AUTRE département n'autorise pas", () => {
    const result = canInitiateDepartmentReduction(
      [{ role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: "dept-2" }],
      "dept-1"
    );
    expect(result).toBe(false);
  });

  it("CISO autorise quel que soit le département", () => {
    const result = canInitiateDepartmentReduction(
      [{ role: "CISO", actsAsPrimary: true, departmentId: null }],
      "dept-1"
    );
    expect(result).toBe(true);
  });

  it("IT_ACCESS_OPERATOR autorise quel que soit le département", () => {
    const result = canInitiateDepartmentReduction(
      [{ role: "IT_ACCESS_OPERATOR", actsAsPrimary: true, departmentId: null }],
      "dept-1"
    );
    expect(result).toBe(true);
  });

  it("un simple employé sans aucun de ces rôles n'autorise pas", () => {
    const result = canInitiateDepartmentReduction(
      [{ role: "AUDIT_VIEWER", actsAsPrimary: true, departmentId: null }],
      "dept-1"
    );
    expect(result).toBe(false);
  });

  it("aucun rôle effectif n'autorise pas", () => {
    expect(canInitiateDepartmentReduction([], "dept-1")).toBe(false);
  });
});
