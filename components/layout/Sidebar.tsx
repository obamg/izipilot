"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface SidebarEntity {
  code: string;
  name: string;
  color: string;
  scorePercent: number;
}

interface SidebarProps {
  products: SidebarEntity[];
  departments: SidebarEntity[];
  alertCount?: number;
  notificationCount?: number;
  userRole?: string;
  canManageAccessRoles?: boolean;
  canManageAccessAssets?: boolean;
  canViewAccessAudit?: boolean;
  canViewDepartmentAccess?: boolean;
  canViewOwnedAssetsAccess?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/weekly",
    label: "Ma revue hebdo",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    badge: "Due",
  },
  {
    href: "/synthesis",
    label: "Synth\u00e8se Management",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "Historique & courbes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: "/notifications",
    label: "Mes notifications",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
      </svg>
    ),
  },
  {
    href: "/alerts",
    label: "Alertes & d\u00e9cisions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
  },
  {
    href: "/actions",
    label: "Actions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    href: "/actions?assignee=me",
    label: "Mes actions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: "/sprints",
    label: "Sprints",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="11" rx="1" />
        <rect x="17" y="4" width="4" height="8" rx="1" />
      </svg>
    ),
  },
  {
    href: "/support",
    label: "Demandes internes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.5" />
        <path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
      </svg>
    ),
  },
  {
    href: "/evaluations",
    label: "Évaluations",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <circle cx="12" cy="8" r="5" />
        <path d="M8.5 12.5L7 22l5-3 5 3-1.5-9.5" />
      </svg>
    ),
  },
  {
    href: "/my-evaluations",
    label: "Mes évaluations",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <circle cx="12" cy="8" r="4" />
        <path d="M6 21v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
      </svg>
    ),
  },
  {
    href: "/appraisals",
    label: "Bilans trimestriels",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <rect x="8" y="3" width="8" height="4" rx="1" />
        <path d="M9 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-3" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/my-appraisals",
    label: "Mon bilan",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    href: "/customer-metrics",
    label: "CRM",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        <circle cx="9" cy="10" r="1" fill="currentColor" />
        <circle cx="13" cy="10" r="1" fill="currentColor" />
        <circle cx="17" cy="10" r="1" fill="currentColor" />
      </svg>
    ),
  },
] as const;

const ADMIN_ITEMS = [
  { href: "/admin", label: "Vue d'ensemble" },
  { href: "/admin/users", label: "Utilisateurs" },
  { href: "/admin/products", label: "Produits" },
  { href: "/admin/departments", label: "D\u00e9partements" },
  { href: "/admin/okrs", label: "OKRs" },
  { href: "/admin/organization", label: "Organisation" },
];


