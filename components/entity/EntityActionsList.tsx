"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { ActionCard } from "@/components/ui/ActionCard";
import { ActionEditModal, type EditableAction } from "@/components/ui/ActionEditModal";

export interface EntityAction {
  id: string;
  title: string;
  description: string | null;
  status: ActionStatus;
  priority: ActionPriority;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
  krTitle: string;
}

interface Props {
  actions: EntityAction[];
  users: { id: string; name: string }[];
  currentUserRole: UserRole;
  limit?: number;
}

export function EntityActionsList({ actions, users, currentUserRole, limit = 10 }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableAction | null>(null);

  const canEdit = currentUserRole !== "VIEWER";
  const canDelete = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";

  const visible = actions.slice(0, limit);
  const remaining = actions.length - visible.length;

  const openEditor = (a: EntityAction) =>
    setEditing({
      id: a.id,
      title: a.title,
      description: a.description,
      assigneeId: a.assigneeId,
      status: a.status,
      priority: a.priority,
      dueDate: a.dueDate,
    });

  return (
    <>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {visible.map((a) => (
          <ActionCard
            key={a.id}
            id={a.id}
            title={a.title}
            description={a.description}
            context={a.krTitle}
            assigneeName={a.assigneeName}
            status={a.status}
            priority={a.priority}
            dueDate={a.dueDate}
            onClick={canEdit ? () => openEditor(a) : undefined}
          />
        ))}
        {remaining > 0 && (
          <div className="text-[11px] text-izi-gray text-center pt-2 sm:col-span-2">
            + {remaining} autre{remaining > 1 ? "s" : ""}
          </div>
        )}
      </div>

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
    </>
  );
}
