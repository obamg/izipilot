"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ObjectiveFormModal } from "./ObjectiveFormModal";
import { KeyResultFormModal } from "./KeyResultFormModal";
import { ConfirmDialog } from "./ConfirmDialog";

interface KrData {
  id: string;
  title: string;
  krType: string;
  target: number | null;
  targetUnit: string | null;
  targetDate: string | null;
  currentValue: number;
  score: string | number;
  status: string;
  ownerId: string;
  owner: { id: string; name: string };
  isActive: boolean;
}

interface ObjectiveData {
  id: string;
  title: string;
  why: string | null;
  entityType: string;
  departmentId: string | null;
  productId: string | null;
  quarter: string;
  year: number;
  isActive: boolean;
  department: { id: string; code: string; name: string; color: string } | null;
  product: { id: string; code: string; name: string; color: string } | null;
  keyResults: KrData[];
}

interface OkrManagerProps {
  objectives: ObjectiveData[];
  departments: { id: string; code: string; name: string }[];
  products: { id: string; code: string; name: string }[];
  users: { id: string; name: string }[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ON_TRACK: { label: "En bonne voie", color: "#1d9e75" },
  AT_RISK: { label: "Attention", color: "#f4a900" },
  BLOCKED: { label: "Bloqué", color: "#e23c4a" },
  NOT_STARTED: { label: "Non démarré", color: "#5f6e7a" },
};

export function OkrManager({
  objectives,
  departments,
  products,
  users,
}: OkrManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Objective modals
  const [showCreateObj, setShowCreateObj] = useState(false);
  const [editObj, setEditObj] = useState<ObjectiveData | null>(null);
  const [deleteObj, setDeleteObj] = useState<ObjectiveData | null>(null);

  // KR modals
  const [addKrForObj, setAddKrForObj] = useState<string | null>(null);
  const [editKr, setEditKr] = useState<{ kr: KrData; objId: string } | null>(null);
  const [deleteKr, setDeleteKr] = useState<KrData | null>(null);

  // Filters
  const [filterQuarter, setFilterQuarter] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  const filtered = objectives.filter((o) => {
    if (filterQuarter !== "all" && o.quarter !== filterQuarter) return false;
    if (filterType !== "all" && o.entityType !== filterType) return false;
    return true;
  });

  async function handleDeleteObj() {
    if (!deleteObj) return;
    try {
      const res = await fetch(`/api/admin/objectives/${deleteObj.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erreur");
        return;
      }
      setDeleteObj(null);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to delete objective:", err);
    }
  }

  async function handleDeleteKr() {
    if (!deleteKr) return;
    try {
      const res = await fetch(`/api/admin/key-results/${deleteKr.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erreur");
        return;
      }
      setDeleteKr(null);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to delete KR:", err);
    }
  }

  function getEntityBadge(o: ObjectiveData) {
    const entity = o.department || o.product;
    if (!entity) return null;
    return (
      <span
        className="font-mono text-[9px] font-semibold px-[6px] py-[2px] rounded-sm text-white"
        style={{ backgroundColor: entity.color }}
      >
        {entity.code}
      </span>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={filterQuarter}
          onChange={(e) => setFilterQuarter(e.target.value)}
          className="px-[9px] py-[6px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white"
        >
          <option value="all">Tous les trimestres</option>
          <option value="Q1">Q1</option>
          <option value="Q2">Q2</option>
          <option value="Q3">Q3</option>
          <option value="Q4">Q4</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-[9px] py-[6px] border border-teal-md rounded-[7px] text-[11px] text-dark bg-white"
        >
          <option value="all">Tous les types</option>
          <option value="DEPARTMENT">D&eacute;partements</option>
          <option value="PRODUCT">Produits</option>
        </select>

        <div className="flex-1" />

        <button
          onClick={() => setShowCreateObj(true)}
          className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors"
        >
          + Nouvel objectif
        </button>
      </div>

      {/* Objectives list */}
      <div className="space-y-3">
        {filtered.map((o) => (
          <div
            key={o.id}
            className={`bg-white rounded-[10px] border border-[#deeaea] overflow-hidden ${
              !o.isActive ? "opacity-50" : ""
            }`}
          >
            {/* Objective header */}
            <div className="px-4 py-3 border-b border-[#deeaea] flex items-center gap-2">
              {getEntityBadge(o)}
              <span className="text-[11px] font-medium text-dark flex-1 truncate">
                {o.title}
              </span>
              <span className="font-mono text-[9px] text-izi-gray">{o.quarter} {o.year}</span>
              <button
                onClick={() => setEditObj(o)}
                className="px-2 py-1 rounded text-[9px] font-medium text-teal border border-teal-md hover:bg-teal-lt transition-colors"
              >
                Modifier
              </button>
              {o.isActive && o.keyResults.length === 0 && (
                <button
                  onClick={() => setDeleteObj(o)}
                  className="px-2 py-1 rounded text-[9px] font-medium text-izi-red border border-izi-red-lt hover:bg-izi-red-lt transition-colors"
                >
                  Supprimer
                </button>
              )}
            </div>

            {/* Why */}
            {o.why && (
              <div className="px-4 py-2 bg-teal-lt/30">
                <p className="text-[10px] text-izi-gray italic">{o.why}</p>
              </div>
            )}

            {/* Key Results */}
            <div className="divide-y divide-[#deeaea]">
              {o.keyResults.map((kr) => {
                const scoreNum = Math.round(Number(kr.score) * 100);
                const st = STATUS_LABELS[kr.status] || STATUS_LABELS.NOT_STARTED;
                return (
                  <div
                    key={kr.id}
                    className="px-4 py-2 flex items-center gap-2 hover:bg-izi-gray-lt/50 transition-colors"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: st.color }}
                    />
                    <span className="text-[11px] text-dark flex-1 truncate">
                      {kr.title}
                    </span>
                    <span className="font-mono text-[10px] text-izi-gray">
                      {kr.krType === "BINARY"
                        ? scoreNum === 100
                          ? "Oui"
                          : "Non"
                        : kr.krType === "DATE"
                        ? `${scoreNum}%`
                        : `${kr.currentValue}/${kr.target ?? "?"} ${kr.targetUnit ?? ""}`}
                    </span>
                    <span
                      className="font-mono text-[9px] font-semibold px-[5px] py-[1px] rounded"
                      style={{ color: st.color, backgroundColor: `${st.color}15` }}
                    >
                      {scoreNum}%
                    </span>
                    <span className="text-[9px] text-izi-gray truncate max-w-[80px]">
                      {kr.owner.name}
                    </span>
                    <button
                      onClick={() => setEditKr({ kr, objId: o.id })}
                      className="text-[9px] text-teal hover:underline"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => setDeleteKr(kr)}
                      className="text-[9px] text-izi-red hover:underline"
                    >
                      Supprimer
                    </button>
                  </div>
                );
              })}

              {o.keyResults.length === 0 && (
                <div className="px-4 py-3 text-center">
                  <p className="text-[10px] text-izi-gray">Aucun Key Result</p>
                </div>
              )}
            </div>

            {/* Add KR button */}
            {o.isActive && (
              <div className="px-4 py-2 border-t border-[#deeaea]">
                <button
                  onClick={() => setAddKrForObj(o.id)}
                  className="text-[10px] font-medium text-teal hover:underline"
                >
                  + Ajouter un Key Result
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">Aucun objectif trouv&eacute;.</p>
        </div>
      )}

      {/* Objective modals */}
      <ObjectiveFormModal
        open={showCreateObj || !!editObj}
        onClose={() => {
          setShowCreateObj(false);
          setEditObj(null);
        }}
        objective={editObj}
        departments={departments}
        products={products}
      />

      <ConfirmDialog
        open={!!deleteObj}
        onClose={() => setDeleteObj(null)}
        onConfirm={handleDeleteObj}
        title="Supprimer l'objectif"
        message={`\u00cates-vous s\u00fbr de vouloir supprimer "${deleteObj?.title}" ?`}
        confirmLabel="Supprimer"
        destructive
        loading={isPending}
      />

      {/* KR modals */}
      <KeyResultFormModal
        open={!!addKrForObj || !!editKr}
        onClose={() => {
          setAddKrForObj(null);
          setEditKr(null);
        }}
        objectiveId={addKrForObj || editKr?.objId || ""}
        kr={editKr?.kr}
        users={users}
      />

      <ConfirmDialog
        open={!!deleteKr}
        onClose={() => setDeleteKr(null)}
        onConfirm={handleDeleteKr}
        title="Supprimer le Key Result"
        message={`\u00cates-vous s\u00fbr de vouloir supprimer "${deleteKr?.title}" ?`}
        confirmLabel="Supprimer"
        destructive
        loading={isPending}
      />
    </div>
  );
}
