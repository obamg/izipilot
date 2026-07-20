"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RequestStatus } from "@prisma/client";
import type { TaskRequestItem } from "./types";

const STATUS_STYLE: Record<RequestStatus, { label: string; cls: string }> = {
  OPEN: { label: "En attente", cls: "bg-gold-lt text-[#946200]" },
  RESOLVED: { label: "Résolue", cls: "bg-green-lt text-green" },
  DECLINED: { label: "Refusée", cls: "bg-red-lt text-red" },
  CANCELLED: { label: "Annulée", cls: "bg-izi-gray-lt text-izi-gray" },
};

interface Props {
  initialReceived: TaskRequestItem[];
  initialSent: TaskRequestItem[];
  canAct: boolean; // false for VIEWER
}

export function TaskRequestsInbox({ initialReceived, initialSent, canAct }: Props) {
  const router = useRouter();
  const [received, setReceived] = useState(initialReceived);
  const [sent, setSent] = useState(initialSent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/sprint-task-requests");
    if (res.ok) {
      const data = await res.json();
      setReceived(data.received ?? []);
      setSent(data.sent ?? []);
    }
    router.refresh(); // board chips reflect closed requests
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
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-2 rounded-[7px] border border-red/30 bg-red-lt px-3 py-2 text-[11px] text-red">
          {error}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Reçues */}
        <section className="rounded-[12px] border border-gold/25 bg-gold-lt/40 p-4">
          <h2 className="font-serif text-[15px] text-dark mb-0.5">
            Reçues
            {received.length > 0 && (
              <span className="ml-1.5 font-mono text-[11px] text-izi-gray">{received.length}</span>
            )}
          </h2>
          <p className="text-[11px] text-izi-gray mb-3">Ce que d&apos;autres attendent de vous.</p>
          {received.length === 0 ? (
            <p className="text-[12px] text-izi-gray py-3">Rien en attente de votre part. 🎉</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {received.map((r) => (
                <li key={r.id} className="rounded-[8px] border border-border-soft bg-white p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-medium text-dark">{r.kindLabel}</span>
                    <span className="text-[10px] text-izi-gray truncate max-w-[150px]" title={r.taskTitle}>
                      {r.taskTitle}
                    </span>
                  </div>
                  <p className="text-[11px] text-dark/80 mb-1 whitespace-pre-wrap">{r.message}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-izi-gray">de {r.requestedByName}</span>
                    {canAct && (
                      <div className="flex items-center gap-2">
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
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Envoyées */}
        <section className="rounded-[12px] border border-border-soft bg-white p-4">
          <h2 className="font-serif text-[15px] text-dark mb-0.5">
            Envoyées
            {sent.length > 0 && (
              <span className="ml-1.5 font-mono text-[11px] text-izi-gray">{sent.length}</span>
            )}
          </h2>
          <p className="text-[11px] text-izi-gray mb-3">Vos demandes à d&apos;autres équipes.</p>
          {sent.length === 0 ? (
            <p className="text-[12px] text-izi-gray py-3">Aucune demande envoyée.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sent.map((r) => {
                const st = STATUS_STYLE[r.status];
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
                      <span className="text-[10px] text-izi-gray truncate max-w-[150px]" title={r.taskTitle}>
                        {r.taskTitle}
                      </span>
                      {r.status === "OPEN" && canAct && (
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
                    {r.resolutionNote && (
                      <p className="mt-1 text-[10px] text-izi-gray italic">↳ {r.resolutionNote}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
