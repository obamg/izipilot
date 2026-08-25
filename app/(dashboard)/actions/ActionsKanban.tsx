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
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  equivalentColumn,
  groupTasksByColumn,
  wipState,
  type BoardColumnDef,
  type BoardWorkflowDef,
} from "@/lib/board-column";

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
  /** Clé d'équipe du KR porteur ("P:<id>" / "D:<id>") — pilote le flux. */
  entityKey: string | null;
  columnId: string | null;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: string | null;
  commentCount: number;
}

interface ActionsKanbanProps {
  actions: KanbanAction[];
  currentUserRole: UserRole;
  /** Tous les flux de l'org, colonnes incluses. */
  workflows: BoardWorkflowDef[];
  /** Quelle équipe utilise quel flux. */
  teamWorkflows: { defaultWorkflowId: string; byTeam: Record<string, string> };
  /** Clé de l'équipe filtrée, ou null si le filtre est sur « toutes ». */
  activeTeamKey: string | null;
  onCardClick?: (action: KanbanAction) => void;
}

// Colonnes de repli quand le filtre porte sur plusieurs équipes : chacune a
// son flux, aucun ne serait honnête ici. On retombe sur les cinq catégories —
// exactement ce que lisent les statistiques.
const CATEGORY_COLUMNS: BoardColumnDef[] = CATEGORY_ORDER.map((category, i) => ({
  id: `cat:${category}`,
  label: CATEGORY_META[category].label,
  color: CATEGORY_META[category].color,
  category,
  sortOrder: i,
  wipLimit: null,
}));

const PRIORITY_RANK: Record<ActionPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function ActionsKanban({
  actions: serverActions,
  currentUserRole,
  workflows,
  teamWorkflows,
  activeTeamKey,
  onCardClick,
}: ActionsKanbanProps) {
  const router = useRouter();
  const canDrag = currentUserRole !== "VIEWER";

  // useOptimistic gives us a derived view of serverActions that we can mutate
  // synchronously inside a transition. When the parent re-renders with a new
  // serverActions list (after router.refresh), the optimistic overlay resets
  // automatically — no manual resync needed.
  const [actions, applyOptimistic] = useOptimistic<
    KanbanAction[],
    { id: string; columnId: string | null; status: ActionStatus }
  >(serverActions, (state, change) =>
    state.map((a) =>
      a.id === change.id
        ? { ...a, columnId: change.columnId, status: change.status }
        : a
    )
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const byWorkflowId = useMemo(
    () => new Map(workflows.map((w) => [w.id, w])),
    [workflows]
  );

  // Le flux d'une action, via l'équipe de son KR.
  const workflowForAction = useMemo(
    () =>
      (a: KanbanAction): BoardWorkflowDef | null => {
        const id =
          (a.entityKey ? teamWorkflows.byTeam[a.entityKey] : undefined) ??
          teamWorkflows.defaultWorkflowId;
        return byWorkflowId.get(id) ?? null;
      },
    [byWorkflowId, teamWorkflows]
  );

  // Filtre sur une équipe → son flux réel. Sinon → les cinq catégories.
  const activeWorkflow = useMemo(() => {
    if (!activeTeamKey) return null;
    const id = teamWorkflows.byTeam[activeTeamKey] ?? teamWorkflows.defaultWorkflowId;
    return byWorkflowId.get(id) ?? null;
  }, [activeTeamKey, teamWorkflows, byWorkflowId]);

  const displayColumns = activeWorkflow?.columns.length
    ? activeWorkflow.columns
    : CATEGORY_COLUMNS;

  const { byColumn, orphans } = useMemo(() => {
    const grouped = groupTasksByColumn(displayColumns, actions);
    for (const key of Object.keys(grouped.byColumn)) {
      grouped.byColumn[key].sort((a, b) => {
        const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (p !== 0) return p;
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDue - bDue;
      });
    }
    return grouped;
  }, [displayColumns, actions]);

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

    const target = displayColumns.find((c) => c.id === overId);
    if (!target) return;

    // En vue multi-équipes la colonne visée n'est qu'une catégorie : on renvoie
    // l'action vers la colonne équivalente de SON propre flux plutôt que de
    // l'arracher au flux de son équipe.
    const resolved = activeWorkflow
      ? target
      : equivalentColumn(workflowForAction(current)?.columns ?? [], target.category);

    const nextColumnId = resolved?.id ?? null;
    const nextStatus = target.category;
    if (current.columnId === nextColumnId && current.status === nextStatus) return;

    // useOptimistic mutations must happen inside a transition. On error the
    // optimistic value is automatically discarded on the next render, so we
    // only need to surface the message — no manual rollback.
    startTransition(async () => {
      applyOptimistic({ id: actionId, columnId: nextColumnId, status: nextStatus });
      try {
        // columnId quand la colonne cible est connue (le serveur en dérive le
        // statut) ; sinon le statut seul, pour une action hors flux.
        const payload = nextColumnId
          ? { columnId: nextColumnId }
          : { columnId: null, status: nextStatus };
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
      <div className="mb-2 text-[11px] text-izi-gray">
        {activeWorkflow ? (
          <span>
            Flux <span className="font-medium text-dark">{activeWorkflow.name}</span>
          </span>
        ) : (
          <span>
            Plusieurs équipes — colonnes regroupées par catégorie. Filtrez sur une
            entité pour voir son flux.
          </span>
        )}
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Colonne unique sur mobile, rail scrollable dès sm : le nombre de
            colonnes est libre, la grille fixe à 5 ne tient plus. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:overflow-x-auto sm:pb-2">
          {displayColumns.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              cards={byColumn[col.id] ?? []}
              canDrag={canDrag}
              onCardClick={onCardClick}
            />
          ))}
          {orphans.length > 0 && (
            <KanbanColumn
              column={{
                id: "orphans",
                label: "Hors flux",
                color: "#8a9aa5",
                category: "TODO",
                sortOrder: 999,
                wipLimit: null,
              }}
              cards={orphans}
              canDrag={false}
              onCardClick={onCardClick}
              hint="Ces actions ont une catégorie sans colonne dans ce flux. Déposez-les dans une colonne pour les réintégrer."
            />
          )}
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
  column: BoardColumnDef;
  cards: KanbanAction[];
  canDrag: boolean;
  onCardClick?: (action: KanbanAction) => void;
  /** La colonne « Hors flux » se vide mais ne se remplit pas. */
  hint?: string;
}

function KanbanColumn({ column, cards, canDrag, onCardClick, hint }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !!hint });
  const wip = wipState(cards.length, column.wipLimit);
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-[10px] border bg-izi-gray-lt/40 transition-colors sm:w-[260px] sm:shrink-0 ${
        isOver ? "border-teal bg-teal-lt/60" : "border-border-soft"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-soft">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: column.color }}
            aria-hidden
          />
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-dark"
            title={hint ?? column.label}
          >
            {column.label}
          </span>
        </div>
        <span
          className={`shrink-0 font-mono text-[10px] ${
            wip === "OVER"
              ? "font-semibold text-[var(--red)]"
              : wip === "AT"
              ? "font-semibold text-gold"
              : "text-izi-gray"
          }`}
          title={
            column.wipLimit
              ? `Limite d'encours : ${cards.length}/${column.wipLimit}`
              : undefined
          }
        >
          {cards.length}
          {column.wipLimit ? `/${column.wipLimit}` : ""}
        </span>
      </div>
      {hint && (
        <p className="px-3 pt-2 text-[10px] leading-snug text-izi-gray">{hint}</p>
      )}
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
