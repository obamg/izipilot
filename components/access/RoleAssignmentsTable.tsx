"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RoleAssignmentFormModal } from "./RoleAssignmentFormModal";

interface RoleAssignmentDTO {
  id: string;
  role: string;
  userId: string | null;
  userName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
  revision: number;
}

const ROLE_LABELS: Record<string, string> = {
  IT_ACCESS_OPERATOR: "Opérateur accès IT",
  HR: "RH",
  CISO: "CISO",
  COO: "COO",
  ASSET_ADMINISTRATOR: "Administrateur d'actifs",
  AUDIT_VIEWER: "Auditeur",
  DEPARTMENT_HEAD: "Chef de département",
};

interface RoleAssignmentsTableProps {
  assignments: RoleAssignmentDTO[];
  users: { id: string; name: string }[];
}

export function RoleAssignmentsTable({ assignments, users }: RoleAssignmentsTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleAssignments = assignments.filter((a) => a.role !== "DEPARTMENT_HEAD");

  async function toggleUnavailable(assignmentId: string, current: boolean) {
    setError(null);
    const res = await fetch(`/api/access/roles/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primaryUnavailable: !current }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Erreur lors de la mise à jour");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function removeAssignment(assignmentId: string) {
    setError(null);
    const res = await fetch(`/api/access/roles/${assignmentId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Erreur lors du retrait");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-[10px] border border-border-soft bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
        <h2 className="text-[13px] font-semibold text-dark">Rôles attribués</h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors"
        >
          Attribuer un rôle
        </button>
      </div>

      {error && <p className="px-4 py-2 text-[11px] text-izi-red bg-izi-red-lt">{error}</p>}

      {visibleAssignments.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-izi-gray">
          Aucun rôle attribué pour l&apos;instant.
        </div>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border-soft text-izi-gray text-left">
              <th className="px-4 py-2 font-medium">Rôle</th>
              <th className="px-4 py-2 font-medium">Titulaire</th>
              <th className="px-4 py-2 font-medium">Suppléant</th>
              <th className="px-4 py-2 font-medium">Disponibilité</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibleAssignments.map((a) => (
              <tr key={a.id} className="border-b border-border-soft last:border-0">
                <td className="px-4 py-2 font-medium text-dark">{ROLE_LABELS[a.role]}</td>
                <td className="px-4 py-2 text-dark">{a.userName}</td>
                <td className="px-4 py-2 text-izi-gray">{a.backupUserName ?? "—"}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleUnavailable(a.id, a.primaryUnavailable)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      a.primaryUnavailable
                        ? "bg-izi-red-lt text-izi-red"
                        : "bg-izi-green-lt text-izi-green"
                    }`}
                  >
                    {a.primaryUnavailable ? "Indisponible" : "Disponible"}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeAssignment(a.id)}
                    className="text-[11px] text-izi-gray hover:text-izi-red"
                  >
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RoleAssignmentFormModal open={modalOpen} onClose={() => setModalOpen(false)} users={users} />
    </div>
  );
}
