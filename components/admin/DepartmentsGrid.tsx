"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DepartmentFormModal } from "./DepartmentFormModal";
import { ConfirmDialog } from "./ConfirmDialog";

interface MemberData {
  id: string;
  userId: string;
  name: string;
  email: string;
  userRole: string;
  role: string;
}

interface DeptData {
  id: string;
  code: string;
  name: string;
  color: string;
  description: string | null;
  isActive: boolean;
  ownerId: string;
  ownerName: string;
  objectiveCount: number;
  members: MemberData[];
}

interface DepartmentsGridProps {
  departments: DeptData[];
  users: { id: string; name: string; email: string }[];
}

export function DepartmentsGrid({ departments, users }: DepartmentsGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [editDept, setEditDept] = useState<DeptData | null>(null);
  const [deleteDept, setDeleteDept] = useState<DeptData | null>(null);
  const [addingMemberTo, setAddingMemberTo] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<"MEMBER" | "LEAD">("MEMBER");
  const [memberLoading, setMemberLoading] = useState(false);

  async function handleDelete() {
    if (!deleteDept) return;
    try {
      const res = await fetch(`/api/admin/departments/${deleteDept.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erreur");
        return;
      }
      setDeleteDept(null);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to delete department:", err);
    }
  }

  async function handleAddMember(deptId: string) {
    if (!selectedUserId) return;
    setMemberLoading(true);
    try {
      const res = await fetch(`/api/admin/departments/${deptId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId, role: selectedRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erreur");
        return;
      }
      setAddingMemberTo(null);
      setSelectedUserId("");
      setSelectedRole("MEMBER");
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to add member:", err);
    } finally {
      setMemberLoading(false);
    }
  }

  async function handleRemoveMember(deptId: string, memberId: string) {
    setMemberLoading(true);
    try {
      const res = await fetch(
        `/api/admin/departments/${deptId}/members?memberId=${memberId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erreur");
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to remove member:", err);
    } finally {
      setMemberLoading(false);
    }
  }

  function getAvailableUsers(dept: DeptData) {
    const memberUserIds = new Set(dept.members.map((m) => m.userId));
    return users.filter((u) => !memberUserIds.has(u.id));
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowCreate(true)}
          className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors"
        >
          + Nouveau d&eacute;partement
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {departments.map((d) => (
          <div
            key={d.id}
            className={`bg-white rounded-[10px] border border-[#deeaea] p-4 ${
              !d.isActive ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="font-mono text-[9px] font-semibold px-[6px] py-[2px] rounded-sm text-white"
                style={{ backgroundColor: d.color }}
              >
                {d.code}
              </span>
              <span className="text-[11px] font-medium text-dark flex-1 truncate">
                {d.name}
              </span>
            </div>

            {d.description && (
              <p className="text-[10px] text-izi-gray mb-2 line-clamp-2">
                {d.description}
              </p>
            )}

            <div className="text-[10px] text-izi-gray mb-3">
              Resp: {d.ownerName} &middot; {d.objectiveCount} objectif(s)
            </div>

            {/* Members section */}
            <div className="border-t border-[#deeaea] pt-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-izi-gray">
                  Membres ({d.members.length})
                </span>
                <button
                  onClick={() => {
                    setAddingMemberTo(addingMemberTo === d.id ? null : d.id);
                    setSelectedUserId("");
                    setSelectedRole("MEMBER");
                  }}
                  className="text-[9px] font-medium text-teal hover:text-teal-dk transition-colors"
                >
                  {addingMemberTo === d.id ? "Annuler" : "+ Ajouter"}
                </button>
              </div>

              {/* Add member form */}
              {addingMemberTo === d.id && (
                <div className="bg-izi-gray-lt rounded-md p-2 mb-2 space-y-2">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full px-2 py-1 border border-teal-md rounded text-[10px] bg-white"
                  >
                    <option value="">S&eacute;lectionner un utilisateur...</option>
                    {getAvailableUsers(d).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value as "MEMBER" | "LEAD")}
                      className="flex-1 px-2 py-1 border border-teal-md rounded text-[10px] bg-white"
                    >
                      <option value="MEMBER">Membre</option>
                      <option value="LEAD">Lead</option>
                    </select>
                    <button
                      onClick={() => handleAddMember(d.id)}
                      disabled={!selectedUserId || memberLoading}
                      className="px-3 py-1 rounded text-[9px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
                    >
                      {memberLoading ? "..." : "Ajouter"}
                    </button>
                  </div>
                </div>
              )}

              {/* Members list */}
              {d.members.length > 0 ? (
                <div className="space-y-1">
                  {d.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 group py-1 px-1 rounded hover:bg-izi-gray-lt"
                    >
                      <div className="w-[20px] h-[20px] rounded-full bg-teal/20 flex items-center justify-center text-[8px] font-semibold text-teal">
                        {m.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-medium text-dark truncate block">
                          {m.name}
                        </span>
                      </div>
                      {m.role === "LEAD" && (
                        <span className="text-[8px] font-semibold px-[5px] py-[1px] rounded bg-gold/20 text-gold">
                          LEAD
                        </span>
                      )}
                      <button
                        onClick={() => handleRemoveMember(d.id, m.id)}
                        className="opacity-0 group-hover:opacity-100 text-[9px] text-izi-red hover:text-izi-red/80 transition-all"
                        title="Retirer"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[9px] text-izi-gray/60 italic">Aucun membre</p>
              )}
            </div>

            <div className="flex gap-1">
              <button
                onClick={() => setEditDept(d)}
                className="px-2 py-1 rounded text-[9px] font-medium text-teal border border-teal-md hover:bg-teal-lt transition-colors"
              >
                Modifier
              </button>
              {d.isActive && (
                <button
                  onClick={() => setDeleteDept(d)}
                  className="px-2 py-1 rounded text-[9px] font-medium text-izi-red border border-izi-red-lt hover:bg-izi-red-lt transition-colors"
                >
                  Supprimer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {departments.length === 0 && (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">Aucun d&eacute;partement.</p>
        </div>
      )}

      <DepartmentFormModal
        open={showCreate || !!editDept}
        onClose={() => {
          setShowCreate(false);
          setEditDept(null);
        }}
        department={editDept}
        users={users}
      />

      <ConfirmDialog
        open={!!deleteDept}
        onClose={() => setDeleteDept(null)}
        onConfirm={handleDelete}
        title="Supprimer le d\u00e9partement"
        message={`\u00cates-vous s\u00fbr de vouloir supprimer ${deleteDept?.code} ${deleteDept?.name} ?`}
        confirmLabel="Supprimer"
        destructive
        loading={isPending}
      />
    </div>
  );
}
