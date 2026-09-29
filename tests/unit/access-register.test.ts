import { describe, it, expect } from "vitest";
import {
  scopeToAssignmentWhere,
  authorizeView,
  buildAssignmentQuery,
  orderByForView,
  registerNavFlags,
  formatPeriod,
} from "@/lib/access/register";
import type { ReadScope } from "@/lib/access/scope";

const ORG = "org-1";

describe("scopeToAssignmentWhere", () => {
  it("SELF limite à l'utilisateur", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "SELF", userId: "u1" })).toEqual({
      orgId: ORG,
      userId: "u1",
    });
  });

  it("DEPARTMENT suit le département principal actuel via AccessProfile", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "DEPARTMENT", departmentId: "d1" })).toEqual({
      orgId: ORG,
      user: { accessProfile: { primaryDepartmentId: "d1" } },
    });
  });

  it("OWNED_ASSETS limite aux actifs possédés", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "OWNED_ASSETS", assetIds: ["a1", "a2"] })).toEqual({
      orgId: ORG,
      assetId: { in: ["a1", "a2"] },
    });
  });

  it("ALL couvre toute l'organisation, et seulement elle", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "ALL" })).toEqual({ orgId: ORG });
  });

  it("AUDIT et NONE ne correspondent à rien", () => {
    expect(scopeToAssignmentWhere(ORG, { kind: "AUDIT" })).toEqual({ orgId: ORG, id: { in: [] } });
    expect(scopeToAssignmentWhere(ORG, { kind: "NONE" })).toEqual({ orgId: ORG, id: { in: [] } });
  });

  it("porte orgId pour toutes les portées", () => {
    const scopes: ReadScope[] = [
      { kind: "SELF", userId: "u1" },
      { kind: "DEPARTMENT", departmentId: "d1" },
      { kind: "OWNED_ASSETS", assetIds: ["a1"] },
      { kind: "ALL" },
      { kind: "AUDIT" },
      { kind: "NONE" },
    ];
    for (const s of scopes) {
      expect(scopeToAssignmentWhere(ORG, s)).toMatchObject({ orgId: ORG });
    }
  });
});

describe("authorizeView", () => {
  const employee: ReadScope[] = [{ kind: "SELF", userId: "u1" }];
  const headOfD1: ReadScope[] = [
    { kind: "SELF", userId: "u1" },
    { kind: "DEPARTMENT", departmentId: "d1" },
  ];
  const ciso: ReadScope[] = [{ kind: "SELF", userId: "u1" }, { kind: "ALL" }];
  const owner: ReadScope[] = [
    { kind: "SELF", userId: "u1" },
    { kind: "OWNED_ASSETS", assetIds: ["a1", "a2"] },
  ];

  it("SELF est toujours accordée", () => {
    expect(authorizeView({ kind: "SELF" }, employee)).toEqual({ kind: "SELF", userId: "u1" });
  });

  it("le chef de d1 voit d1, pas d2", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d1" }, headOfD1)).toEqual({
      kind: "DEPARTMENT",
      departmentId: "d1",
    });
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d2" }, headOfD1)).toBeNull();
  });

  it("« Toutes » est refusée à un chef de département", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "ALL" }, headOfD1)).toBeNull();
  });

  it("le CISO voit « Toutes » et n'importe quel département", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "ALL" }, ciso)).toEqual({ kind: "ALL" });
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d9" }, ciso)).toEqual({
      kind: "DEPARTMENT",
      departmentId: "d9",
    });
  });

  it("un employé simple n'a ni vue département ni vue actifs", () => {
    expect(authorizeView({ kind: "DEPARTMENT", departmentId: "d1" }, employee)).toBeNull();
    expect(authorizeView({ kind: "ASSET" }, employee)).toBeNull();
  });

  it("le propriétaire voit tous ses actifs, ou un seul, jamais un actif non possédé", () => {
    expect(authorizeView({ kind: "ASSET" }, owner)).toEqual({
      kind: "OWNED_ASSETS",
      assetIds: ["a1", "a2"],
    });
    expect(authorizeView({ kind: "ASSET", assetId: "a2" }, owner)).toEqual({
      kind: "OWNED_ASSETS",
      assetIds: ["a2"],
    });
    expect(authorizeView({ kind: "ASSET", assetId: "a3" }, owner)).toBeNull();
  });

  it("le CISO sans actif possédé n'a pas la vue actifs (ALL ne la donne pas)", () => {
    expect(authorizeView({ kind: "ASSET" }, ciso)).toBeNull();
  });
});

