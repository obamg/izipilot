"use client";

import { useRouter } from "next/navigation";
import { AlertCard } from "@/components/ui/AlertCard";
import type { AlertSeverity } from "@prisma/client";

interface DashboardAlert {
  id: string;
  title: string;
  subtitle: string;
  severity: AlertSeverity;
}

interface DashboardAlertsProps {
  alerts: DashboardAlert[];
}

export function DashboardAlerts({ alerts }: DashboardAlertsProps) {
  const router = useRouter();

  return (
    <div>
      {alerts.map((alert) => (
        <AlertCard
          key={alert.id}
          id={alert.id}
          title={alert.title}
          subtitle={alert.subtitle}
          severity={alert.severity}
          actionLabel="Voir"
          onAction={() => router.push(`/alerts?id=${alert.id}`)}
        />
      ))}
    </div>
  );
}
