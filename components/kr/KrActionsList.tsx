"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { ActionCard } from "@/components/ui/ActionCard";
import { ActionEditModal, type EditableAction } from "@/components/ui/ActionEditModal";

export interface KrActionItem {
  id: string;
  title: string;
  description: string | null;
  status: ActionStatus;
  priority: ActionPriority;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
}

interface Props {
  actions: KrActionItem[];
  users: { id: string; name: string }[];
  currentUserRole: UserRole;
}

export function KrActionsList({ actions, users, currentUserRole }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableAction | null>(null);

  const canEdit = currentUserRole !== "VIEWER";
  const canDelete = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";

  const openEditor = (a: KrActionItem) =>
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
        {actions.map((a) => (
          <ActionCard
            key={a.id}
            id={a.id}
            title={a.title}
            description={a.description}
            assigneeName={a.assigneeName}
            status={a.status}
            priority={a.priority}
            dueDate={a.dueDate}
            onClick={canEdit ? () => openEditor(a) : undefined}
          />
        ))}
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
