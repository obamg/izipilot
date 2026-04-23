"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserFormModal } from "./UserFormModal";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { ConfirmDialog } from "./ConfirmDialog";

interface UserData {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UsersTableProps {
  users: UserData[];
  currentUserId: string;
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  CEO: { bg: "var(--teal-lt)", text: "var(--teal)" },
  MANAGEMENT: { bg: "var(--gold-lt)", text: "#7a5500" },
  PO: { bg: "var(--green-lt)", text: "var(--green)" },
  VIEWER: { bg: "var(--gray-lt)", text: "var(--gray)" },
};

export function UsersTable({ users, currentUserId }: UsersTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [editUser, setEditUser] = useState<UserData | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState<UserData | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<UserData | null>(null);

  const filtered = users.filter((u) => {
    if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleDeactivate() {
    if (!deactivateUser) return;
    try {
      await fetch(`/api/admin/users/${deactivateUser.id}`, { method: "DELETE" });
      setDeactivateUser(null);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to deactivate user:", err);
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher..."
          className="px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark font-sans w-[200px]"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-[9px] py-[7px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white font-sans"
        >
          <option value="ALL">Tous les r&ocirc;les</option>
          <option value="CEO">CEO</option>
          <option value="MANAGEMENT">Management</option>
          <option value="PO">PO</option>
          <option value="VIEWER">Viewer</option>
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="ml-auto px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors"
        >
          + Nouvel utilisateur
        </button>
      </div>

      {/* Desktop table */}
      <div className="bg-white rounded-[10px] border border-[#deeaea] overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-izi-gray-lt bg-izi-gray-lt/30">
                <th className="text-left py-2.5 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                  Nom
                </th>
                <th className="text-left py-2.5 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                  Email
                </th>
                <th className="text-center py-2.5 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                  R&ocirc;le
                </th>
                <th className="text-center py-2.5 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                  Statut
                </th>
                <th className="text-center py-2.5 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                  Derni&egrave;re connexion
                </th>
                <th className="text-right py-2.5 px-3 text-[9px] font-semibold tracking-[0.07em] uppercase text-izi-gray">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const roleColor = ROLE_COLORS[user.role] ?? ROLE_COLORS.VIEWER;
                return (
                  <tr
                    key={user.id}
                    className="border-b border-izi-gray-lt last:border-b-0 hover:bg-izi-gray-lt/30 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-medium text-dark">
                      {user.name}
                    </td>
                    <td className="py-2.5 px-3 text-izi-gray">{user.email}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className="inline-flex px-2 py-0.5 rounded text-[9px] font-semibold"
                        style={{ backgroundColor: roleColor.bg, color: roleColor.text }}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[9px] font-semibold ${
                          user.isActive
                            ? "bg-izi-green-lt text-izi-green"
                            : "bg-izi-red-lt text-izi-red"
                        }`}
                      >
                        {user.isActive ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-izi-gray">
                      {formatDate(user.lastLoginAt)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditUser(user)}
                          className="px-2 py-1 rounded text-[9px] font-medium text-teal hover:bg-teal-lt transition-colors"
                        >
                          Modifier
                        </button>
                        <button
                          onClick={() => setResetUser(user)}
                          className="px-2 py-1 rounded text-[9px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
                        >
                          MdP
                        </button>
                        {user.id !== currentUserId && user.isActive && (
                          <button
                            onClick={() => setDeactivateUser(user)}
                            className="px-2 py-1 rounded text-[9px] font-medium text-izi-red hover:bg-izi-red-lt transition-colors"
                          >
                            D&eacute;sactiver
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-izi-gray-lt">
          {filtered.map((user) => {
            const roleColor = ROLE_COLORS[user.role] ?? ROLE_COLORS.VIEWER;
            return (
              <div key={user.id} className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-dark">
                    {user.name}
                  </span>
                  <span
                    className="inline-flex px-2 py-0.5 rounded text-[9px] font-semibold"
                    style={{ backgroundColor: roleColor.bg, color: roleColor.text }}
                  >
                    {user.role}
                  </span>
                </div>
                <div className="text-[10px] text-izi-gray mb-2">
                  {user.email}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditUser(user)}
                    className="px-2 py-1 rounded text-[9px] font-medium text-teal border border-teal-md hover:bg-teal-lt transition-colors"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={() => setResetUser(user)}
                    className="px-2 py-1 rounded text-[9px] font-medium text-izi-gray border border-izi-gray-lt hover:bg-izi-gray-lt transition-colors"
                  >
                    MdP
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="p-8 text-center text-[11px] text-izi-gray">
            Aucun utilisateur trouv&eacute;.
          </div>
        )}
      </div>

      {/* Modals */}
      <UserFormModal
        open={showCreate || !!editUser}
        onClose={() => {
          setShowCreate(false);
          setEditUser(null);
        }}
        user={editUser}
      />

      {resetUser && (
        <ResetPasswordModal
          open={!!resetUser}
          onClose={() => setResetUser(null)}
          userId={resetUser.id}
          userName={resetUser.name}
        />
      )}

      <ConfirmDialog
        open={!!deactivateUser}
        onClose={() => setDeactivateUser(null)}
        onConfirm={handleDeactivate}
        title="D\u00e9sactiver l'utilisateur"
        message={`\u00cates-vous s\u00fbr de vouloir d\u00e9sactiver ${deactivateUser?.name} ? Il ne pourra plus se connecter.`}
        confirmLabel="D\u00e9sactiver"
        destructive
        loading={isPending}
      />
    </div>
  );
}
