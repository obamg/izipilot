import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { OrgSettingsForm } from "@/components/admin/OrgSettingsForm";

export default async function AdminOrganizationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: {
        select: {
          users: { where: { isActive: true } },
          departments: { where: { isActive: true } },
          products: { where: { isActive: true } },
          objectives: { where: { isActive: true } },
          keyResults: { where: { isActive: true } },
        },
      },
    },
  });

  if (!org) redirect("/dashboard");

  const orgData = {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logoUrl: org.logoUrl,
    primaryColor: org.primaryColor,
    plan: org.plan,
    createdAt: org.createdAt.toISOString(),
    counts: org._count,
  };

  return (
    <div>
      <AdminPageHeader
        title="Organisation"
        subtitle={org.name}
      />
      <OrgSettingsForm org={orgData} />
    </div>
  );
}
