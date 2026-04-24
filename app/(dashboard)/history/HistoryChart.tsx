"use client";

import { useState, useMemo } from "react";
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

interface Entity {
  id: string;
  code: string;
  name: string;
  color: string;
  type: "PRODUCT" | "DEPARTMENT";
}

interface KrWeeklyData {
  week: string;
  score: number;
  progress: number;
}

interface KrChartData {
  id: string;
  title: string;
  entityId: string;
  entityType: string;
  objectiveTitle: string;
  weeklyData: KrWeeklyData[];
}

interface HistoryChartProps {
  entities: Entity[];
  keyResults: KrChartData[];
  defaultEntityCode?: string;
}

export function HistoryChart({ entities, keyResults, defaultEntityCode }: HistoryChartProps) {
  const defaultEntity = defaultEntityCode
    ? entities.find((e) => e.code === defaultEntityCode)
    : undefined;

  const [selectedEntityId, setSelectedEntityId] = useState<string>(
    defaultEntity?.id ?? entities[0]?.id ?? ""
  );

  const selectedEntity = entities.find((e) => e.id === selectedEntityId);

  const filteredKrs = useMemo(
    () => keyResults.filter((kr) => kr.entityId === selectedEntityId),
    [keyResults, selectedEntityId]
  );

  // Build chart data: merge all KRs by week
  const chartData = useMemo(() => {
    const weekMap = new Map<string, Record<string, number>>();

    for (const kr of filteredKrs) {
      for (const entry of kr.weeklyData) {
        if (!weekMap.has(entry.week)) {
          weekMap.set(entry.week, {});
        }
        const row = weekMap.get(entry.week)!;
        row[kr.id] = entry.progress;
      }
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, data]) => ({
        week,
        ...data,
      }));
  }, [filteredKrs]);

  const hasData = chartData.length > 0;

  return (
    <div className="space-y-3">
      {/* Entity selector */}
      <div className="bg-white rounded-[10px] border border-[#deeaea] p-4">
        <label className="text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray mb-2 block">
          S&eacute;lectionner une entit&eacute;
        </label>
        <div className="flex flex-wrap gap-1.5">
          {entities.map((entity) => (
            <button
              key={entity.id}
              onClick={() => setSelectedEntityId(entity.id)}
              className={`flex items-center gap-[6px] px-3 py-[5px] rounded-md text-[11px] transition-all border ${
                selectedEntityId === entity.id
                  ? "border-teal bg-teal-lt text-dark font-medium"
                  : "border-transparent bg-izi-gray-lt text-izi-gray hover:bg-teal-lt"
              }`}
            >
              <div
                className="w-[6px] h-[6px] rounded-full shrink-0"
                style={{ backgroundColor: entity.color }}
              />
              {entity.code} {entity.name}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-[10px] border border-[#deeaea] p-4">
        <div className="mb-3">
          <div className="text-xs font-semibold text-dark">
            Progression &mdash; {selectedEntity?.code} {selectedEntity?.name}
          </div>
          <div className="text-[10px] text-izi-gray mt-px">
            {filteredKrs.length} Key Results
          </div>
        </div>

        {!hasData ? (
          <div className="h-[300px] flex items-center justify-center text-sm text-izi-gray">
            Aucune donn&eacute;e disponible pour cette entit&eacute;.
            <br />
            Les courbes appara&icirc;tront apr&egrave;s les premi&egrave;res saisies hebdomadaires.
          </div>
        ) : (
          <div className="h-[300px] sm:h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-lt)" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 10, fill: "var(--gray)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--gray-lt)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "var(--gray)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--gray-lt)" }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--dark)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "#fff",
                  }}
                  formatter={(value: unknown) => [`${Math.round(Number(value))}%`]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value: string) => {
                    const kr = filteredKrs.find((k) => k.id === value);
                    return kr ? kr.title : value;
                  }}
                />
                {filteredKrs.map((kr, i) => {
                  const colors = [
                    "var(--teal)",
                    "var(--green)",
                    "var(--gold)",
                    "var(--red)",
                    "#534AB7",
                    "#378ADD",
                    "#D85A30",
                    "#639922",
                    "#C0392B",
                  ];
                  return (
                    <Line
                      key={kr.id}
                      type="monotone"
                      dataKey={kr.id}
                      name={kr.id}
                      stroke={colors[i % colors.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* KR Legend (custom) */}
        {hasData && (
          <div className="mt-3 flex flex-wrap gap-3">
            {filteredKrs.map((kr, i) => {
              const colors = [
                "var(--teal)",
                "var(--green)",
                "var(--gold)",
                "var(--red)",
                "#534AB7",
                "#378ADD",
                "#D85A30",
                "#639922",
                "#C0392B",
              ];
              return (
                <div key={kr.id} className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: colors[i % colors.length] }}
                  />
                  <span className="text-[10px] text-izi-gray">{kr.title}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
