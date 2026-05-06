"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  isOpen = false,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`bg-dark border-r border-white/[0.06] py-4 overflow-y-auto w-[250px] shrink-0
          fixed lg:static inset-y-0 left-0 z-50 top-[56px]
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
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px transition-all no-underline ${
                  isActive
                    ? "bg-teal/[0.18] text-[#7dd8d8]"
                    : "text-white/[0.75] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {item.icon}
                {item.label}
                {item.href === "/weekly" && (() => {
                  const now = new Date();
                  const isBeforeDeadline = now.getDay() === 1 && now.getHours() < 9;
                  return isBeforeDeadline ? (
                    <span className="ml-auto bg-[rgba(226,60,74,0.28)] text-[#ff8090] text-sm font-semibold px-[5px] py-px rounded-md">
                      Due
                    </span>
                  ) : null;
                })()}
                {item.href === "/notifications" && notificationCount > 0 && (
                  <span className="ml-auto bg-[rgba(226,60,74,0.28)] text-[#ff8090] text-sm font-semibold px-[5px] py-px rounded-md">
                    {notificationCount}
                  </span>
                )}
                {item.href === "/alerts" && alertCount > 0 && (
                  <span className="ml-auto bg-[rgba(226,60,74,0.28)] text-[#ff8090] text-sm font-semibold px-[5px] py-px rounded-md">
                    {alertCount}
                  </span>
                )}
              </Link>
            );
          })}
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
                    className={`flex items-center gap-2 py-[7px] px-[9px] rounded-[7px] cursor-pointer text-sm mb-px transition-all no-underline ${
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
