import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { APPRAISAL_STATUS_META } from "@/lib/appraisal-serialize";

export const dynamic = "force-dynamic";

function scoreColor(v: number): string {
  if (v >= 4) return "var(--green)";
  if (v >= 3) return "var(--teal)";
  if (v >= 2) return "var(--gold)";
  return "var(--red)";
}

const ACTION_HINT: Record<string, string> = {
  SELF_ASSESSMENT: "À remplir : votre auto-évaluation",
  MANAGER_ASSESSMENT: "En cours d'évaluation par votre manager",
  SHARED: "À signer : votre manager a partagé le bilan",
  ACKNOWLEDGED: "Signé",
};

export default async function MyAppraisalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const appraisals = await prisma.appraisal.findMany({
    where: { orgId: session.user.orgId, subjectId: session.user.id },
    include: { manager: { select: { name: true } } },
    orderBy: [{ year: "desc" }, { quarter: "desc" }],
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="font-serif text-[24px] text-dark">Mon bilan</h1>
        <p className="text-[13px] text-izi-gray mt-0.5">
          Vos bilans trimestriels : remplissez votre auto-évaluation, puis
          signez une fois le bilan partagé par votre manager.
        </p>
      </div>

      {appraisals.length === 0 ? (
        <p className="text-[13px] text-izi-gray py-6 text-center">
          Aucun bilan pour l&apos;instant.
        </p>
      ) : (
        <div className="space-y-2">
          {appraisals.map((a) => {
            const meta = APPRAISAL_STATUS_META[a.status];
            const overall = a.overall == null ? null : Number(a.overall);
            const actionable = a.status === "SELF_ASSESSMENT" || a.status === "SHARED";
            return (
              <Link
                key={a.id}
                href={`/appraisals/${a.id}`}
                className={`flex items-center justify-between gap-3 rounded-[10px] border bg-white p-3.5 hover:border-teal-md transition-colors no-underline ${
                  actionable ? "border-teal-md" : "border-border-soft"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-dark">
                    Bilan {a.quarter} {a.year}
                  </div>
                  <div className="text-[11px] text-izi-gray">
                    {ACTION_HINT[a.status]} · manager {a.manager.name}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {overall != null && a.status === "ACKNOWLEDGED" && (
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
