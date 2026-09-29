import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  previewCatalogueSeed,
  commitCatalogueSeed,
  previewBaselineAssignments,
  commitBaselineAssignments,
  listImportBatches,
  ImportError,
} from "@/lib/access/import-server";

describe("import-server — catalogue seed", () => {
  let orgId: string;
  let actorId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Import Org", slug: `test-import-${Date.now()}` },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: { orgId, email: `actor-${Date.now()}@example.com`, name: "Actor", role: "CEO" },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.importBatch.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  const SEED_CSV =
    "utilisateur;nom_complet;departement;logiciel;niveau_acces\n" +
    "u1;U1;NULL;NOUVEAU-LOGICIEL;NOUVEAU-LOGICIEL-reader\n" +
    "u2;U2;NULL;NOUVEAU-LOGICIEL;NOUVEAU-LOGICIEL-admin\n";

  it("prévisualisation : ne crée rien, marque tout DRAFT_CREATED pour un catalogue vide", async () => {
    const batch = await previewCatalogueSeed(orgId, actorId, "seed.csv", SEED_CSV);
    expect(batch.totalRows).toBe(2);
    expect(batch.committedAt).toBeNull();
    expect(batch.rows.every((r) => r.outcome === "DRAFT_CREATED")).toBe(true);

    const assetCount = await prisma.accessAsset.count({ where: { orgId } });
    expect(assetCount).toBe(0);
  });

  it("commit : crée l'actif UNE SEULE FOIS pour 2 niveaux du même nouveau logiciel", async () => {
    const preview = await previewCatalogueSeed(orgId, actorId, "seed.csv", SEED_CSV);
    const committed = await commitCatalogueSeed(orgId, actorId, preview.id);

    expect(committed.committedAt).not.toBeNull();
    const assets = await prisma.accessAsset.findMany({ where: { orgId, name: "NOUVEAU-LOGICIEL" } });
    expect(assets).toHaveLength(1);
    const levels = await prisma.accessLevel.findMany({ where: { assetId: assets[0].id } });
    expect(levels.map((l) => l.name).sort()).toEqual([
      "NOUVEAU-LOGICIEL-admin",
      "NOUVEAU-LOGICIEL-reader",
    ]);
    expect(levels.every((l) => l.priority === null && l.isAdmin === null)).toBe(true);
  });

  it("un deuxième commit du même lot échoue", async () => {
    const preview = await previewCatalogueSeed(orgId, actorId, "seed.csv", SEED_CSV);
    await commitCatalogueSeed(orgId, actorId, preview.id);
    await expect(commitCatalogueSeed(orgId, actorId, preview.id)).rejects.toThrow(ImportError);
  });

  it("une paire déjà au catalogue est MATCHED, rien n'est recréé", async () => {
    const asset = await prisma.accessAsset.create({ data: { orgId, name: "DEJA-LA" } });
    await prisma.accessLevel.create({ data: { assetId: asset.id, name: "DEJA-LA-reader" } });

    const csv =
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\nu1;U1;NULL;DEJA-LA;DEJA-LA-reader\n";
    const preview = await previewCatalogueSeed(orgId, actorId, "seed2.csv", csv);
    expect(preview.rows[0].outcome).toBe("MATCHED");
    expect(preview.rows[0].resolvedAssetId).toBe(asset.id);

    const committed = await commitCatalogueSeed(orgId, actorId, preview.id);
    expect(committed.rows[0].outcome).toBe("MATCHED");
    const levelCount = await prisma.accessLevel.count({ where: { assetId: asset.id } });
    expect(levelCount).toBe(1);
  });
});

