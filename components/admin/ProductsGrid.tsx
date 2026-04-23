"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductFormModal } from "./ProductFormModal";
import { ConfirmDialog } from "./ConfirmDialog";

interface ProductData {
  id: string;
  code: string;
  name: string;
  color: string;
  description: string | null;
  status: string;
  isActive: boolean;
  ownerId: string;
  ownerName: string;
  objectiveCount: number;
}

interface ProductsGridProps {
  products: ProductData[];
  users: { id: string; name: string }[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Actif", color: "var(--green)" },
  IN_DEVELOPMENT: { label: "En dev", color: "var(--teal)" },
  PLANNED: { label: "Planifi\u00e9", color: "var(--gold)" },
  PAUSED: { label: "En pause", color: "var(--gray)" },
};

export function ProductsGrid({ products, users }: ProductsGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductData | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<ProductData | null>(null);

  async function handleDelete() {
    if (!deleteProduct) return;
    try {
      const res = await fetch(`/api/admin/products/${deleteProduct.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || "Erreur");
        return;
      }
      setDeleteProduct(null);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Failed to delete product:", err);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowCreate(true)}
          className="px-[14px] py-[7px] rounded-[7px] text-[11px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors"
        >
          + Nouveau produit
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {products.map((p) => {
          const statusInfo = STATUS_LABELS[p.status] ?? STATUS_LABELS.ACTIVE;
          return (
            <div
              key={p.id}
              className={`bg-white rounded-[10px] border border-[#deeaea] p-4 ${
                !p.isActive ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="font-mono text-[9px] font-semibold px-[6px] py-[2px] rounded-sm text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.code}
                </span>
                <span className="text-[11px] font-medium text-dark flex-1 truncate">
                  {p.name}
                </span>
                <span
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ color: statusInfo.color }}
                >
                  {statusInfo.label}
                </span>
              </div>

              {p.description && (
                <p className="text-[10px] text-izi-gray mb-2 line-clamp-2">
                  {p.description}
                </p>
              )}

              <div className="text-[10px] text-izi-gray mb-3">
                PO: {p.ownerName} &middot; {p.objectiveCount} objectif(s)
              </div>

              <div className="flex gap-1">
                <button
                  onClick={() => setEditProduct(p)}
                  className="px-2 py-1 rounded text-[9px] font-medium text-teal border border-teal-md hover:bg-teal-lt transition-colors"
                >
                  Modifier
                </button>
                {p.isActive && (
                  <button
                    onClick={() => setDeleteProduct(p)}
                    className="px-2 py-1 rounded text-[9px] font-medium text-izi-red border border-izi-red-lt hover:bg-izi-red-lt transition-colors"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {products.length === 0 && (
        <div className="bg-white rounded-[10px] border border-[#deeaea] p-8 text-center">
          <p className="text-sm text-izi-gray">Aucun produit.</p>
        </div>
      )}

      <ProductFormModal
        open={showCreate || !!editProduct}
        onClose={() => {
          setShowCreate(false);
          setEditProduct(null);
        }}
        product={editProduct}
        users={users}
      />

      <ConfirmDialog
        open={!!deleteProduct}
        onClose={() => setDeleteProduct(null)}
        onConfirm={handleDelete}
        title="Supprimer le produit"
        message={`\u00cates-vous s\u00fbr de vouloir supprimer ${deleteProduct?.code} ${deleteProduct?.name} ?`}
        confirmLabel="Supprimer"
        destructive
        loading={isPending}
      />
    </div>
  );
}
