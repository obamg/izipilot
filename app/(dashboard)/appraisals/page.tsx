import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CreateAppraisalForm } from "@/components/appraisals/CreateAppraisalForm";
import { APPRAISAL_STATUS_META } from "@/lib/appraisal-serialize";
import { evaluableSubjectIds } from "@/lib/appraisal-server";
import { quarterOfMonth } from "@/lib/appraisal";

export const dynamic = "force-dynamic";

function scoreColor(v: number): string {
  if (v >= 4) return "var(--green)";
  if (v >= 3) return "var(--teal)";
  if (v >= 2) return "var(--gold)";
  return "var(--red)";
}

export default async function AppraisalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { orgId, id: userId, role } = session.user;

  const allowed = await evaluableSubjectIds(orgId, { id: userId, role });
  const isAdminView = role === "CEO" || role === "MANAGEMENT";

  const where =
    isAdminView || allowed === "ALL"
      ? { orgId }
      : { orgId, OR: [{ managerId: userId }, { subjectId: { in: allowed } }] };

  const [appraisals, subjects] = await Promise.all([
    prisma.appraisal.findMany({
      where,
      include: {
        subject: { select: { name: true } },
        manager: { select: { name: true } },
      },
      orderBy: [{ year: "desc" }, { quarter: "desc" }, { updatedAt: "desc" }],
    }),
    allowed === "ALL"
      ? prisma.user.findMany({
          where: { orgId, isActive: true, id: { not: userId } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : allowed.length
        ? prisma.user.findMany({
            where: { orgId, isActive: true, id: { in: allowed } },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
  ]);

  const now = new Date();
  const defaultYear = now.getUTCFullYear();
  const defaultQuarter = quarterOfMonth(now.getUTCMonth() + 1);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-serif text-[24px] text-dark">Bilans trimestriels</h1>
        <p className="text-[13px] text-izi-gray mt-0.5">
          Revue de performance formelle, trimestrielle : auto-évaluation du
          collègue puis évaluation du manager, bâtie sur les évaluations
          mensuelles.
        </p>
      </div>

      {subjects.length > 0 && (
        <CreateAppraisalForm
          subjects={subjects}
          defaultQuarter={defaultQuarter}
          defaultYear={defaultYear}
        />
      )}

      {appraisals.length === 0 ? (
        <p className="text-[13px] text-izi-gray py-6 text-center">
          Aucun bilan pour l&apos;instant.
        </p>
      ) : (
        <div className="space-y-2">
          {appraisals.map((a) => {
            const meta = APPRAISAL_STATUS_META[a.status];
            const overall = a.overall == null ? null : Number(a.overall);
            return (
              <Link
                key={a.id}
                href={`/appraisals/${a.id}`}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-border-soft bg-white p-3.5 hover:border-teal-md transition-colors no-underline"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-dark truncate">{a.subject.name}</div>
                  <div className="text-[11px] text-izi-gray">
                    {a.quarter} {a.year} · manager {a.manager.name}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {overall != null && (
                    <span
                      className="font-mono text-[15px] font-bold tabular-nums"
                      style={{ color: scoreColor(overall) }}
                    >
                      {overall.toFixed(1)}
                    </span>
                  )}
                  <span
                    className="text-[10px] font-semibold px-2 py-1 rounded-full"
                    style={{ color: meta.color, backgroundColor: meta.bg }}
                  >
                    {meta.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
