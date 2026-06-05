"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { ActionPriorityBadge } from "@/components/ui/ActionPriorityBadge";

export interface KanbanAction {
  id: string;
  krId: string;
  krTitle: string;
  entityCode: string;
  entityName: string;
  title: string;
  description: string | null;
  assigneeId: string;
  assigneeName: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
  commentCount: number;
}

interface ActionsKanbanProps {
  actions: KanbanAction[];
  currentUserRole: UserRole;
  onCardClick?: (action: KanbanAction) => void;
}

const COLUMNS: { id: ActionStatus; label: string; accent: string }[] = [
  { id: "TODO", label: "À faire", accent: "#5f6e7a" },
  { id: "IN_PROGRESS", label: "En cours", accent: "#185FA5" },
  { id: "BLOCKED", label: "Bloquée", accent: "#e23c4a" },
  { id: "DONE", label: "Terminée", accent: "#1d9e75" },
  { id: "CANCELLED", label: "Annulée", accent: "#8a9aa5" },
];

const PRIORITY_RANK: Record<ActionPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function ActionsKanban({ actions: serverActions, currentUserRole, onCardClick }: ActionsKanbanProps) {
  const router = useRouter();
  const canDrag = currentUserRole !== "VIEWER";

  // useOptimistic gives us a derived view of serverActions that we can mutate
  // synchronously inside a transition. When the parent re-renders with a new
  // serverActions list (after router.refresh), the optimistic overlay resets
  // automatically — no manual resync needed.
  const [actions, applyOptimistic] = useOptimistic<
    KanbanAction[],
    { id: string; status: ActionStatus }
  >(serverActions, (state, change) =>
    state.map((a) => (a.id === change.id ? { ...a, status: change.status } : a))
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const columns = useMemo(() => {
    const groups: Record<ActionStatus, KanbanAction[]> = {
      TODO: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      DONE: [],
      CANCELLED: [],
    };
    for (const a of actions) groups[a.status].push(a);
    for (const status of Object.keys(groups) as ActionStatus[]) {
      groups[status].sort((a, b) => {
        const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (p !== 0) return p;
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDue - bDue;
      });
    }
    return groups;
  }, [actions]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
    setErrorMsg(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const actionId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const current = actions.find((a) => a.id === actionId);
    if (!current) return;

    const newStatus = (COLUMNS.find((c) => c.id === overId)?.id ?? null) as ActionStatus | null;
    if (!newStatus || current.status === newStatus) return;

    // useOptimistic mutations must happen inside a transition. On error the
    // optimistic value is automatically discarded on the next render, so we
    // only need to surface the message — no manual rollback.
    startTransition(async () => {
      applyOptimistic({ id: actionId, status: newStatus });
      try {
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : "Échec de la mise à jour"
        );
      }
    });
  }

  const draggingAction = draggingId
    ? actions.find((a) => a.id === draggingId) ?? null
    : null;

  return (
    <div>
      {errorMsg && (
        <div
          role="alert"
          className="mb-2 rounded-[7px] border border-[#e23c4a] bg-[#fceaea] px-3 py-2 text-[11px] text-[#e23c4a]"
        >
          {errorMsg}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              label={col.label}
              accent={col.accent}
              cards={columns[col.id]}
              canDrag={canDrag}
              onCardClick={onCardClick}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {draggingAction && (
            <CardSurface action={draggingAction} dragging />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

interface KanbanColumnProps {
  id: ActionStatus;
  label: string;
  accent: string;
  cards: KanbanAction[];
  canDrag: boolean;
  onCardClick?: (action: KanbanAction) => void;
}

function KanbanColumn({ id, label, accent, cards, canDrag, onCardClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-[10px] border bg-izi-gray-lt/40 transition-colors ${
        isOver ? "border-teal bg-teal-lt/60" : "border-border-soft"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-soft">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-dark">
            {label}
          </span>
        </div>
        <span className="font-mono text-[10px] text-izi-gray">{cards.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
        {cards.length === 0 && (
          <div className="text-center text-[10px] text-izi-gray py-4 italic">
            Aucune action
          </div>
        )}
        {cards.map((action) => (
          <DraggableCard
            key={action.id}
            action={action}
            canDrag={canDrag}
            onClick={onCardClick}
          />
        ))}
      </div>
    </div>
  );
}

interface DraggableCardProps {
  action: KanbanAction;
  canDrag: boolean;
  onClick?: (action: KanbanAction) => void;
}

function DraggableCard({ action, canDrag, onClick }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: action.id,
    disabled: !canDrag,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onClick?.(action)}
      className={`${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <CardSurface action={action} />
    </div>
  );
}

interface CardSurfaceProps {
  action: KanbanAction;
  dragging?: boolean;
}

function CardSurface({ action, dragging = false }: CardSurfaceProps) {
  const isOverdue =
    action.dueDate &&
    new Date(action.dueDate) < new Date() &&
    action.status !== "DONE" &&
    action.status !== "CANCELLED";
  const isDone = action.status === "DONE";
  return (
    <div
      className={`rounded-[8px] border border-border-soft bg-white p-2.5 shadow-sm hover:shadow transition-shadow ${
        dragging ? "shadow-md ring-1 ring-teal/50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="font-mono text-[9px] font-semibold text-teal bg-teal-lt px-1.5 py-0.5 rounded">
          {action.entityCode}
        </span>
        <ActionPriorityBadge priority={action.priority} />
      </div>
      <div
        className={`text-[12px] font-medium leading-tight mb-1 ${
          isDone ? "line-through text-izi-gray" : "text-dark"
        }`}
      >
        {action.title}
      </div>
      <div className="text-[10px] text-izi-gray line-clamp-1 mb-2">
        {action.krTitle}
      </div>
      <div className="flex items-center justify-between text-[10px] text-izi-gray">
        <span className="truncate max-w-[120px]">{action.assigneeName}</span>
        <div className="flex items-center gap-2 shrink-0">
          {action.commentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 font-mono"
              title={`${action.commentCount} commentaire${action.commentCount > 1 ? "s" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              {action.commentCount}
            </span>
          )}
          <span
            className={`font-mono ${
              isOverdue ? "text-[var(--red)] font-semibold" : ""
            }`}
          >
            {action.dueDate
              ? new Date(action.dueDate).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                })
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
