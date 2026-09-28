"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AssetFormModal } from "./AssetFormModal";
import { AssetLevelsPanel } from "./AssetLevelsPanel";

interface LevelDTO {
  id: string;
  assetId: string;
  name: string;
  priority: number | null;
  isAdmin: boolean | null;
  enabled: boolean;
  archivedAt: string | null;
}

interface AssetDTO {
  id: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  backupOwnerId: string | null;
  backupOwnerName: string | null;
  requestsEnabled: boolean;
  readyForRequests: boolean;
  catalogueVersion: number;
  archivedAt: string | null;
  levels: LevelDTO[];
}

interface AssetsTableProps {
  assets: AssetDTO[];
  users: { id: string; name: string }[];
}

export function AssetsTable({ assets, users }: AssetsTableProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-[7px] bg-teal px-3 py-1.5 text-[11px] font-medium text-white hover:bg-teal-dk transition-colors"
        >
          Nouvel actif
        </button>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border-soft p-10 text-center text-[13px] text-izi-gray">
          Aucune application au catalogue pour l&apos;instant.
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-[10px] border border-border-soft bg-white">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <span className="text-[13px] font-medium text-dark">{asset.name}</span>
                  {asset.archivedAt && (
                    <span className="ml-2 rounded-full bg-izi-gray-lt px-1.5 py-0.5 text-[9px] font-semibold text-izi-gray">
                      Archivé
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-izi-gray">
                  <span>Propriétaire : {asset.ownerName ?? "—"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      asset.readyForRequests
                        ? "bg-izi-green-lt text-izi-green"
                        : "bg-izi-gray-lt text-izi-gray"
                    }`}
                  >
                    {asset.readyForRequests ? "Prêt aux demandes" : "Incomplet"}
                  </span>
                </div>
              </button>
              {expandedId === asset.id && (
                <div className="border-t border-border-soft px-4 py-3">
                  <AssetLevelsPanel asset={asset} onChanged={() => router.refresh()} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AssetFormModal open={modalOpen} onClose={() => setModalOpen(false)} users={users} />
    </div>
  );
}
