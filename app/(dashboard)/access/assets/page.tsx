import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getEffectiveRoleHolders } from "@/lib/access/roles-server";
import { listAssets } from "@/lib/access/catalogue-server";
import { AssetsTable } from "@/components/access/AssetsTable";

export default async function AccessAssetsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const effectiveRoles = await getEffectiveRoleHolders(orgId, session.user.id);
  const isAssetAdmin = effectiveRoles.some((r) => r.role === "ASSET_ADMINISTRATOR");
  if (!isAssetAdmin) redirect("/dashboard");

  const [assets, users] = await Promise.all([
    listAssets(orgId),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Next.js sérialise les props d'un composant serveur vers un composant
  // client en JSON : les champs Date de AssetDTO/LevelDTO (Tâche 14) doivent
  // être convertis en chaînes ISO avant de traverser cette frontière.
  const serializedAssets = assets.map((a) => ({
    ...a,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    levels: a.levels.map((l) => ({
      ...l,
      archivedAt: l.archivedAt?.toISOString() ?? null,
    })),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Administration des actifs"
        subtitle={`${assets.length} application${assets.length > 1 ? "s" : ""} au catalogue`}
        action={
          <Link
            href="/access/assets/import"
            className="inline-flex items-center rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors no-underline"
          >
            Importer…
          </Link>
        }
      />
      <AssetsTable assets={serializedAssets} users={users} />
    </div>
  );
}
