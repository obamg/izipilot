"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface VelocityDatum {
  name: string;
  committedPoints: number;
  completedPoints: number;
}

export function VelocityChart({ data }: { data: VelocityDatum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-izi-gray py-4 text-center">
        Pas encore de sprint clôturé pour calculer la vélocité.
      </p>
    );
  }

  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#5f6e7a" }} />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "#5f6e7a" }}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
            }}
            formatter={(v, name) => [
              `${v} pts`,
              name === "committedPoints" ? "Engagé" : "Réalisé",
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) =>
              value === "committedPoints" ? "Engagé" : "Réalisé"
            }
          />
          <Bar dataKey="committedPoints" fill="#b3e0e0" radius={[3, 3, 0, 0]} />
          <Bar dataKey="completedPoints" fill="#008081" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
