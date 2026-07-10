"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { SprintHeader } from "./SprintHeader";
import { SprintBoard } from "./SprintBoard";
import { BacklogPanel } from "./BacklogPanel";
import { CapacityPanel, type CapacityRow } from "./CapacityPanel";
import { BurndownChart, type BurndownDatum } from "./BurndownChart";
import { SprintTaskModal } from "./SprintTaskModal";
import { DailyReport } from "./DailyReport";
import type { RosterMember, StandupRecord } from "@/lib/standup";
import type {
  SprintSummary,
  SprintTaskItem,
  UserOption,
  TeamOption,
  KrOption,
} from "./types";

type Tab = "board" | "backlog" | "burndown" | "capacity" | "standup";

const TABS: { id: Tab; label: string }[] = [
  { id: "board", label: "Tableau" },
  { id: "backlog", label: "Backlog" },
  { id: "burndown", label: "Burndown" },
  { id: "capacity", label: "Capacité" },
  { id: "standup", label: "Rapport quotidien" },
];

interface SprintDetailProps {
  sprint: SprintSummary;
  tasks: SprintTaskItem[];
  backlogTasks: SprintTaskItem[];
  burndown: BurndownDatum[];
  capacityRows: CapacityRow[];
  users: UserOption[];
  products: TeamOption[];
  departments: TeamOption[];
  krs: KrOption[];
  currentUserRole: UserRole;
  currentUserId: string;
  daysRemaining: number;
  standupToday: string;
  standupRoster: RosterMember[];
  initialStandups: StandupRecord[];
}

export function SprintDetail({
  sprint,
  tasks,
  backlogTasks,
  burndown,
  capacityRows,
  users,
  products,
  departments,
  krs,
  currentUserRole,
  currentUserId,
  daysRemaining,
  standupToday,
  standupRoster,
  initialStandups,
}: SprintDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("board");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SprintTaskItem | null>(null);

  const isManagement = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";
  const canManageTasks = isManagement || currentUserRole === "PO";
  const canEdit = canManageTasks; // who may open the full edit modal
  const isContributor = currentUserRole === "CONTRIBUTOR";

  // Management/PO open the full modal on any card; a CONTRIBUTOR opens a
  // report-link-only modal on cards assigned to them.
  const openCard = (t: SprintTaskItem) => {
    if (canEdit || (isContributor && t.assigneeId === currentUserId)) {
      setEditing(t);
    }
  };
  const canOpenCards = canEdit || isContributor;

  const filteredTasks = useMemo(() => {
    if (teamFilter === "ALL") return tasks;
    if (teamFilter.startsWith("P:")) {
      const id = teamFilter.slice(2);
      return tasks.filter((t) => t.productId === id);
    }
    const id = teamFilter.slice(2);
    return tasks.filter((t) => t.departmentId === id);
  }, [tasks, teamFilter]);

  function refresh() {
    router.refresh();
  }

  return (
    <div>
      <SprintHeader sprint={sprint} canManage={isManagement} daysRemaining={daysRemaining} />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border-soft mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-teal text-teal"
                : "border-transparent text-izi-gray hover:text-dark"
            }`}
          >
            {t.label}
            {t.id === "backlog" && backlogTasks.length > 0 && (
              <span className="ml-1.5 font-mono text-[10px] text-izi-gray">
                {backlogTasks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "board" && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
              aria-label="Filtrer par équipe"
            >
              <option value="ALL">Toutes les équipes</option>
              <optgroup label="Produits">
                {products.map((p) => (
                  <option key={p.id} value={`P:${p.id}`}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Départements">
                {departments.map((d) => (
                  <option key={d.id} value={`D:${d.id}`}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </optgroup>
            </select>
            {canManageTasks && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors"
              >
                + Nouvelle tâche
              </button>
            )}
          </div>
          <SprintBoard
            tasks={filteredTasks}
            currentUserRole={currentUserRole}
            currentUserId={currentUserId}
            onCardClick={canOpenCards ? openCard : undefined}
          />
        </div>
      )}

      {tab === "backlog" && (
        <BacklogPanel
          tasks={backlogTasks}
          targetSprintId={sprint.id}
          targetSprintName={sprint.name}
          currentUserRole={currentUserRole}
          onEdit={canEdit ? (t) => setEditing(t) : undefined}
          onCreate={canManageTasks ? () => setCreating(true) : undefined}
        />
      )}

      {tab === "burndown" && (
        <div className="rounded-[12px] border border-border-soft bg-white p-4">
          <h2 className="font-serif text-[15px] text-dark mb-1">Burndown</h2>
          <p className="text-[11px] text-izi-gray mb-3">
            Points restants vs trajectoire idéale.
          </p>
          <BurndownChart data={burndown} />
        </div>
      )}

      {tab === "capacity" && (
        <CapacityPanel
          rows={capacityRows}
          allUsers={users}
          sprintId={sprint.id}
          canEdit={isManagement}
        />
      )}

      {tab === "standup" && (
        <DailyReport
          sprintId={sprint.id}
          today={standupToday}
          roster={standupRoster}
          initialStandups={initialStandups}
          currentUserId={currentUserId}
          canSubmit={currentUserRole !== "VIEWER"}
        />
      )}

      {creating && (
        <SprintTaskModal
          defaultSprintId={tab === "backlog" ? null : sprint.id}
          users={users}
          products={products}
          departments={departments}
          krs={krs}
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}

      {editing && (
        <SprintTaskModal
          task={editing}
          users={users}
          products={products}
          departments={departments}
          krs={krs}
          canDelete={canManageTasks}
          reportOnly={isContributor}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}
