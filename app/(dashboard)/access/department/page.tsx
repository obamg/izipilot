import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssignmentsTable } from "@/components/access/AssignmentsTable";
import { RegisterFilterForm } from "@/components/access/RegisterFilterForm";
import {
  getRegisterNav,
  listAssetOptions,
  listAssignments,
  RegisterNotFoundError,
} from "@/lib/access/register-server";
import { registerRequestFromQuery } from "@/lib/access/register";
import { registerQuerySchema, type RegisterQuery } from "@/lib/validations/access";

const PAGE_SIZE = 25;

export default async function DepartmentAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id: userId, orgId } = session.user;

  const nav = await getRegisterNav(orgId, userId);
  if (!nav.hasDepartmentView || !nav.defaultDepartmentId) notFound();

  // Paramètre invalide → vue par défaut du lecteur, sans erreur (spec §6).
  const parsed = registerQuerySchema.safeParse(await searchParams);
  const query: RegisterQuery = parsed.success
    ? {
        ...parsed.data,
        view: "department",
        departmentId: parsed.data.departmentId ?? nav.defaultDepartmentId,
        pageSize: PAGE_SIZE,
      }
    : { view: "department", departmentId: nav.defaultDepartmentId, assetId: undefined, levelId: undefined, q: undefined, page: 1, pageSize: PAGE_SIZE };
  const req = registerRequestFromQuery(query);
  if (!req || req.view.kind !== "DEPARTMENT") notFound();
  const departmentId = req.view.departmentId;

  let result;
  try {
    result = await listAssignments({
      viewer: { userId, orgId },
      view: req.view,
      filters: req.filters,
      pagination: { page: query.page, pageSize: PAGE_SIZE },
    });
  } catch (err) {
    if (err instanceof RegisterNotFoundError) notFound();
    throw err;
  }

  const assetOptions = await listAssetOptions(orgId);
  const isAll = departmentId === "ALL";
  const departmentName = isAll
    ? "Tous les départements"
    : nav.departments.find((d) => d.id === departmentId)?.name ?? "Département";

  const baseQuery: Record<string, string> = { view: "department", departmentId };
  if (req.filters.assetId) baseQuery.assetId = req.filters.assetId;
  if (req.filters.q) baseQuery.q = req.filters.q;

  return (
    <div>
      <AdminPageHeader
        title="Accès du département"
        subtitle={`${departmentName} · ${result.total} accès courant${result.total > 1 ? "s" : ""}`}
      />
      <RegisterFilterForm
        action="/access/department"
        view="department"
        departments={{ options: nav.departments, selected: departmentId, allowAll: nav.canSeeAll }}
        assets={{ options: assetOptions, selected: req.filters.assetId, label: "Application" }}
        search={{ value: req.filters.q }}
      />
      <AssignmentsTable
        rows={result.rows}
        total={result.total}
        page={query.page}
        pageSize={PAGE_SIZE}
        basePath="/access/department"
        baseQuery={baseQuery}
        showEmployee={false}
        showDepartment={isAll}
        groupBy="employee"
        emptyMessage={
          req.filters.assetId || req.filters.q
            ? "Aucun accès ne correspond à ces filtres."
            : "Aucun employé de ce département n'a d'accès enregistré."
        }
      />
    </div>
  );
}
