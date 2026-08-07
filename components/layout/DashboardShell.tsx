"use client";

import { useState } from "react";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";
import { MobileTabBar } from "./MobileTabBar";

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
        <Sidebar
          products={products}
          departments={departments}
          alertCount={alertCount}
          notificationCount={notificationCount}
          userRole={userRole}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="flex-1 overflow-y-auto p-6 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-6">
          {children}
        </main>
      </div>
      <MobileTabBar
        alertCount={alertCount}
        menuOpen={sidebarOpen}
        onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
        onNavigate={() => setSidebarOpen(false)}
      />
    </div>
  );
}
