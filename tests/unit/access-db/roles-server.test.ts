import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";

describe("roles-server — getEffectiveRoleHolders", () => {
  let orgId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Roles Server Org", slug: `test-roles-server-${Date.now()}` },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    // Ordre sûr (comme profile-server.test.ts) : les affectations de rôle et
    // les profils d'abord (departmentId est SET NULL / CASCADE depuis
    // Department, mais Department.ownerId → User n'a pas de cascade), puis
    // les départements, puis les utilisateurs, puis l'org.
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.accessRoleAssignment.deleteMany({ where: { orgId } });
    await prisma.department.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  async function createUser(label: string, overrides: { isActive?: boolean } = {}) {
    return prisma.user.create({
      data: {
        orgId,
        email: `test-roles-server-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        name: `Roles Server ${label}`,
        role: "PO",
        isActive: overrides.isActive ?? true,
      },
    });
  }

  it("titulaire actif et non marqué indisponible agit comme primaire", async () => {
    const titulaire = await createUser("ciso-titulaire");

    await prisma.accessRoleAssignment.create({
      data: { orgId, role: "CISO", userId: titulaire.id },
    });

    const effective = await getEffectiveRoleHolders(orgId, titulaire.id);

    expect(effective).toContainEqual({
      role: "CISO",
      actsAsPrimary: true,
      departmentId: null,
    });
  });

  it("titulaire marqué indisponible : le suppléant actif agit à sa place, le titulaire n'apparaît plus", async () => {
    const titulaire = await createUser("coo-titulaire-unavailable");
    const backup = await createUser("coo-backup");

    await prisma.accessRoleAssignment.create({
      data: {
        orgId,
        role: "COO",
        userId: titulaire.id,
        backupUserId: backup.id,
        primaryUnavailable: true,
      },
    });

    const backupEffective = await getEffectiveRoleHolders(orgId, backup.id);
    expect(backupEffective).toContainEqual({
      role: "COO",
      actsAsPrimary: false,
      departmentId: null,
    });

    const titulaireEffective = await getEffectiveRoleHolders(orgId, titulaire.id);
    expect(titulaireEffective.some((r) => r.role === "COO")).toBe(false);
  });

  it("titulaire au profil AccessProfile.lifecycle DEPARTED : le suppléant actif agit même sans primaryUnavailable", async () => {
    const titulaire = await createUser("hr-titulaire-departed");
    const backup = await createUser("hr-backup");

    // isActive reste true : c'est bien le lifecycle DEPARTED du profil, pas la
    // désactivation du compte, qui doit rendre le titulaire indisponible ici.
    await prisma.accessProfile.create({
      data: { orgId, userId: titulaire.id, lifecycle: "DEPARTED" },
    });

    await prisma.accessRoleAssignment.create({
      data: {
        orgId,
        role: "HR",
        userId: titulaire.id,
        backupUserId: backup.id,
        primaryUnavailable: false,
      },
    });

    const backupEffective = await getEffectiveRoleHolders(orgId, backup.id);
    expect(backupEffective).toContainEqual({
      role: "HR",
      actsAsPrimary: false,
      departmentId: null,
    });
  });

  it("DEPARTMENT_HEAD : le propriétaire direct du département agit comme primaire sans aucune AccessRoleAssignment", async () => {
    const owner = await createUser("dept-owner-direct");
    const dept = await prisma.department.create({
      data: {
        orgId,
        code: `RS-${Date.now()}`,
        name: "Département test — chef direct",
        color: "#008081",
        ownerId: owner.id,
      },
    });

    const effective = await getEffectiveRoleHolders(orgId, owner.id);

    expect(effective).toContainEqual({
      role: "DEPARTMENT_HEAD",
      actsAsPrimary: true,
      departmentId: dept.id,
    });
  });

  it("DEPARTMENT_HEAD : le suppléant agit si le titulaire est marqué indisponible via l'affectation dédiée", async () => {
    // Double condition du code (lignes 149-161 de roles-server.ts, cf. son
    // commentaire) : il faut à la fois primaryUnavailable=true sur
    // l'affectation ET que le titulaire soit réellement indisponible
    // (isActive=false ici) pour que le suppléant agisse — contrairement aux
    // rôles non liés à un département, où une seule des deux conditions
    // suffit (lib/access/roles.ts, resolveActingUser).
    const owner = await createUser("dept-owner-unavailable", { isActive: false });
    const backup = await createUser("dept-backup-acting");
    const dept = await prisma.department.create({
      data: {
        orgId,
        code: `RS-${Date.now()}-a`,
        name: "Département test — suppléant agit",
        color: "#1d9e75",
        ownerId: owner.id,
      },
    });

    await prisma.accessRoleAssignment.create({
      data: {
        orgId,
        role: "DEPARTMENT_HEAD",
        departmentId: dept.id,
        userId: null,
        backupUserId: backup.id,
        primaryUnavailable: true,
      },
    });

    const effective = await getEffectiveRoleHolders(orgId, backup.id);
    expect(effective).toContainEqual({
      role: "DEPARTMENT_HEAD",
      actsAsPrimary: false,
      departmentId: dept.id,
    });
  });

  it("DEPARTMENT_HEAD : le suppléant N'agit PAS si primaryUnavailable est false, même si le titulaire est isActive=false (comportement existant, non « corrigé » ici)", async () => {
    // Titulaire créé directement inactif : ce test documente le comportement
    // à double condition déjà en place (lignes 149-161 de roles-server.ts) —
    // le suppléant d'un chef de département n'agit que si primaryUnavailable
    // est explicitement vrai, peu importe la disponibilité réelle du
    // titulaire. C'est une incohérence mineure déjà repérée et mise de côté
    // pour cette vague de correctifs (hors périmètre) : ce test vérifie ce
    // que le code fait réellement, pas ce qu'il « devrait » faire.
    const owner = await createUser("dept-owner-inactive-but-not-flagged", { isActive: false });
    const backup = await createUser("dept-backup-not-acting");
    const dept = await prisma.department.create({
      data: {
        orgId,
        code: `RS-${Date.now()}-b`,
        name: "Département test — suppléant n'agit pas",
        color: "#e23c4a",
        ownerId: owner.id,
      },
    });

    await prisma.accessRoleAssignment.create({
      data: {
        orgId,
        role: "DEPARTMENT_HEAD",
        departmentId: dept.id,
        userId: null,
        backupUserId: backup.id,
        primaryUnavailable: false,
      },
    });

    const effective = await getEffectiveRoleHolders(orgId, backup.id);
    expect(
      effective.some((r) => r.role === "DEPARTMENT_HEAD" && r.departmentId === dept.id)
    ).toBe(false);
  });

  it("utilisateur sans aucune affectation ni département possédé : tableau vide", async () => {
    const plain = await createUser("no-role-no-dept");

    const effective = await getEffectiveRoleHolders(orgId, plain.id);
    expect(effective).toEqual([]);
  });
});
