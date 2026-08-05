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
import { AvailabilityPanel } from "./AvailabilityPanel";
import { TaskRequestsInbox } from "./TaskRequestsInbox";
import { RecurringTasksButton } from "./RecurringTasksButton";
import { TaskScopeFilters } from "./TaskScopeFilters";
import { computeBurndown } from "@/lib/sprint";
import type { RosterMember, StandupRecord } from "@/lib/standup";
import type {
  SprintSummary,
  SprintTaskItem,
  UserOption,
  TeamOption,
  KrOption,
  AvailabilityMemberVM,
  TaskRequestItem,
  RecurringTaskItem,
} from "./types";

type Tab =
  | "board"
  | "backlog"
  | "burndown"
  | "capacity"
  | "availability"
  | "requests"
  | "standup";

const TABS: { id: Tab; label: string }[] = [
  { id: "board", label: "Tableau" },
  { id: "backlog", label: "Backlog" },
  { id: "burndown", label: "Burndown" },
  { id: "capacity", label: "Capacité" },
  { id: "availability", label: "Disponibilité" },
  { id: "requests", label: "Demandes" },
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
  availability: AvailabilityMemberVM[];
  inboxReceived: TaskRequestItem[];
  inboxSent: TaskRequestItem[];
  standupToday: string;
  standupRoster: RosterMember[];
  initialStandups: StandupRecord[];
  recurringTemplates: RecurringTaskItem[];
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
  availability,
  inboxReceived,
  inboxSent,
  standupToday,
  standupRoster,
  initialStandups,
  recurringTemplates,
}: SprintDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("board");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  // Assignee filter: "ALL" | "UNASSIGNED" | a userId (currentUserId = "Mes tâches").
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");
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

  // People who actually have a task in this sprint — keeps the assignee
  // dropdown short and relevant (vs. the full org roster).
  const assigneeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (t.assigneeId && t.assigneeName) m.set(t.assigneeId, t.assigneeName);
    }
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [tasks]);

  // Scope filters (assignee / team / priority) — shared by the board and the
  // burndown so a filtered view stays consistent across tabs.
  const scopeFilteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (teamFilter.startsWith("P:") && t.productId !== teamFilter.slice(2)) return false;
      if (teamFilter.startsWith("D:") && t.departmentId !== teamFilter.slice(2)) return false;
      if (assigneeFilter === "UNASSIGNED" && t.assigneeId) return false;
      if (
        assigneeFilter !== "ALL" &&
        assigneeFilter !== "UNASSIGNED" &&
        t.assigneeId !== assigneeFilter
      )
        return false;
      if (priorityFilter !== "ALL" && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, teamFilter, assigneeFilter, priorityFilter]);

  // Board additionally narrows by the free-text search box.
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scopeFilteredTasks;
    return scopeFilteredTasks.filter((t) =>
      `${t.title} ${t.description ?? ""} ${t.krTitle ?? ""} ${t.assigneeName ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [scopeFilteredTasks, search]);

  const scopeActive =
    teamFilter !== "ALL" || assigneeFilter !== "ALL" || priorityFilter !== "ALL";
  const filtersActive = scopeActive || search.trim() !== "";

  // Burndown reflects the scope filters (not the board-only text search):
  // recompute client-side from the filtered subset, else use the server view.
  const displayBurndown = useMemo<BurndownDatum[]>(() => {
    if (!scopeActive) return burndown;
    return computeBurndown(
      { startDate: new Date(sprint.startDate), endDate: new Date(sprint.endDate) },
      scopeFilteredTasks.map((t) => ({
        status: t.status,
        storyPoints: t.storyPoints,
        completedAt: t.completedAt ? new Date(t.completedAt) : null,
        assigneeId: t.assigneeId,
      }))
    ).map((p) => ({ label: p.label, ideal: p.ideal, remaining: p.remaining }));
  }, [scopeActive, burndown, sprint.startDate, sprint.endDate, scopeFilteredTasks]);

  function resetFilters() {
    setTeamFilter("ALL");
    setAssigneeFilter("ALL");
    setPriorityFilter("ALL");
    setSearch("");
  }

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
            {t.id === "requests" && inboxReceived.length > 0 && (
              <span className="ml-1.5 rounded-full bg-gold px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">
                {inboxReceived.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "board" && (
        <div>
          <div className="mb-3 space-y-2">
            {/* Text search — the most prominent filter: type to narrow instantly. */}
            <div className="relative">
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-izi-gray"
              >
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M14 14l3.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une tâche, une personne ou un KR…"
                aria-label="Rechercher une tâche"
                className="w-full rounded-[8px] border border-border-soft bg-white pl-9 pr-3 py-2 text-[13px] text-dark placeholder:text-izi-gray focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Effacer la recherche"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-izi-gray hover:text-dark text-[15px] leading-none"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TaskScopeFilters
                currentUserId={currentUserId}
                assigneeFilter={assigneeFilter}
                setAssigneeFilter={setAssigneeFilter}
                teamFilter={teamFilter}
                setTeamFilter={setTeamFilter}
                priorityFilter={priorityFilter}
                setPriorityFilter={setPriorityFilter}
                assigneeOptions={assigneeOptions}
                products={products}
                departments={departments}
              />

              <div className="ml-auto flex items-center gap-2">
                <RecurringTasksButton
                  initialTemplates={recurringTemplates}
                  users={users}
                  products={products}
                  departments={departments}
                  krs={krs}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                />
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
            </div>

            {filtersActive && (
              <div className="flex items-center gap-2 text-[11px] text-izi-gray">
                <span>
                  {filteredTasks.length} tâche{filteredTasks.length > 1 ? "s" : ""} sur{" "}
                  {tasks.length}
                </span>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-teal hover:text-teal-dk underline"
                >
                  Réinitialiser
                </button>
              </div>
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <TaskScopeFilters
              currentUserId={currentUserId}
              assigneeFilter={assigneeFilter}
              setAssigneeFilter={setAssigneeFilter}
              teamFilter={teamFilter}
              setTeamFilter={setTeamFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              assigneeOptions={assigneeOptions}
              products={products}
              departments={departments}
            />
            {scopeActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-[11px] text-teal hover:text-teal-dk underline"
              >
                Réinitialiser
              </button>
            )}
          </div>
          {scopeActive && (
            <p className="mb-2 text-[11px] text-izi-gray">
              Burndown filtré · {scopeFilteredTasks.length} tâche
              {scopeFilteredTasks.length > 1 ? "s" : ""} sur {tasks.length}
            </p>
          )}
          <BurndownChart data={displayBurndown} />
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

      {tab === "availability" && (
        <AvailabilityPanel members={availability} tasks={tasks} />
      )}

      {tab === "requests" && (
        <TaskRequestsInbox
          initialReceived={inboxReceived}
          initialSent={inboxSent}
          canAct={currentUserRole !== "VIEWER"}
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
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
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
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}
