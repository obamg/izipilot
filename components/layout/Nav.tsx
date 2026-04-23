"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";

interface NavProps {
  userName?: string;
  userRole?: string;
  weekNumber: number;
  year: number;
  alertCount?: number;
}

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/weekly", label: "Ma revue" },
  { href: "/synthesis", label: "Synthèse" },
  { href: "/history", label: "Historique" },
  { href: "/alerts", label: "Alertes" },
  { href: "/actions", label: "Actions" },
] as const;

export function Nav({ userName = "U", userRole, weekNumber, year, alertCount = 0 }: NavProps) {
  const pathname = usePathname();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <nav className="bg-dark h-[56px] flex items-center justify-between px-6 sticky top-0 z-[100] border-b border-white/[0.08]">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-3 no-underline group">
        <div className="w-[34px] h-[34px] bg-teal rounded-lg flex items-center justify-center shadow-sm shadow-teal/20">
          <svg viewBox="0 0 28 28" fill="none" className="w-[18px] h-[18px]">
            <circle cx="14" cy="14" r="10" stroke="white" strokeWidth="2" />
            <path
              d="M14 8L14 14L18 17"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="14" cy="14" r="2.5" fill="white" />
          </svg>
        </div>
        <span className="text-[18px] text-white font-light tracking-tight">
          Izi<span className="font-serif font-normal">Pilot</span>
        </span>
      </Link>

      {/* Tabs */}
      <div className="hidden md:flex items-center gap-1 bg-white/[0.06] rounded-lg p-1">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3.5 py-[7px] text-sm font-medium rounded-md transition-all no-underline ${
                isActive
                  ? "bg-teal text-white shadow-sm shadow-teal/25"
                  : "text-white/65 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
        {userRole === "CEO" && (
          <Link
            href="/admin"
            className={`px-3.5 py-[7px] text-sm font-medium rounded-md transition-all no-underline ${
              pathname.startsWith("/admin")
                ? "bg-teal text-white shadow-sm shadow-teal/25"
                : "text-white/65 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            Admin
          </Link>
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-white/50 bg-white/[0.07] px-3 py-1.5 rounded-full hidden sm:inline border border-white/[0.06]">
          S{String(weekNumber).padStart(2, "0")} &middot; {year}
        </span>

        {/* Bell */}
        <Link
          href="/alerts"
          className="w-[34px] h-[34px] rounded-lg flex items-center justify-center cursor-pointer relative no-underline transition-colors hover:bg-white/[0.1]"
          style={{
            background: alertCount > 0 ? "rgba(226,60,74,.15)" : "rgba(255,255,255,.06)",
            border: alertCount > 0 ? "1px solid rgba(226,60,74,.3)" : "1px solid rgba(255,255,255,.06)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke={alertCount > 0 ? "#ff8090" : "rgba(255,255,255,.45)"}
            strokeWidth="2"
            strokeLinecap="round"
            className="w-4 h-4"
          >
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-izi-red rounded-full border-2 border-dark flex items-center justify-center text-[10px] font-bold text-white">
              {alertCount}
            </span>
          )}
        </Link>

        {/* Avatar + Dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-[34px] h-[34px] bg-teal rounded-full flex items-center justify-center text-xs font-semibold text-white cursor-pointer border-2 border-teal-dk/30 hover:border-teal-md/50 transition-colors"
          >
            {initials}
          </button>
          {showMenu && (
            <div className="absolute right-0 top-[44px] bg-white rounded-xl shadow-xl border border-[#deeaea] py-1.5 min-w-[180px] z-50 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="px-4 py-2.5 text-sm text-dark-md font-medium border-b border-[#deeaea]">
                {userName}
              </div>
              <div className="px-4 py-1.5 text-xs text-izi-gray border-b border-[#deeaea]">
                {userRole}
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full text-left px-4 py-2.5 text-sm text-izi-red hover:bg-izi-red-lt transition-colors cursor-pointer border-none bg-transparent"
              >
                Se d&eacute;connecter
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
