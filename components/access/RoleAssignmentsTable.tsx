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

      {error && <p className="px-4 py-2 text-[11px] text-red-dk bg-izi-red-lt">{error}</p>}

      {visibleAssignments.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-izi-gray">
          Aucun rôle attribué pour l&apos;instant.
        </div>
      ) : (
        <div className="overflow-x-auto">
        <table className="izi-table">
          <thead>
            <tr>
              <th>Rôle</th>
              <th>Titulaire</th>
              <th>Suppléant</th>
              <th>Disponibilité</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleAssignments.map((a) => (
              <tr key={a.id}>
                <td className="font-medium text-dark">{ROLE_LABELS[a.role]}</td>
                <td className="text-dark">{a.userName}</td>
                <td className="text-izi-gray">{a.backupUserName ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => toggleUnavailable(a.id, a.primaryUnavailable)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      a.primaryUnavailable
                        ? "bg-izi-red-lt text-red-dk"
                        : "bg-izi-green-lt text-green-dk"
                    }`}
                  >
                    {a.primaryUnavailable ? "Indisponible" : "Disponible"}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => removeAssignment(a.id)}
                    className="text-[11px] text-izi-gray hover:text-red-dk"
                  >
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <RoleAssignmentFormModal open={modalOpen} onClose={() => setModalOpen(false)} users={users} />
    </div>
  );
}
