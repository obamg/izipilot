"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionStatus, ActionPriority, UserRole } from "@prisma/client";
import { ActionStatusBadge } from "@/components/ui/ActionStatusBadge";
import { ActionPriorityBadge } from "@/components/ui/ActionPriorityBadge";
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export function EntityActionsList({ actions, users, currentUserRole, limit = 10 }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableAction | null>(null);

  const canEdit = currentUserRole !== "VIEWER";
  const canDelete = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";

  const visible = actions.slice(0, limit);
  const remaining = actions.length - visible.length;

  return (
    <>
      <div className="space-y-1.5">
        {visible.map((a) => {
          const isOverdue = a.dueDate && new Date(a.dueDate) < new Date();
          return (
            <div
              key={a.id}
              onClick={
                canEdit
                  ? () =>
                      setEditing({
                        id: a.id,
                        title: a.title,
                        description: a.description,
                        assigneeId: a.assigneeId,
                        status: a.status,
                        priority: a.priority,
                        dueDate: a.dueDate,
                      })
                  : undefined
              }
              className={`flex items-center gap-2 px-3 py-2 rounded-md border border-[#deeaea] hover:border-teal-md transition-colors ${
                canEdit ? "cursor-pointer" : ""
              }`}
            >
              <ActionStatusBadge status={a.status} />
              <ActionPriorityBadge priority={a.priority} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-dark truncate">
                  {a.title}
                </div>
                <div className="text-[10px] text-izi-gray truncate">
                  {a.krTitle} &middot; Assign&eacute; &agrave; {a.assigneeName}
                </div>
              </div>
              {a.dueDate && (
                <div
                  className={`text-[10px] font-medium shrink-0 ${
                    isOverdue ? "text-red" : "text-izi-gray"
                  }`}
                >
                  {formatDate(a.dueDate)}
                </div>
              )}
            </div>
          );
        })}
        {remaining > 0 && (
          <div className="text-[11px] text-izi-gray text-center pt-2">
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
