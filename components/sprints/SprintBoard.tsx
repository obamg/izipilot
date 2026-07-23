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
import type { SprintTaskItem } from "./types";

interface SprintBoardProps {
  tasks: SprintTaskItem[];
  currentUserRole: UserRole;
  currentUserId: string;
  onCardClick?: (task: SprintTaskItem) => void;
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

// Can the current user drag this card? CONTRIBUTOR may only move their own
// assigned tasks; VIEWER never drags; everyone else can.
function canDragTask(role: UserRole, userId: string, task: SprintTaskItem): boolean {
  if (role === "VIEWER") return false;
  if (role === "CONTRIBUTOR") return task.assigneeId === userId;
  return true;
}

export function SprintBoard({
  tasks: serverTasks,
  currentUserRole,
  currentUserId,
  onCardClick,
}: SprintBoardProps) {
  const router = useRouter();

  const [tasks, applyOptimistic] = useOptimistic<
    SprintTaskItem[],
    { id: string; status: ActionStatus }
  >(serverTasks, (state, change) =>
    state.map((t) => (t.id === change.id ? { ...t, status: change.status } : t))
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const columns = useMemo(() => {
    const groups: Record<ActionStatus, SprintTaskItem[]> = {
      TODO: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      DONE: [],
      CANCELLED: [],
    };
    for (const t of tasks) groups[t.status].push(t);
    for (const status of Object.keys(groups) as ActionStatus[]) {
      groups[status].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      });
    }
    return groups;
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
    setErrorMsg(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const taskId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const current = tasks.find((t) => t.id === taskId);
    if (!current) return;

    const newStatus = (COLUMNS.find((c) => c.id === overId)?.id ?? null) as ActionStatus | null;
    if (!newStatus || current.status === newStatus) return;

    startTransition(async () => {
      applyOptimistic({ id: taskId, status: newStatus });
      try {
        const res = await fetch(`/api/sprint-tasks/${taskId}`, {
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
        setErrorMsg(err instanceof Error ? err.message : "Échec de la mise à jour");
      }
    });
  }

  const draggingTask = draggingId
    ? tasks.find((t) => t.id === draggingId) ?? null
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
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {COLUMNS.map((col) => (
            <BoardColumn
              key={col.id}
              id={col.id}
              label={col.label}
              accent={col.accent}
              cards={columns[col.id]}
              currentUserRole={currentUserRole}
              currentUserId={currentUserId}
              onCardClick={onCardClick}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {draggingTask && <CardSurface task={draggingTask} dragging />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

interface BoardColumnProps {
  id: ActionStatus;
  label: string;
  accent: string;
  cards: SprintTaskItem[];
  currentUserRole: UserRole;
  currentUserId: string;
  onCardClick?: (task: SprintTaskItem) => void;
}

function BoardColumn({
  id,
  label,
  accent,
  cards,
  currentUserRole,
  currentUserId,
  onCardClick,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const totalPoints = cards.reduce((s, c) => s + (c.storyPoints ?? 1), 0);
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-[10px] border bg-izi-gray-lt/40 transition-colors ${
        isOver ? "border-teal bg-teal-lt/60" : "border-border-soft"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-soft">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-dark">
            {label}
          </span>
        </div>
        <span className="font-mono text-[10px] text-izi-gray">
          {cards.length} · {totalPoints}pts
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
        {cards.length === 0 && (
          <div className="text-center text-[10px] text-izi-gray py-4 italic">Aucune tâche</div>
        )}
        {cards.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            canDrag={canDragTask(currentUserRole, currentUserId, task)}
            onClick={onCardClick}
          />
        ))}
      </div>
    </div>
  );
}

interface DraggableCardProps {
  task: SprintTaskItem;
  canDrag: boolean;
  onClick?: (task: SprintTaskItem) => void;
}

function DraggableCard({ task, canDrag, onClick }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !canDrag,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onClick?.(task)}
      className={`${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <CardSurface task={task} />
    </div>
  );
}

function CardSurface({ task, dragging = false }: { task: SprintTaskItem; dragging?: boolean }) {
  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== "DONE" &&
    task.status !== "CANCELLED";
  const isDone = task.status === "DONE";
  return (
    <div
      className={`rounded-[8px] border border-border-soft bg-white p-2.5 shadow-sm hover:shadow transition-shadow ${
        dragging ? "shadow-md ring-1 ring-teal/50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        {task.team ? (
          <span
            className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded"
            style={{ color: task.team.color, backgroundColor: `${task.team.color}1a` }}
            title={task.team.name}
          >
            {task.team.code}
          </span>
        ) : (
          <span className="font-mono text-[9px] text-izi-gray">—</span>
        )}
        <ActionPriorityBadge priority={task.priority} />
      </div>
      <div
        className={`text-[12px] font-medium leading-tight mb-1 ${
          isDone ? "line-through text-izi-gray" : "text-dark"
        }`}
      >
        {task.title}
      </div>
      {task.krTitle && (
        <div className="text-[10px] text-izi-gray line-clamp-1 mb-1">↳ {task.krTitle}</div>
      )}
      {task.openRequests?.length > 0 && (
        <div
          className="mb-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium bg-gold-lt text-[#946200]"
          title={task.openRequests
            .map((r) => `${r.kindLabel} · ${r.targetLabel}`)
            .join("\n")}
        >
          <span aria-hidden>⏳</span>
          <span className="truncate max-w-[120px]">
            {task.openRequests.length === 1
              ? `en attente · ${task.openRequests[0].targetLabel}`
              : `${task.openRequests.length} demandes en attente`}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] text-izi-gray">
        <span className="truncate max-w-[110px]">{task.assigneeName ?? "Non assignée"}</span>
        <div className="flex items-center gap-2 shrink-0">
          {task.stepProgress?.total > 0 && (
            <span
              className={`inline-flex items-center gap-0.5 font-mono ${
                task.stepProgress.done === task.stepProgress.total
                  ? "text-green font-semibold"
                  : ""
              }`}
              title={`Sous-tâches : ${task.stepProgress.done}/${task.stepProgress.total}`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 6h1.5M3 12h1.5M3 18h1.5" />
                <path d="M9 6h12M9 12h12M9 18h12" />
              </svg>
              {task.stepProgress.done}/{task.stepProgress.total}
            </span>
          )}
          {task.reportUrl && <ReportLink url={task.reportUrl} />}
          {task.storyPoints != null && (
            <span
              className="font-mono font-semibold text-teal bg-teal-lt px-1.5 py-0.5 rounded"
              title="Story points"
            >
              {task.storyPoints}
            </span>
          )}
          {task.dueDate && (
            <span className={`font-mono ${isOverdue ? "text-[var(--red)] font-semibold" : ""}`}>
              {new Date(task.dueDate).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "short",
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Clickable report-document link on a card. stopPropagation on pointer-down so
// dnd-kit doesn't start a drag, and on click so the edit modal doesn't open.
function ReportLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      title="Ouvrir le rapport de tâche"
      aria-label="Ouvrir le rapport de tâche"
      className="text-teal hover:text-teal-dk transition-colors"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
      </svg>
    </a>
  );
}