describe("buildAssignmentQuery", () => {
  it("combine portée, statut courant et filtres en AND", () => {
    const where = buildAssignmentQuery(
      ORG,
      { kind: "SELF", userId: "u1" },
      { assetId: "a1", levelId: "l1", q: "  Awa " }
    );
    expect(where).toEqual({
      orgId: ORG,
      AND: [
        { orgId: ORG, userId: "u1" },
        { status: { in: ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] } },
        { assetId: "a1" },
        { levelId: "l1" },
        { user: { name: { contains: "Awa", mode: "insensitive" } } },
      ],
    });
  });

  it("les filtres n'élargissent jamais la portée : la clause SELF reste dans le AND, aucun OR", () => {
    const where = buildAssignmentQuery(ORG, { kind: "SELF", userId: "u1" }, { q: "autre personne" });
    expect(where.AND).toContainEqual({ orgId: ORG, userId: "u1" });
    expect(where).not.toHaveProperty("OR");
  });

  it("ignore une recherche vide ou faite d'espaces", () => {
    const where = buildAssignmentQuery(ORG, { kind: "ALL" }, { q: "   " });
    expect(where.AND).toHaveLength(2);
  });

  it("exclut toujours REVOKED", () => {
    const where = buildAssignmentQuery(ORG, { kind: "ALL" }, {});
    expect(where.AND).toContainEqual({ status: { in: ["ACTIVE", "EXPIRED_REMOVAL_PENDING"] } });
  });
});

describe("orderByForView", () => {
  it("vue département : par employé puis actif", () => {
    expect(orderByForView({ kind: "DEPARTMENT", departmentId: "d1" })).toEqual([
      { user: { name: "asc" } },
      { asset: { name: "asc" } },
      { id: "asc" },
    ]);
  });

  it("vue « Toutes » : par département, puis employé", () => {
    expect(orderByForView({ kind: "DEPARTMENT", departmentId: "ALL" })).toEqual([
      { user: { accessProfile: { primaryDepartment: { name: "asc" } } } },
      { user: { name: "asc" } },
      { asset: { name: "asc" } },
      { id: "asc" },
    ]);
  });

  it("mes accès et vue actifs : par actif puis employé", () => {
    const expected = [{ asset: { name: "asc" } }, { user: { name: "asc" } }, { id: "asc" }];
    expect(orderByForView({ kind: "SELF" })).toEqual(expected);
    expect(orderByForView({ kind: "ASSET" })).toEqual(expected);
  });
});

describe("registerNavFlags", () => {
  it("employé simple : aucune vue supplémentaire", () => {
    expect(registerNavFlags([{ kind: "SELF", userId: "u1" }])).toEqual({
      hasDepartmentView: false,
      hasOwnedAssetsView: false,
      canSeeAll: false,
    });
  });

  it("CISO : vue département et « Toutes », pas de vue actifs", () => {
    expect(registerNavFlags([{ kind: "SELF", userId: "u1" }, { kind: "ALL" }])).toEqual({
      hasDepartmentView: true,
      hasOwnedAssetsView: false,
      canSeeAll: true,
    });
  });

  it("chef + propriétaire", () => {
    expect(
      registerNavFlags([
        { kind: "SELF", userId: "u1" },
        { kind: "DEPARTMENT", departmentId: "d1" },
        { kind: "OWNED_ASSETS", assetIds: ["a1"] },
      ])
    ).toEqual({ hasDepartmentView: true, hasOwnedAssetsView: true, canSeeAll: false });
  });

  it("AUDIT ne donne aucune vue du registre", () => {
    expect(registerNavFlags([{ kind: "SELF", userId: "u1" }, { kind: "AUDIT" }])).toEqual({
      hasDepartmentView: false,
      hasOwnedAssetsView: false,
      canSeeAll: false,
    });
  });
});

describe("formatPeriod", () => {
  it("période inconnue (cas des accès importés)", () => {
    expect(formatPeriod(null, null)).toBe("Non renseignée");
  });

  it("début seul : en cours", () => {
    expect(formatPeriod("2026-03-01T10:00:00.000Z", null)).toBe("Depuis le 01/03/2026 · en cours");
  });

  it("début et fin", () => {
    expect(formatPeriod("2026-03-01T10:00:00.000Z", "2026-06-30T10:00:00.000Z")).toBe(
      "01/03/2026 → 30/06/2026"
    );
  });

  it("fin seule", () => {
    expect(formatPeriod(null, "2026-06-30T10:00:00.000Z")).toBe("Jusqu'au 30/06/2026");
  });
});