describe("import-server — baseline assignments", () => {
  let orgId: string;
  let actorId: string;
  let employeeId: string;
  let assetId: string;
  let levelAId: string;
  let levelBId: string;
  let otherAssetId: string;
  let otherLevelId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Baseline Org", slug: `test-baseline-${Date.now()}` },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: { orgId, email: `actor-bl-${Date.now()}@example.com`, name: "Actor", role: "CEO" },
    });
    actorId = actor.id;
    const employee = await prisma.user.create({
      data: { orgId, email: `emp-${Date.now()}@example.com`, name: "Employee", role: "PO" },
    });
    employeeId = employee.id;
    await prisma.accessProfile.create({ data: { orgId, userId: employeeId, lifecycle: "ACTIVE" } });

    const asset = await prisma.accessAsset.create({ data: { orgId, name: "Asset" } });
    assetId = asset.id;
    const levelA = await prisma.accessLevel.create({ data: { assetId, name: "Level A" } });
    levelAId = levelA.id;
    const levelB = await prisma.accessLevel.create({ data: { assetId, name: "Level B" } });
    levelBId = levelB.id;

    const otherAsset = await prisma.accessAsset.create({ data: { orgId, name: "Other Asset" } });
    otherAssetId = otherAsset.id;
    const otherLevel = await prisma.accessLevel.create({ data: { assetId: otherAssetId, name: "Other Level" } });
    otherLevelId = otherLevel.id;
  });

  afterAll(async () => {
    await prisma.importBatch.deleteMany({ where: { orgId } });
    await prisma.accessAssignmentEvent.deleteMany({ where: { orgId } });
    await prisma.accessAssignment.deleteMany({ where: { orgId } });
    await prisma.accessLevel.deleteMany({ where: { asset: { orgId } } });
    await prisma.accessAsset.deleteMany({ where: { orgId } });
    await prisma.accessProfile.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("ligne valide : TO_CREATE en prévisualisation, ACTIVE/IMPORTED_UNREVIEWED/LEGACY_IMPORT au commit", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("TO_CREATE");
    expect(preview.committedAt).toBeNull();

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).not.toBeNull();
    expect(committed.rows[0].outcome).toBe("TO_CREATE");

    const assignment = await prisma.accessAssignment.findFirst({ where: { userId: employeeId, assetId } });
    expect(assignment).not.toBeNull();
    expect(assignment?.status).toBe("ACTIVE");
    expect(assignment?.verification).toBe("IMPORTED_UNREVIEWED");
    expect(assignment?.source).toBe("LEGACY_IMPORT");
    expect(assignment?.levelId).toBe(levelAId);

    const event = await prisma.accessAssignmentEvent.findFirst({ where: { assignmentId: assignment?.id } });
    expect(event?.sourceType).toBe("IMPORT");
    expect(event?.sourceId).toBe(preview.id);
    expect(event?.outcome).toBe("ASSIGNED");

    // Nettoyage pour les tests suivants du même describe.
    await prisma.accessAssignmentEvent.deleteMany({ where: { assignmentId: assignment?.id } });
    await prisma.accessAssignment.delete({ where: { id: assignment!.id } });
  });

  it("access_level_id existant mais appartenant à un AUTRE actif → UNRESOLVED, jamais accepté", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${otherLevelId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("UNRESOLVED");
    expect(preview.rows[0].reason).toMatch(/introuvable|appartenant/i);

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).toBeNull();
    const assignment = await prisma.accessAssignment.findFirst({ where: { userId: employeeId, assetId } });
    expect(assignment).toBeNull();
  });

  it("deux lignes du même fichier pour (employé, actif) avec des niveaux différents → CONFLICT, tout le lot bloqué", async () => {
    const csv =
      `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}\n${employeeId};${assetId};${levelBId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows.every((r) => r.outcome === "CONFLICT")).toBe(true);

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).toBeNull();
    const count = await prisma.accessAssignment.count({ where: { userId: employeeId, assetId } });
    expect(count).toBe(0);
  });

  it("employé OFFBOARDING/DEPARTED → UNRESOLVED", async () => {
    const departed = await prisma.user.create({
      data: { orgId, email: `departed-${Date.now()}@example.com`, name: "Departed", role: "PO" },
    });
    await prisma.accessProfile.create({ data: { orgId, userId: departed.id, lifecycle: "DEPARTED" } });

    const csv = `user_id;asset_id;access_level_id\n${departed.id};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("UNRESOLVED");

    await prisma.accessProfile.deleteMany({ where: { userId: departed.id } });
    await prisma.user.delete({ where: { id: departed.id } });
  });

  it("ré-upload du même fichier après commit réussi : no-op complet, aucune deuxième création", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const first = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    await commitBaselineAssignments(orgId, actorId, first.id);

    const second = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(second.rows[0].outcome).toBe("NOOP_UNCHANGED");
    const committedSecond = await commitBaselineAssignments(orgId, actorId, second.id);
    expect(committedSecond.committedAt).not.toBeNull();

    const count = await prisma.accessAssignment.count({ where: { userId: employeeId, assetId } });
    expect(count).toBe(1);

    const assignment = await prisma.accessAssignment.findFirstOrThrow({ where: { userId: employeeId, assetId } });
    await prisma.accessAssignmentEvent.deleteMany({ where: { assignmentId: assignment.id } });
    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
  });

  it("affectation native (source REQUEST) existante avec un niveau différent → CONFLICT, jamais écrasée", async () => {
    const native = await prisma.accessAssignment.create({
      data: { orgId, userId: employeeId, assetId, levelId: levelAId, status: "ACTIVE", source: "REQUEST" },
    });

    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelBId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("CONFLICT");

    await commitBaselineAssignments(orgId, actorId, preview.id);
    const unchanged = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: native.id } });
    expect(unchanged.levelId).toBe(levelAId);
    expect(unchanged.source).toBe("REQUEST");

    await prisma.accessAssignment.delete({ where: { id: native.id } });
  });

  it("affectation REVOKED existante → CONFLICT, jamais ressuscitée", async () => {
    const revoked = await prisma.accessAssignment.create({
      data: {
        orgId, userId: employeeId, assetId, levelId: levelAId,
        status: "REVOKED", source: "LEGACY_IMPORT", revokedAt: new Date(),
      },
    });

    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("CONFLICT");

    await commitBaselineAssignments(orgId, actorId, preview.id);
    const stillRevoked = await prisma.accessAssignment.findUniqueOrThrow({ where: { id: revoked.id } });
    expect(stillRevoked.status).toBe("REVOKED");

    await prisma.accessAssignment.delete({ where: { id: revoked.id } });
  });

  it("revalidation au commit : un niveau archivé entre la prévisualisation et le commit bloque le lot", async () => {
    const toArchive = await prisma.accessLevel.create({ data: { assetId, name: "À archiver" } });
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${toArchive.id}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    expect(preview.rows[0].outcome).toBe("TO_CREATE");

    await prisma.accessLevel.update({ where: { id: toArchive.id }, data: { archivedAt: new Date() } });

    const committed = await commitBaselineAssignments(orgId, actorId, preview.id);
    expect(committed.committedAt).toBeNull();
    expect(committed.rows[0].outcome).toBe("UNRESOLVED");
    const count = await prisma.accessAssignment.count({ where: { userId: employeeId, assetId } });
    expect(count).toBe(0);

    await prisma.accessLevel.delete({ where: { id: toArchive.id } });
  });

  it("un deuxième commit d'un lot déjà commité échoue", async () => {
    const csv = `user_id;asset_id;access_level_id\n${employeeId};${assetId};${levelAId}`;
    const preview = await previewBaselineAssignments(orgId, actorId, "baseline.csv", csv);
    await commitBaselineAssignments(orgId, actorId, preview.id);
    await expect(commitBaselineAssignments(orgId, actorId, preview.id)).rejects.toThrow(ImportError);

    const assignment = await prisma.accessAssignment.findFirstOrThrow({ where: { userId: employeeId, assetId } });
    await prisma.accessAssignmentEvent.deleteMany({ where: { assignmentId: assignment.id } });
    await prisma.accessAssignment.delete({ where: { id: assignment.id } });
  });
});

