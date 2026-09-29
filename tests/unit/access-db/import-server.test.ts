import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { previewCatalogueSeed, commitCatalogueSeed, ImportError } from "@/lib/access/import-server";

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
