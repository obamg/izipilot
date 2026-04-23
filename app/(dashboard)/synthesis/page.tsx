import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getISOWeek } from "@/lib/date";
import type { KrStatus } from "@prisma/client";

function getStatusFromScore(score: number): KrStatus {
  if (score >= 70) return "ON_TRACK";
  if (score >= 40) return "AT_RISK";
  return "BLOCKED";
}

function getScoreColor(score: number): string {
  if (score >= 70) return "var(--green)";
  if (score >= 40) return "var(--gold)";
  if (score > 0) return "var(--red)";
  return "var(--gray)";
}

interface EntityRow {
  code: string;
  name: string;
  color: string;
  entityType: string;
  objectives: {
    title: string;
    avgScore: number;
  }[];
  overallScore: number;
  actionsDone: number;
  actionsTotal: number;
}

export default async function SynthesisPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = session.user.orgId;
  const { weekNumber, year } = getISOWeek(new Date());

  // Only Management and CEO can see synthesis
  const canView = ["CEO", "MANAGEMENT"].includes(session.user.role);

  const [products, departments, companyObjectives] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        objectives: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          include: {
            keyResults: {
              where: { isActive: true },
              select: {
                score: true,
                _count: { select: { actions: true } },
                actions: { where: { status: "DONE" }, select: { id: true } },
              },
            },
          },
        },
      },
    }),
    prisma.department.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        objectives: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          include: {
            keyResults: {
              where: { isActive: true },
              select: {
                score: true,
                _count: { select: { actions: true } },
                actions: { where: { status: "DONE" }, select: { id: true } },
              },
            },
          },
        },
      },
    }),
    prisma.objective.findMany({
      where: { orgId, entityType: "COMPANY", isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        keyResults: {
          where: { isActive: true },
          select: { score: true },
        },
        children: {
          where: { isActive: true },
          select: {
            title: true,
            department: { select: { code: true, color: true } },
            product: { select: { code: true, color: true } },
            keyResults: {
              where: { isActive: true },
              select: { score: true },
            },
          },
        },
      },
    }),
  ]);

  function toEntityRow(
    entity: {
      code: string;
      name: string;
      color: string;
      objectives: {
        title: string;
        keyResults: { score: unknown; _count: { actions: number }; actions: { id: string }[] }[];
      }[];
    },
    entityType: string
  ): EntityRow {
    let actionsDone = 0;
    let actionsTotal = 0;

    const objectives = entity.objectives.map((obj) => {
      const scores = obj.keyResults.map((kr) => Number(kr.score) * 100);
      const avg =
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

      for (const kr of obj.keyResults) {
        actionsTotal += kr._count.actions;
        actionsDone += kr.actions.length;
      }

      return { title: obj.title, avgScore: avg };
    });

    const allScores = entity.objectives.flatMap((o) =>
      o.keyResults.map((kr) => Number(kr.score) * 100)
    );
    const overallScore =
      allScores.length > 0
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
        : 0;

    return {
      code: entity.code,
      name: entity.name,
      color: entity.color,
      entityType,
      objectives,
      overallScore,
      actionsDone,
      actionsTotal,
    };
  }

  const productRows = products.map((p) => toEntityRow(p, "PRODUCT"));
  const departmentRows = departments.map((d) => toEntityRow(d, "DEPARTMENT"));

  const companyData = companyObjectives.map((obj) => {
    const krScores = obj.keyResults.map((kr) => Number(kr.score) * 100);
    const avgScore = krScores.length > 0 ? Math.round(krScores.reduce((a, b) => a + b, 0) / krScores.length) : 0;
    return {
      title: obj.title,
      avgScore,
      children: obj.children.map((child) => {
        const childScores = child.keyResults.map((kr) => Number(kr.score) * 100);
        const childAvg = childScores.length > 0 ? Math.round(childScores.reduce((a, b) => a + b, 0) / childScores.length) : 0;
        const entity = child.product || child.department;
        return {
          code: entity?.code ?? "",
          color: entity?.color ?? "var(--teal)",
          title: child.title,
          avgScore: childAvg,
        };
      }),
    };
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <h1 className="font-serif text-[20px] text-dark">
            Synth&egrave;se Management
          </h1>
          <p className="text-[11px] text-izi-gray mt-0.5">
            S{String(weekNumber).padStart(2, "0")} &middot; {year} &middot; Vue
            consolid&eacute;e de tous les OKRs
          </p>
        </div>
      </div>

      {!canView ? (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">
            Cette vue est r&eacute;serv&eacute;e au Management et au CEO.
          </p>
        </div>
      ) : (
        <>
          {/* Company Strategic OKRs */}
          {companyData.length > 0 && (
            <div className="bg-white rounded-[10px] border border-[#deeaea] p-4 mb-3">
              <div className="text-xs font-semibold text-dark mb-3">Objectifs Strat&eacute;giques</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {companyData.map((obj, i) => (
                  <div key={i} className="border border-[#deeaea] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-medium text-dark flex-1">{obj.title}</span>
                      <span
                        className="font-mono text-sm font-semibold ml-2"
                        style={{ color: getScoreColor(obj.avgScore) }}
                      >
                        {obj.avgScore}%
                      </span>
                    </div>
                    <StatusBadge status={getStatusFromScore(obj.avgScore)} />
                    {obj.children.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#deeaea] space-y-1">
                        <div className="text-[8px] font-semibold uppercase tracking-wider text-izi-gray mb-1">
                          Objectifs align&eacute;s
                        </div>
                        {obj.children.map((child, ci) => (
                          <div key={ci} className="flex items-center gap-2">
                            <div
                              className="w-[5px] h-[5px] rounded-full shrink-0"
                              style={{ backgroundColor: child.color }}
                            />
                            <span className="text-[9px] text-izi-gray flex-1 truncate">
                              {child.code} {child.title}
                            </span>
                            <span
                              className="font-mono text-[9px] font-semibold"
                              style={{ color: getScoreColor(child.avgScore) }}
                            >
                              {child.avgScore}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Products */}
          <SynthesisTable title="Produits" rows={productRows} />

          {/* Departments */}
          <SynthesisTable title="D&eacute;partements" rows={departmentRows} />
        </>
      )}
    </div>
  );
}

function SynthesisTable({
  title,
  rows,
}: {
  title: string;
  rows: EntityRow[];
}) {
  return (
    <div className="bg-white rounded-[10px] border border-[#deeaea] p-4 mb-3">
      <div className="text-xs font-semibold text-dark mb-3">{title}</div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-izi-gray-lt">
              <th className="text-left py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray w-[180px]">
                Entit&eacute;
              </th>
              <th className="text-center py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                Obj. 1
              </th>
              <th className="text-center py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                Obj. 2
              </th>
              <th className="text-center py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                Obj. 3
              </th>
              <th className="text-center py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray w-[80px]">
                Score
              </th>
              <th className="text-center py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray w-[80px]">
                Statut
              </th>
              <th className="text-center py-2 px-2 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray w-[80px]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.code}
                className="border-b border-izi-gray-lt last:border-b-0 hover:bg-izi-gray-lt/50 transition-colors"
              >
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-[7px] h-[7px] rounded-full shrink-0"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="font-medium text-dark">
                      {row.code} {row.name}
                    </span>
                  </div>
                </td>
                {[0, 1, 2].map((i) => {
                  const obj = row.objectives[i];
                  return (
                    <td key={i} className="py-2.5 px-2 text-center">
                      {obj ? (
                        <div>
                          <span
                            className="font-mono text-[11px] font-semibold"
                            style={{ color: getScoreColor(obj.avgScore) }}
                          >
                            {obj.avgScore}%
                          </span>
                          <div className="text-[9px] text-izi-gray truncate max-w-[120px] mx-auto mt-px">
                            {obj.title}
                          </div>
                        </div>
                      ) : (
                        <span className="text-izi-gray">&mdash;</span>
                      )}
                    </td>
                  );
                })}
                <td className="py-2.5 px-2 text-center">
                  <span
                    className="font-mono text-xs font-semibold"
                    style={{ color: getScoreColor(row.overallScore) }}
                  >
                    {row.overallScore}%
                  </span>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <StatusBadge status={getStatusFromScore(row.overallScore)} />
                </td>
                <td className="py-2.5 px-2 text-center">
                  {row.actionsTotal > 0 ? (
                    <span className="font-mono text-[11px]">
                      <span className="font-semibold" style={{ color: "var(--green)" }}>{row.actionsDone}</span>
                      <span className="text-izi-gray">/{row.actionsTotal}</span>
                    </span>
                  ) : (
                    <span className="text-izi-gray">&mdash;</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {rows.map((row) => (
          <div
            key={row.code}
            className="border border-izi-gray-lt rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-[7px] h-[7px] rounded-full shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-[11px] font-medium text-dark">
                  {row.code} {row.name}
                </span>
              </div>
              <span
                className="font-mono text-xs font-semibold"
                style={{ color: getScoreColor(row.overallScore) }}
              >
                {row.overallScore}%
              </span>
            </div>
            <div className="flex gap-2">
              {row.objectives.map((obj, i) => (
                <div
                  key={i}
                  className="flex-1 bg-izi-gray-lt rounded px-2 py-1 text-center"
                >
                  <div
                    className="font-mono text-[10px] font-semibold"
                    style={{ color: getScoreColor(obj.avgScore) }}
                  >
                    {obj.avgScore}%
                  </div>
                  <div className="text-[8px] text-izi-gray truncate">
                    O{i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
