import { redirect } from "next/navigation";
import { requireCEO } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listRoleAssignments, listDepartmentHeadCoverage } from "@/lib/access/roles-server";
import { listConfigIssues } from "@/lib/access/profile-server";
import { RoleAssignmentsTable } from "@/components/access/RoleAssignmentsTable";
import { ConfigIssuesPanel } from "@/components/access/ConfigIssuesPanel";
import { DepartmentHeadBackupPanel } from "@/components/access/DepartmentHeadBackupPanel";

export default async function AccessRolesPage() {
  let session;
  try {
    session = await requireCEO();
  } catch {
    redirect("/dashboard");
  }
  const orgId = session.user.orgId;

  const [assignments, issues, users, departments, coverage] = await Promise.all([
    listRoleAssignments(orgId),
    listConfigIssues(orgId),
    prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    listDepartmentHeadCoverage(orgId),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Administration des rôles"
        subtitle="Rôles du module de gestion des accès, suppléants et disponibilité"
      />
      <ConfigIssuesPanel issues={issues} departments={departments} />
      <DepartmentHeadBackupPanel coverage={coverage} users={users} />
      <RoleAssignmentsTable assignments={assignments} users={users} />
    </div>
  );
}
