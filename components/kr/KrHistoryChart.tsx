"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface DataPoint {
  week: string;
  score: number;
}

export function KrHistoryChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-izi-gray py-4 text-center">
        Aucune saisie hebdomadaire encore.
      </p>
    );
  }

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#deeaea" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 10, fill: "#5f6e7a" }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "#5f6e7a" }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid #deeaea",
            }}
            formatter={(v) => [`${v}%`, "Score"]}
          />
          <ReferenceLine y={70} stroke="#1d9e75" strokeDasharray="3 3" />
          <ReferenceLine y={40} stroke="#e23c4a" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#008081"
            strokeWidth={2}
            dot={{ r: 3, fill: "#008081" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
