import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssignmentsTable } from "@/components/access/AssignmentsTable";
import { listAssignments } from "@/lib/access/register-server";
import { registerQuerySchema } from "@/lib/validations/access";

const PAGE_SIZE = 25;

export default async function MyAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Paramètre invalide → vue par défaut, sans erreur (spec §6).
  const parsed = registerQuerySchema.safeParse(await searchParams);
  const page = parsed.success ? parsed.data.page : 1;

  const { rows, total } = await listAssignments({
    viewer: { userId: session.user.id, orgId: session.user.orgId },
    view: { kind: "SELF" },
    filters: {},
    pagination: { page, pageSize: PAGE_SIZE },
  });

  return (
    <div>
      <AdminPageHeader
        title="Mes accès"
        subtitle={`${total} accès enregistré${total > 1 ? "s" : ""}`}
      />
      <AssignmentsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        basePath="/access/me"
        baseQuery={{}}
        showEmployee={false}
        showDepartment={false}
        groupBy={null}
        emptyMessage="Aucun accès enregistré pour vous."
      />
    </div>
  );
}
