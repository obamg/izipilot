"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface BurndownDatum {
  label: string;
  ideal: number;
  remaining: number | null;
}

export function BurndownChart({ data }: { data: BurndownDatum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-izi-gray py-4 text-center">
        Aucune donnée de burndown.
      </p>
    );
  }

  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#5f6e7a" }}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: "#5f6e7a" }}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
            }}
            formatter={(v, name) => [
              v === null ? "—" : `${v} pts`,
              name === "ideal" ? "Idéal" : "Restant",
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => (value === "ideal" ? "Idéal" : "Restant")}
          />
          <Line
            type="monotone"
            dataKey="ideal"
            stroke="#8a9aa5"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="remaining"
            stroke="#008081"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: "#008081" }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
