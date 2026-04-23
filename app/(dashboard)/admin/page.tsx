import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import Link from "next/link";

export default async function AdminOverviewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;

  const [org, usersByRole, products, departments, objectives, keyResults] =
    await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.user.groupBy({
        by: ["role"],
        where: { orgId },
        _count: true,
      }),
      prisma.product.count({ where: { orgId, isActive: true } }),
      prisma.department.count({ where: { orgId, isActive: true } }),
      prisma.objective.count({ where: { orgId, isActive: true } }),
      prisma.keyResult.count({
        where: { orgId, isActive: true, deletedAt: null },
      }),
    ]);

  const totalUsers = usersByRole.reduce((sum, r) => sum + r._count, 0);
  const roleMap = Object.fromEntries(
    usersByRole.map((r) => [r.role, r._count])
  );

  const PLAN_LABELS = { FREE: "Gratuit", PRO: "Pro", ENTERPRISE: "Enterprise" };

  const cards = [
    {
      label: "Utilisateurs",
      value: totalUsers,
      detail: `${roleMap.CEO ?? 0} CEO, ${roleMap.MANAGEMENT ?? 0} Mgmt, ${roleMap.PO ?? 0} PO, ${roleMap.VIEWER ?? 0} Viewer`,
      href: "/admin/users",
      color: "var(--teal)",
    },
    {
      label: "Produits",
      value: products,
      detail: `${products} actif(s)`,
      href: "/admin/products",
      color: "#185FA5",
    },
    {
      label: "D\u00e9partements",
      value: departments,
      detail: `${departments} actif(s)`,
      href: "/admin/departments",
      color: "#D85A30",
    },
    {
      label: "OKRs",
      value: `${objectives} / ${keyResults}`,
      detail: `${objectives} objectifs, ${keyResults} KRs`,
      href: "/admin/okrs",
      color: "var(--green)",
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Administration"
        subtitle={`${org?.name} \u2014 Plan ${PLAN_LABELS[org?.plan ?? "FREE"]}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[14px]">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="bg-white rounded-[10px] border border-[#deeaea] px-4 py-[14px] hover:border-teal-md transition-colors no-underline group"
          >
            <div className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-[5px]">
              {card.label}
            </div>
            <div
              className="font-serif text-[26px] leading-none mb-1"
              style={{ color: card.color }}
            >
              {card.value}
            </div>
            <div className="text-[10px] text-izi-gray">{card.detail}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-[10px] border border-[#deeaea] p-4">
        <div className="text-xs font-semibold text-dark mb-3">
          Actions rapides
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/users"
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white no-underline hover:bg-teal-dk transition-colors"
          >
            G&eacute;rer les utilisateurs
          </Link>
          <Link
            href="/admin/okrs"
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-transparent border border-teal-md text-teal no-underline hover:bg-teal-lt transition-colors"
          >
            G&eacute;rer les OKRs
          </Link>
          <Link
            href="/admin/organization"
            className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-transparent border border-teal-md text-teal no-underline hover:bg-teal-lt transition-colors"
          >
            Param&egrave;tres organisation
          </Link>
        </div>
      </div>
    </div>
  );
}
