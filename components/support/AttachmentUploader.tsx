"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENT_BYTES, formatBytes } from "@/lib/attachments";

/**
 * Upload d'une pièce jointe en multipart vers l'API. Les mêmes règles (type,
 * taille) sont revérifiées côté serveur — ce contrôle-ci n'est là que pour
 * éviter un aller-retour inutile sur une connexion lente.
 */
export function AttachmentUploader({
  requestId,
  disabled = false,
}: {
  requestId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`Fichier trop lourd (max ${formatBytes(MAX_ATTACHMENT_BYTES)})`);
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/support-requests/${requestId}/attachments`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Échec de l'envoi");
        return;
      }
      router.refresh();
    } catch {
      setError("Échec de l'envoi — vérifiez votre connexion");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="block w-full text-[12px] text-izi-gray file:mr-3 file:rounded-[8px] file:border-0 file:bg-teal-lt file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-teal-dk hover:file:bg-teal-md disabled:opacity-50"
        aria-label="Ajouter une pièce jointe"
      />
      <p className="mt-1 text-[11px] text-izi-gray">
        Images, PDF, Word, Excel, CSV ou texte · {formatBytes(MAX_ATTACHMENT_BYTES)} max
      </p>
      {uploading && <p className="mt-1 text-[12px] text-teal-dk">Envoi en cours…</p>}
      {error && <p className="mt-1 text-[12px] text-red">{error}</p>}
    </div>
  );
}