export function Sidebar({
  products,
  departments,
  alertCount = 0,
  notificationCount = 0,
  userRole,
  canManageAccessRoles,
  canManageAccessAssets,
  canViewAccessAudit,
  canViewDepartmentAccess,
  canViewOwnedAssetsAccess,
  isOpen = false,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // /actions and /actions?assignee=me share a pathname — disambiguate by
  // comparing the relevant query param so each nav item highlights only on
  // its own URL.
  const assigneeParam = searchParams.get("assignee");
  function isNavActive(href: string): boolean {
    const [hrefPath, hrefQuery] = href.split("?");
    if (pathname !== hrefPath) return false;
    if (!hrefQuery) {
      // For plain hrefs (no query), require no special query on the URL.
      // Otherwise "Actions" would light up on /actions?assignee=me too.
      return !assigneeParam;
    }
    const want = new URLSearchParams(hrefQuery);
    for (const [k, v] of want) {
      if (searchParams.get(k) !== v) return false;
    }
    return true;
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[var(--z-overlay)] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`bg-dark border-r border-white/[0.06] py-4 overflow-y-auto w-[250px] shrink-0
          pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-4
          fixed lg:static inset-y-0 left-0 z-[var(--z-drawer)] top-[56px]
          transition-transform duration-200
          ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Navigation */}
        <div className="px-3 mb-5">
          <div className="text-sm font-semibold tracking-[0.1em] uppercase text-white/[0.40] px-2 mb-[5px]">
            Navigation
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                  isActive
                    ? "bg-teal/[0.18] text-[#7dd8d8]"
                    : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {item.icon}
                {item.label}
                {item.href === "/weekly" && (() => {
                  const now = new Date();
                  // Submission day = Sunday; deadline is Sunday 23:59.
                  const isBeforeDeadline = now.getDay() === 0;
                  return isBeforeDeadline ? (
                    <span className="ml-auto bg-[rgba(244,169,0,0.22)] text-[#f4a900] text-sm font-semibold px-[5px] py-px rounded-md">
                      Due
                    </span>
                  ) : null;
                })()}
                {item.href === "/notifications" && notificationCount > 0 && (
                  <span className="ml-auto bg-[rgba(244,169,0,0.22)] text-[#f4a900] text-sm font-semibold px-[5px] py-px rounded-md">
                    {notificationCount}
                  </span>
                )}
                {item.href === "/alerts" && alertCount > 0 && (
                  <span className="ml-auto bg-[rgba(244,169,0,0.22)] text-[#f4a900] text-sm font-semibold px-[5px] py-px rounded-md">
                    {alertCount}
                  </span>
                )}
              </Link>
            );
          })}

          {/* Flux de tableau — CEO, Management et PO (périmètre limité pour un PO) */}
          {(userRole === "CEO" || userRole === "MANAGEMENT" || userRole === "PO") && (
            <Link
              href="/workflows"
              onClick={onClose}
              className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                isNavActive("/workflows")
                  ? "bg-teal/[0.18] text-[#7dd8d8]"
                  : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                <rect x="3" y="4" width="4" height="16" rx="1" />
                <rect x="10" y="4" width="4" height="10" rx="1" />
                <rect x="17" y="4" width="4" height="13" rx="1" />
              </svg>
              Flux de tableau
            </Link>
          )}

          {/* Push-adoption panel — CEO + Management only */}
          {(userRole === "CEO" || userRole === "MANAGEMENT") && (
            <Link
              href="/push-adoption"
              onClick={onClose}
              className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                isNavActive("/push-adoption")
                  ? "bg-red/[0.20] text-[#ff8585]"
                  : "text-[#ff6b6b] hover:bg-red/[0.12] hover:text-[#ff8585]"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              Adoption notifications
            </Link>
          )}

          {/* Suivi des membres — CEO + Management only */}
          {(userRole === "CEO" || userRole === "MANAGEMENT") && (
            <Link
              href="/suivi-equipe"
              onClick={onClose}
              className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                isNavActive("/suivi-equipe")
                  ? "bg-white/[0.14] text-white"
                  : "text-[#9fb3bf] hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              Suivi de l&apos;équipe
            </Link>
          )}

          {/* Gestion des accès — un lien par droit effectif, pas un lien unique
              pour tout le module (fix wave, Critical C3). « Mes accès » est
              ouvert à tous (phase 2b) ; département/actifs suivent les portées
              de lecture ; /access/roles est réservé au CEO, /access/assets à
              l'Administrateur des actifs, /access/audit au Lecteur d'audit.
              Masquer un lien n'est qu'un confort : pages et API refusent de
              toute façon. */}
          {
            <>
              <div className="text-sm font-semibold tracking-[0.1em] uppercase text-white/[0.40] px-2 mb-[5px] mt-3">
                Accès
              </div>
              <Link
                href="/access/me"
                onClick={onClose}
                className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                  pathname === "/access/me"
                    ? "bg-teal/[0.18] text-[#7dd8d8]"
                    : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                Mes accès
              </Link>
              {canViewDepartmentAccess && (
                <Link
                  href="/access/department"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/department"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <path d="M3 21h18" />
                    <path d="M5 21V7l7-4 7 4v14" />
                    <path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
                  </svg>
                  Accès du département
                </Link>
              )}
              {canViewOwnedAssetsAccess && (
                <Link
                  href="/access/owned-assets"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/owned-assets"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                  Mes actifs
                </Link>
              )}
              {canManageAccessRoles && (
                <Link
                  href="/access/roles"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/roles"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Rôles
                </Link>
              )}
              {canManageAccessAssets && (
                <Link
                  href="/access/assets"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/assets"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  Actifs
                </Link>
              )}
              {canViewAccessAudit && (
                <Link
                  href="/access/audit"
                  onClick={onClose}
                  className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                    pathname === "/access/audit"
                      ? "bg-teal/[0.18] text-[#7dd8d8]"
                      : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                    <line x1="9" y1="12" x2="15" y2="12" />
                    <line x1="9" y1="16" x2="15" y2="16" />
                  </svg>
                  Journal d&apos;audit
                </Link>
              )}
            </>
          }
        </div>

        {/* Admin section — CEO only */}
        {userRole === "CEO" && (
          <>
            <div className="h-px bg-white/[0.06] mx-3 mb-[14px]" />
            <div className="px-3 mb-5">
              <div className="text-sm font-semibold tracking-[0.1em] uppercase text-white/[0.40] px-2 mb-[5px]">
                Administration
              </div>
              {ADMIN_ITEMS.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-dark transition-all no-underline ${
                      isActive
                        ? "bg-teal/[0.18] text-[#7dd8d8]"
                        : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 shrink-0">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