describe("import-server — historique", () => {
  let orgId: string;
  let actorId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test History Org", slug: `test-history-${Date.now()}` },
    });
    orgId = org.id;
    const actor = await prisma.user.create({
      data: { orgId, email: `actor-hist-${Date.now()}@example.com`, name: "Actor", role: "CEO" },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.importBatch.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("liste les lots de l'org, triés du plus récent au plus ancien, filtrable par mode", async () => {
    await previewCatalogueSeed(
      orgId, actorId, "a.csv",
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\nu;U;NULL;L;N\n"
    );
    await previewBaselineAssignments(orgId, actorId, "b.csv", "user_id;asset_id;access_level_id\nu1;a1;l1\n");

    const all = await listImportBatches(orgId);
    expect(all).toHaveLength(2);
    expect(all[0].fileName).toBe("b.csv");
    expect(all[0].actorName).toBe("Actor");

    const seedOnly = await listImportBatches(orgId, "CATALOGUE_SEED");
    expect(seedOnly).toHaveLength(1);
    expect(seedOnly[0].fileName).toBe("a.csv");
  });

  it("n'affiche jamais les lots d'une autre organisation", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: "Other Org", slug: `other-${Date.now()}` },
    });
    const otherActor = await prisma.user.create({
      data: { orgId: otherOrg.id, email: `other-${Date.now()}@example.com`, name: "Other", role: "CEO" },
    });
    await previewCatalogueSeed(
      otherOrg.id, otherActor.id, "isolated.csv",
      "utilisateur;nom_complet;departement;logiciel;niveau_acces\nu;U;NULL;L;N\n"
    );

    const mine = await listImportBatches(orgId);
    expect(mine.some((b) => b.fileName === "isolated.csv")).toBe(false);

    await prisma.importBatch.deleteMany({ where: { orgId: otherOrg.id } });
    await prisma.user.delete({ where: { id: otherActor.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});
