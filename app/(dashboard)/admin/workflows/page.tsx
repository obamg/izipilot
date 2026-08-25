import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { WorkflowsManager } from "@/components/admin/WorkflowsManager";
import { ensureDefaultWorkflow } from "@/lib/board-column-server";
import { sortColumns } from "@/lib/board-column";

export const dynamic = "force-dynamic";

/** Flux de tableau : les colonnes que chaque équipe voit sur son board. */
export default async function AdminWorkflowsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  await ensureDefaultWorkflow(orgId);

  const [workflows, products, departments] = await Promise.all([
    prisma.boardWorkflow.findMany({
      where: { orgId },
      include: {
        columns: {
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          include: { _count: { select: { tasks: true } } },
        },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.product.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true, color: true, workflowId: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, code: true, name: true, color: true, workflowId: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const serialized = workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    isDefault: w.isDefault,
    columns: sortColumns(w.columns).map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      category: c.category,
      sortOrder: c.sortOrder,
      wipLimit: c.wipLimit,
      taskCount: c._count.tasks,
    })),
  }));

  const teams = [
    ...products.map((p) => ({
      key: `P:${p.id}`,
      kind: "Produit" as const,
      code: p.code,
      name: p.name,
      color: p.color,
      workflowId: p.workflowId,
    })),
    ...departments.map((d) => ({
      key: `D:${d.id}`,
      kind: "Département" as const,
      code: d.code,
      name: d.name,
      color: d.color,
      workflowId: d.workflowId,
    })),
  ];

  return (
    <div>
      <AdminPageHeader
        title="Flux de tableau"
        subtitle="Les colonnes que chaque équipe voit sur son sprint. Le libellé est libre ; la catégorie, elle, pilote les statistiques."
      />
      <WorkflowsManager workflows={serialized} teams={teams} />
    </div>
  );
}
