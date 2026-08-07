"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* App-style bottom tab bar, mobile/tablet only (hidden ≥ lg where the sidebar
 * is always visible). Four primary destinations + a Menu tab that opens the
 * sidebar drawer for everything else. Sits above the drawer (z-fab > z-drawer)
 * so Menu stays reachable while the drawer is open. */

interface MobileTabBarProps {
  alertCount?: number;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onNavigate: () => void;
}

const TABS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[22px] h-[22px]">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/weekly",
    label: "Ma revue",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[22px] h-[22px]">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    href: "/alerts",
    label: "Alertes",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[22px] h-[22px]">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
  },
  {
    href: "/synthesis",
    label: "Synthèse",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[22px] h-[22px]">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
] as const;

export function MobileTabBar({
  alertCount = 0,
  menuOpen,
  onMenuToggle,
  onNavigate,
}: MobileTabBarProps) {
  const pathname = usePathname();

  const tabClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[52px] no-underline cursor-pointer border-none bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-inset ${
      active ? "text-[#7dd8d8]" : "text-white/[0.55] active:text-white"
    }`;

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed bottom-0 inset-x-0 z-[var(--z-fab)] lg:hidden bg-dark border-t border-white/[0.08] flex items-stretch px-1 pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((tab) => {
        const isActive = !menuOpen && pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={tabClass(isActive)}
          >
            <span className="relative">
              {tab.icon}
              {tab.href === "/alerts" && alertCount > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-gold rounded-full flex items-center justify-center text-[9px] font-bold text-dark px-1">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium leading-none">{tab.label}</span>
          </Link>
        );
      })}
      <button
        onClick={onMenuToggle}
        aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
        aria-expanded={menuOpen}
        className={tabClass(menuOpen)}
      >
        {menuOpen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-[22px] h-[22px]">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-[22px] h-[22px]">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        )}
        <span className="text-[10px] font-medium leading-none">Menu</span>
      </button>
    </nav>
  );
}
