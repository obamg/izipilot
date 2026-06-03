"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { ActionStatusBadge } from "@/components/ui/ActionStatusBadge";
import { ActionPriorityBadge } from "@/components/ui/ActionPriorityBadge";
import { ActionEditModal, type EditableAction } from "@/components/ui/ActionEditModal";
import { ActionsKanban, type KanbanAction } from "./ActionsKanban";

type ViewMode = "list" | "kanban";
const VIEW_STORAGE_KEY = "izipilot.actions.view";

function subscribeViewPref(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function getViewPref(): ViewMode {
  if (typeof window === "undefined") return "list";
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === "kanban" || stored === "list" ? stored : "list";
}

interface ActionItem {
  id: string;
  krId: string;
  krTitle: string;
  entityCode: string;
  entityName: string;
  title: string;
  description: string | null;
  assigneeId: string;
  assigneeName: string;
  createdByName: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
  completedAt: string | null;
  weekCreated: number;
  createdAt: string;
  commentCount: number;
}

interface ActionsListProps {
  actions: ActionItem[];
  users: { id: string; name: string }[];
  currentUserRole: UserRole;
}

const STATUS_FILTERS: { value: ActionStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Toutes" },
  { value: "TODO", label: "A faire" },
  { value: "IN_PROGRESS", label: "En cours" },
  { value: "BLOCKED", label: "Bloquees" },
  { value: "DONE", label: "Terminees" },
  { value: "CANCELLED", label: "Annulees" },
];

const PRIORITY_FILTERS: { value: ActionPriority | "ALL"; label: string }[] = [
  { value: "ALL", label: "Toutes" },
  { value: "URGENT", label: "Urgente" },
  { value: "HIGH", label: "Haute" },
  { value: "MEDIUM", label: "Moyenne" },
  { value: "LOW", label: "Basse" },
];

export function ActionsList({ actions, users, currentUserRole }: ActionsListProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ActionStatus | "ALL">("ALL");
  const [priorityFilter, setPriorityFilter] = useState<ActionPriority | "ALL">("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<EditableAction | null>(null);
  // View pref is hydrated from localStorage via useSyncExternalStore so React
  // renders the persisted choice on first client paint without a setState-in-
  // effect cascade. SSR snapshot defaults to "list".
  const view = useSyncExternalStore(subscribeViewPref, getViewPref, () => "list");
  function updateView(next: ViewMode) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    window.dispatchEvent(new StorageEvent("storage", { key: VIEW_STORAGE_KEY }));
  }

  const canEdit = currentUserRole !== "VIEWER";
  const canDelete = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";

  const filtered = actions.filter((a) => {
    // In kanban view the status is encoded by column placement, so applying
    // the status filter would hide every card except the matching column.
    if (view === "list" && statusFilter !== "ALL" && a.status !== statusFilter) return false;
    if (priorityFilter !== "ALL" && a.priority !== priorityFilter) return false;
    if (assigneeFilter !== "ALL" && a.assigneeId !== assigneeFilter) return false;
    return true;
  });

  const kanbanActions: KanbanAction[] = filtered.map((a) => ({
    id: a.id,
    krId: a.krId,
    krTitle: a.krTitle,
    entityCode: a.entityCode,
    entityName: a.entityName,
    title: a.title,
    description: a.description,
    assigneeId: a.assigneeId,
    assigneeName: a.assigneeName,
    status: a.status,
    priority: a.priority,
    dueDate: a.dueDate,
    commentCount: a.commentCount,
  }));

  function openEditFromAction(action: { id: string; title: string; description: string | null; assigneeId: string; status: ActionStatus; priority: ActionPriority; dueDate: string | null }) {
    if (!canEdit) return;
    setEditing({
      id: action.id,
      title: action.title,
      description: action.description,
      assigneeId: action.assigneeId,
      status: action.status,
      priority: action.priority,
      dueDate: action.dueDate,
    });
  }

  return (
    <div>
      {/* Filters + view toggle */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div
          role="tablist"
          aria-label="Vue des actions"
          className="inline-flex rounded-[7px] border border-[#deeaea] bg-white p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            onClick={() => updateView("list")}
            className={`flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors ${
              view === "list" ? "bg-teal text-white" : "text-izi-gray hover:text-dark"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Liste
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "kanban"}
            onClick={() => updateView("kanban")}
            className={`flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors ${
              view === "kanban" ? "bg-teal text-white" : "text-izi-gray hover:text-dark"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5">
              <rect x="3" y="4" width="5" height="16" rx="1" />
              <rect x="10" y="4" width="5" height="11" rx="1" />
              <rect x="17" y="4" width="4" height="8" rx="1" />
            </svg>
            Kanban
          </button>
        </div>

        {view === "list" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ActionStatus | "ALL")}
            className="rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[11px] text-dark"
            aria-label="Filtrer par statut"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        )}

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as ActionPriority | "ALL")}
          className="rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[11px] text-dark"
          aria-label="Filtrer par priorite"
        >
          {PRIORITY_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-[7px] border border-[#deeaea] bg-white px-2.5 py-1.5 text-[11px] text-dark"
          aria-label="Filtrer par responsable"
        >
          <option value="ALL">Tous les responsables</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>

        <span className="self-center text-[10px] text-izi-gray">
          {filtered.length} action{filtered.length > 1 ? "s" : ""}
        </span>
      </div>

      {view === "kanban" && (
        <ActionsKanban
          actions={kanbanActions}
          currentUserRole={currentUserRole}
          onCardClick={canEdit ? openEditFromAction : undefined}
        />
      )}

      {view === "list" && (
      <div className="bg-white rounded-[10px] border border-[#deeaea] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-izi-gray">
            Aucune action trouv&eacute;e.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-izi-gray-lt bg-izi-gray-lt/30">
                  <th className="text-left py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                    Action
                  </th>
                  <th className="text-left py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray hidden md:table-cell">
                    Key Result
                  </th>
                  <th className="text-left py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray hidden lg:table-cell">
                    Entit&eacute;
                  </th>
                  <th className="text-center py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                    Statut
                  </th>
                  <th className="text-center py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                    Priorit&eacute;
                  </th>
                  <th className="text-left py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray hidden sm:table-cell">
                    Responsable
                  </th>
                  <th className="text-left py-2 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray hidden lg:table-cell">
                    &Eacute;ch&eacute;ance
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((action) => {
                  const isOverdue =
                    action.dueDate &&
                    new Date(action.dueDate) < new Date() &&
                    action.status !== "DONE" &&
                    action.status !== "CANCELLED";
                  return (
                    <tr
                      key={action.id}
                      onClick={
                        canEdit
                          ? () =>
                              setEditing({
                                id: action.id,
                                title: action.title,
                                description: action.description,
                                assigneeId: action.assigneeId,
                                status: action.status,
                                priority: action.priority,
                                dueDate: action.dueDate,
                              })
                          : undefined
                      }
                      className={`border-b border-izi-gray-lt last:border-b-0 hover:bg-izi-gray-lt/30 transition-colors ${
                        canEdit ? "cursor-pointer" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <div className={`font-medium ${action.status === "DONE" ? "line-through text-izi-gray" : "text-dark"}`}>
                          {action.title}
                        </div>
                        {action.commentCount > 0 && (
                          <span className="text-[9px] text-izi-gray">{action.commentCount} commentaire{action.commentCount > 1 ? "s" : ""}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-izi-gray hidden md:table-cell max-w-[150px] truncate">
                        {action.krTitle}
                      </td>
                      <td className="py-2.5 px-3 hidden lg:table-cell">
                        <span className="font-mono text-[9px] font-semibold text-teal bg-teal-lt px-1.5 py-0.5 rounded">
                          {action.entityCode}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <ActionStatusBadge status={action.status} />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <ActionPriorityBadge priority={action.priority} />
                      </td>
                      <td className="py-2.5 px-3 text-izi-gray hidden sm:table-cell">
                        {action.assigneeName}
                      </td>
                      <td className={`py-2.5 px-3 font-mono hidden lg:table-cell ${isOverdue ? "text-[var(--red)] font-semibold" : "text-izi-gray"}`}>
                        {action.dueDate
                          ? new Date(action.dueDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
                          : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {editing && (
        <ActionEditModal
          action={editing}
          users={users}
          canDelete={canDelete}
          onClose={() => setEditing(null)}
          onUpdated={() => router.refresh()}
          onDeleted={() => router.refresh()}
        />
      )}
    </div>
  );
}
