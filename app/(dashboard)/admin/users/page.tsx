import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { UsersTable } from "@/components/admin/UsersTable";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const users = await prisma.user.findMany({
    where: { orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const serialized = users.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Utilisateurs"
        subtitle={`${users.length} utilisateur(s) \u2014 ${users.filter((u) => u.isActive).length} actif(s)`}
      />
      <UsersTable users={serialized} currentUserId={session.user.id} />
    </div>
  );
}
