import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssignmentsTable } from "@/components/access/AssignmentsTable";
import { RegisterFilterForm } from "@/components/access/RegisterFilterForm";
import { getRegisterNav, listAssignments, RegisterNotFoundError } from "@/lib/access/register-server";
import { registerRequestFromQuery } from "@/lib/access/register";
import { registerQuerySchema, type RegisterQuery } from "@/lib/validations/access";

const PAGE_SIZE = 25;

export default async function OwnedAssetsAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, orgId } = session.user;

  const nav = await getRegisterNav(orgId, userId);
  if (!nav.hasOwnedAssetsView) notFound();

  // Paramètre invalide → vue par défaut, sans erreur (spec §6).
  const parsed = registerQuerySchema.safeParse(await searchParams);
  const query: RegisterQuery = parsed.success
    ? { ...parsed.data, view: "owned-assets", departmentId: undefined, pageSize: PAGE_SIZE }
    : { view: "owned-assets", page: 1, pageSize: PAGE_SIZE, departmentId: undefined, assetId: undefined, levelId: undefined, q: undefined };
  const req = registerRequestFromQuery(query);
  if (!req || req.view.kind !== "ASSET") notFound();
  const assetId = req.view.assetId;

  const selectedAsset = nav.ownedAssets.find((a) => a.id === assetId);
  // Un niveau n'a de sens que pour l'application sélectionnée : sinon (autre
  // application, aucune application, id saisi à la main) on l'ignore.
  const levelId =
    selectedAsset && req.filters.levelId && selectedAsset.levels.some((l) => l.id === req.filters.levelId)
      ? req.filters.levelId
      : undefined;
  const filters = { ...req.filters, levelId };

  let result;
  try {
    result = await listAssignments({
      viewer: { userId, orgId },
      view: req.view,
      filters,
      pagination: { page: query.page, pageSize: PAGE_SIZE },
    });
  } catch (err) {
    if (err instanceof RegisterNotFoundError) notFound();
    throw err;
  }

  const baseQuery: Record<string, string> = { view: "owned-assets" };
  if (assetId) baseQuery.assetId = assetId;
  if (levelId) baseQuery.levelId = levelId;

  const assetCount = nav.ownedAssets.length;

  return (
    <div>
      <AdminPageHeader
        title="Mes actifs"
        subtitle={`${assetCount} application${assetCount > 1 ? "s" : ""} · ${result.total} accès courant${result.total > 1 ? "s" : ""}`}
      />
      <RegisterFilterForm
        action="/access/owned-assets"
        view="owned-assets"
        assets={{ options: nav.ownedAssets, selected: assetId, label: "Application" }}
        levels={selectedAsset ? { options: selectedAsset.levels, selected: levelId } : undefined}
      />
      <AssignmentsTable
        rows={result.rows}
        total={result.total}
        page={query.page}
        pageSize={PAGE_SIZE}
        basePath="/access/owned-assets"
        baseQuery={baseQuery}
        showEmployee
        showDepartment
        groupBy="asset"
        emptyMessage={
          assetId || levelId
            ? "Aucun accès ne correspond à ces filtres."
            : "Personne n'a d'accès enregistré sur ces applications."
        }
      />
    </div>
  );
}
