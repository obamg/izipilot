"use client";

import { useMemo } from "react";
import type { UserRole } from "@prisma/client";
import type { AvailabilityMemberVM } from "./types";

interface AvailabilityPanelProps {
  members: AvailabilityMemberVM[];
}

// Doers first (they're the ones who actually need work), then the rest.
const ROLE_ORDER: Record<UserRole, number> = {
  PO: 0,
  CONTRIBUTOR: 1,
  CEO: 2,
  MANAGEMENT: 3,
  VIEWER: 4,
};

const ROLE_LABEL: Record<UserRole, string> = {
  CEO: "CEO",
  MANAGEMENT: "Management",
  PO: "PO",
  CONTRIBUTOR: "Contributeur",
  VIEWER: "Viewer",
};

const DOER_ROLES = new Set<UserRole>(["PO", "CONTRIBUTOR"]);

function byRoleThenName(a: AvailabilityMemberVM, b: AvailabilityMemberVM): number {
  const ra = ROLE_ORDER[a.role] ?? 9;
  const rb = ROLE_ORDER[b.role] ?? 9;
  if (ra !== rb) return ra - rb;
  return a.userName.localeCompare(b.userName);
}

function RoleChip({ role }: { role: UserRole }) {
  const doer = DOER_ROLES.has(role);
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] ${
        doer ? "bg-teal-lt text-teal-dk" : "bg-izi-gray-lt text-izi-gray"
      }`}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

/** e.g. "3 à faire · 1 bloqué · 2 terminé" — only non-zero segments. */
function breakdown(m: AvailabilityMemberVM): string {
  const parts: string[] = [];
  if (m.todo > 0) parts.push(`${m.todo} à faire`);
  if (m.blocked > 0) parts.push(`${m.blocked} bloqué${m.blocked > 1 ? "s" : ""}`);
  if (m.done > 0) parts.push(`${m.done} terminé${m.done > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export function AvailabilityPanel({ members }: AvailabilityPanelProps) {
  const { noTask, noOngoing, activeCount } = useMemo(() => {
    const noTask = members.filter((m) => m.state === "IDLE").sort(byRoleThenName);
    const noOngoing = members
      .filter((m) => m.state === "NO_ONGOING")
      .sort(byRoleThenName);
    const activeCount = members.filter((m) => m.state === "ACTIVE").length;
    return { noTask, noOngoing, activeCount };
  }, [members]);

  if (members.length === 0) {
    return (
      <p className="text-[13px] text-izi-gray py-6 text-center">
        Aucun membre actif à analyser.
      </p>
    );
  }

  return (
    <div>
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-[12px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green" />
          <span className="font-mono font-semibold text-dark">{activeCount}</span>
          <span className="text-izi-gray">actif{activeCount > 1 ? "s" : ""}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-gold" />
          <span className="font-mono font-semibold text-dark">{noOngoing.length}</span>
          <span className="text-izi-gray">sans tâche en cours</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red" />
          <span className="font-mono font-semibold text-dark">{noTask.length}</span>
          <span className="text-izi-gray">sans tâche</span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Sans tâche */}
        <section className="rounded-[12px] border border-red/20 bg-red-lt/40 p-4">
          <h2 className="font-serif text-[15px] text-dark mb-0.5">Sans tâche</h2>
          <p className="text-[11px] text-izi-gray mb-3">
            Aucune tâche assignée sur ce sprint.
          </p>
          {noTask.length === 0 ? (
            <p className="text-[12px] text-izi-gray py-3">
              Tout le monde a au moins une tâche. 👍
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {noTask.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-[8px] bg-white px-3 py-2 border border-border-soft"
                >
                  <span className="text-[13px] text-dark truncate">{m.userName}</span>
                  <RoleChip role={m.role} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Rien en cours */}
        <section className="rounded-[12px] border border-gold/25 bg-gold-lt/50 p-4">
          <h2 className="font-serif text-[15px] text-dark mb-0.5">Sans tâche en cours</h2>
          <p className="text-[11px] text-izi-gray mb-3">
            Des tâches assignées, mais rien « En cours ».
          </p>
          {noOngoing.length === 0 ? (
            <p className="text-[12px] text-izi-gray py-3">
              Tous les membres ayant des tâches en ont une en cours. 🎉
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {noOngoing.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-[8px] bg-white px-3 py-2 border border-border-soft"
                >
                  <div className="min-w-0">
                    <span className="text-[13px] text-dark truncate">{m.userName}</span>
                    <span className="block text-[10px] font-mono text-izi-gray">
                      {breakdown(m)}
                    </span>
                  </div>
                  <RoleChip role={m.role} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
