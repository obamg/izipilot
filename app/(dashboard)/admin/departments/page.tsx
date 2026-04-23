import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DepartmentsGrid } from "@/components/admin/DepartmentsGrid";

export default async function AdminDepartmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const [departments, users] = await Promise.all([
    prisma.department.findMany({
      where: { orgId },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { objectives: { where: { isActive: true } } } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const serialized = departments.map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    color: d.color,
    description: d.description,
    isActive: d.isActive,
    ownerId: d.owner.id,
    ownerName: d.owner.name,
    objectiveCount: d._count.objectives,
    members: d.members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      userRole: m.user.role,
      role: m.role,
    })),
  }));

  return (
    <div>
      <AdminPageHeader
        title="D\u00e9partements"
        subtitle={`${departments.filter((d) => d.isActive).length} d\u00e9partement(s) actif(s)`}
      />
      <DepartmentsGrid departments={serialized} users={users} />
    </div>
  );
}
