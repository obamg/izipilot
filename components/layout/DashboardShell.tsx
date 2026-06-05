"use client";

import { useState } from "react";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";

interface SidebarEntity {
  code: string;
  name: string;
  color: string;
  scorePercent: number;
}

interface DashboardShellProps {
  children: React.ReactNode;
  userName: string;
  userRole: string;
  weekNumber: number;
  year: number;
  alertCount: number;
  notificationCount: number;
  products: SidebarEntity[];
  departments: SidebarEntity[];
}

export function DashboardShell({
  children,
  userName,
  userRole,
  weekNumber,
  year,
  alertCount,
  notificationCount,
  products,
  departments,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen">
      <Nav
        userName={userName}
        userRole={userRole}
        weekNumber={weekNumber}
        year={year}
        alertCount={alertCount}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile menu button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed bottom-4 left-4 z-[var(--z-fab)] lg:hidden w-11 h-11 bg-teal text-white rounded-full flex items-center justify-center shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
          aria-label="Menu"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="w-5 h-5"
          >
            {sidebarOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>

        <Sidebar
          products={products}
          departments={departments}
          alertCount={alertCount}
          notificationCount={notificationCount}
          userRole={userRole}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
