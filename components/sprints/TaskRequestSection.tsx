"use client";

import { useEffect, useState } from "react";
import type { UserRole, RequestKind, RequestStatus } from "@prisma/client";
import { canRaiseRequest, canCancelRequest } from "@/lib/sprint-request";
import type { TaskRequestItem, UserOption, TeamOption } from "./types";

const KIND_OPTIONS: { value: RequestKind; label: string }[] = [
  { value: "INPUT", label: "Contribution" },
  { value: "REVIEW", label: "Relecture" },
  { value: "APPROVAL", label: "Approbation" },
  { value: "DATA", label: "Données" },
  { value: "OTHER", label: "Autre" },
];

const STATUS_STYLE: Record<RequestStatus, { label: string; cls: string }> = {
  OPEN: { label: "En attente", cls: "bg-gold-lt text-[#946200]" },
  RESOLVED: { label: "Résolue", cls: "bg-green-lt text-green" },
  DECLINED: { label: "Refusée", cls: "bg-red-lt text-red" },
  CANCELLED: { label: "Annulée", cls: "bg-izi-gray-lt text-izi-gray" },
};

interface Props {
  taskId: string;
  taskAssigneeId: string | null;
  currentUserId: string;
  currentUserRole: UserRole;
  users: UserOption[];
  products: TeamOption[];
  departments: TeamOption[];
  onChanged?: () => void;
}

export function TaskRequestSection({
  taskId,
  taskAssigneeId,
  currentUserId,
  currentUserRole,
  users,
  products,
  departments,
  onChanged,
}: Props) {
  const [requests, setRequests] = useState<TaskRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<RequestKind>("INPUT");
  const [target, setTarget] = useState(""); // "U:id" | "P:id" | "D:id"
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPrivileged = currentUserRole === "CEO" || currentUserRole === "MANAGEMENT";
  const mayRaise = canRaiseRequest({ assigneeId: taskAssigneeId }, {
    userId: currentUserId,
    role: currentUserRole,
  });

  async function load() {
    try {
      const res = await fetch(`/api/sprint-tasks/${taskId}/requests`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  function targetPayload(): Record<string, string> | null {
    if (target.startsWith("U:")) return { targetUserId: target.slice(2) };
    if (target.startsWith("P:")) return { targetProductId: target.slice(2) };
    if (target.startsWith("D:")) return { targetDepartmentId: target.slice(2) };
    return null;
  }

  async function submit() {
    const tp = targetPayload();
    if (!tp || message.trim().length < 2) {
      setError("Choisissez une cible et saisissez un message.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sprint-tasks/${taskId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: message.trim(), ...tp }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Échec de l'envoi");
        return;
      }
      setMessage("");
      setTarget("");
      setKind("INPUT");
      setShowForm(false);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, status: "RESOLVED" | "DECLINED" | "CANCELLED") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sprint-task-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Action impossible");
        return;
      }
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  // Client-side action visibility (server is authoritative). Modal handles
  // person-targeted + privileged resolve; team-targeted resolve lives in the
  // Demandes inbox tab (server-filtered).
  function mayResolve(r: TaskRequestItem): boolean {
    if (r.status !== "OPEN") return false;
    return isPrivileged || (r.targetType === "USER" && r.targetId === currentUserId);
  }

  return (
    <div className="border-t border-border-soft pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-semibold text-dark">
          Demandes
          {requests.length > 0 && (
            <span className="ml-1.5 font-mono text-[10px] text-izi-gray">
              {requests.length}
            </span>
          )}
        </h3>
        {mayRaise && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-[11px] font-medium text-teal hover:text-teal-dk"
          >
            + Demander de l'aide
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-3 rounded-[8px] border border-border-soft bg-izi-gray-lt/30 p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as RequestKind)}
              className="rounded-[6px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
              aria-label="Type de demande"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="rounded-[6px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal"
              aria-label="Cible de la demande"
            >
              <option value="">Cible…</option>
              <optgroup label="Personnes">
                {users
                  .filter((u) => u.id !== currentUserId)
                  .map((u) => (
                    <option key={u.id} value={`U:${u.id}`}>{u.name}</option>
                  ))}
              </optgroup>
              <optgroup label="Produits">
                {products.map((p) => (
                  <option key={p.id} value={`P:${p.id}`}>{p.code} — {p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Départements">
                {departments.map((d) => (
                  <option key={d.id} value={`D:${d.id}`}>{d.code} — {d.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Que vous faut-il ?"
            className="w-full rounded-[6px] border border-border-soft bg-white px-2 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-[11px] text-izi-gray hover:underline"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-[6px] bg-teal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-dk disabled:opacity-50"
            >
              Envoyer
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-[6px] border border-red/30 bg-red-lt px-2.5 py-1.5 text-[11px] text-red">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[11px] text-izi-gray py-2">Chargement…</p>
      ) : requests.length === 0 ? (
        <p className="text-[11px] text-izi-gray py-1">Aucune demande sur cette tâche.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => {
            const st = STATUS_STYLE[r.status];
            const canCancel = canCancelRequest(
              { requestedById: r.requestedById, status: r.status, targetUserId: null, targetDepartmentId: null, targetProductId: null },
              { userId: currentUserId }
            );
            return (
              <li key={r.id} className="rounded-[8px] border border-border-soft bg-white p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-medium text-dark">
                    {r.kindLabel} · <span className="text-izi-gray">{r.targetLabel}</span>
                  </span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
                <p className="text-[11px] text-dark/80 mb-1 whitespace-pre-wrap">{r.message}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-izi-gray">
                    par {r.requestedByName}
                    {r.status !== "OPEN" && r.resolvedByName ? ` · clôturée par ${r.resolvedByName}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {mayResolve(r) && (
                      <>
                        <button
                          type="button"
                          onClick={() => act(r.id, "RESOLVED")}
                          disabled={busy}
                          className="text-[11px] font-medium text-green hover:underline disabled:opacity-50"
                        >
                          Résoudre
                        </button>
                        <button
                          type="button"
                          onClick={() => act(r.id, "DECLINED")}
                          disabled={busy}
                          className="text-[11px] font-medium text-red hover:underline disabled:opacity-50"
                        >
                          Refuser
                        </button>
                      </>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => act(r.id, "CANCELLED")}
                        disabled={busy}
                        className="text-[11px] font-medium text-izi-gray hover:underline disabled:opacity-50"
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
                {r.resolutionNote && (
                  <p className="mt-1 text-[10px] text-izi-gray italic">↳ {r.resolutionNote}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
