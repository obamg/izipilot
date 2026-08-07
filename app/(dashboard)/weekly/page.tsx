import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WeeklyEntryForm } from "./WeeklyEntryForm";
import { WeeklyWeekSelector } from "./WeeklyWeekSelector";
import { getISOWeek } from "@/lib/date";
import { getWeeklyKrData } from "@/lib/weekly-data";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { weekNumber: currentWeek, year: currentYear } = getISOWeek(new Date());

  const params = await searchParams;
  const weekNumber = params.week ? parseInt(params.week, 10) : currentWeek;
  const year = params.year ? parseInt(params.year, 10) : currentYear;

  // Data assembly shared with the mobile bootstrap API — see lib/weekly-data.
  const {
    krData,
    orgUsers,
    isReadOnly,
    isHistorical,
    isPoGrace,
    isInGraceWindow,
    entityNames,
    submittedCount,
  } = await getWeeklyKrData(
    { id: session.user.id, orgId: session.user.orgId, role: session.user.role },
    weekNumber,
    year,
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-[20px] text-dark">
              Ma revue &mdash; S{String(weekNumber).padStart(2, "0")}
            </h1>
            <WeeklyWeekSelector
              weekNumber={weekNumber}
              year={year}
              currentWeek={currentWeek}
              currentYear={currentYear}
            />
          </div>
          <p className="text-[11px] text-izi-gray mt-0.5">
            {entityNames.join(", ")}
            {isPoGrace && isInGraceWindow
              ? " · Saisie en retard — verrouillage lundi 23h59"
              : isReadOnly
                ? " · Lecture seule"
                : " · Deadline dimanche 23h59"}
          </p>
        </div>
      </div>

      {krData.length === 0 ? (
        <div className="bg-white rounded-[10px] border border-border-soft p-8 text-center">
          <p className="text-sm text-izi-gray">
            Aucun Key Result ne vous est assign&eacute;.
          </p>
          <p className="text-xs text-izi-gray mt-1">
            Contactez votre administrateur pour configurer vos OKRs.
          </p>
        </div>
      ) : isHistorical && submittedCount === 0 ? (
        <div className="bg-white rounded-[10px] border border-border-soft p-8 text-center">
          <p className="text-sm text-izi-gray">
            Aucune revue soumise pour S{String(weekNumber).padStart(2, "0")} &middot; {year}.
          </p>
        </div>
      ) : (
        <WeeklyEntryForm
          keyResults={krData}
          weekNumber={weekNumber}
          year={year}
          orgUsers={orgUsers}
          currentUserId={session.user.id}
          currentUserRole={session.user.role}
          isReadOnly={isReadOnly}
        />
      )}
    </div>
  );
}
