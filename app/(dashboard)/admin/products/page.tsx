import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ProductsGrid } from "@/components/admin/ProductsGrid";

export default async function AdminProductsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const [products, users] = await Promise.all([
    prisma.product.findMany({
      where: { orgId },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { objectives: { where: { isActive: true } } } },
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const serialized = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    color: p.color,
    description: p.description,
    status: p.status,
    isActive: p.isActive,
    ownerId: p.owner.id,
    ownerName: p.owner.name,
    objectiveCount: p._count.objectives,
  }));

  return (
    <div>
      <AdminPageHeader
        title="Produits"
        subtitle={`${products.filter((p) => p.isActive).length} produit(s) actif(s)`}
      />
      <ProductsGrid products={serialized} users={users} />
    </div>
  );
}
