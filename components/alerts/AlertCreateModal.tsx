"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AlertType, AlertSeverity } from "@prisma/client";

interface Props {
  krId: string;
  krTitle: string;
  onClose: () => void;
}

const TYPES: { value: AlertType; label: string }[] = [
  { value: "KR_BLOCKED", label: "KR bloqu\u00e9" },
  { value: "KR_DECLINING", label: "KR en baisse" },
  { value: "ENTRY_MISSING", label: "Revue manquante" },
  { value: "ESCALATION_48H", label: "Escalade 48h" },
  { value: "SCORE_BELOW_40", label: "Score < 40%" },
];

const SEVERITIES: { value: AlertSeverity; label: string }[] = [
  { value: "LOW", label: "Basse" },
  { value: "MEDIUM", label: "Moyenne" },
  { value: "HIGH", label: "Haute" },
  { value: "CRITICAL", label: "Critique" },
];

export function AlertCreateModal({ krId, krTitle, onClose }: Props) {
  const router = useRouter();
  const [type, setType] = useState<AlertType>("KR_BLOCKED");
  const [severity, setSeverity] = useState<AlertSeverity>("HIGH");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ krId, type, severity, message: message.trim() }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Erreur lors de la cr\u00e9ation");
        setSubmitting(false);
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError("Erreur r\u00e9seau");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border border-[#deeaea] p-5 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-lg text-dark mb-1">Soulever une alerte</h2>
        <p className="text-[11px] text-izi-gray mb-4 truncate">
          KR: <span className="text-dark font-medium">{krTitle}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-izi-gray font-semibold mb-1">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AlertType)}
              className="w-full px-[9px] py-[7px] border border-[#deeaea] rounded-[7px] text-[12px] text-dark font-sans bg-white"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-izi-gray font-semibold mb-1">
              S&eacute;v&eacute;rit&eacute;
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
              className="w-full px-[9px] py-[7px] border border-[#deeaea] rounded-[7px] text-[12px] text-dark font-sans bg-white"
            >
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-izi-gray font-semibold mb-1">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="D&eacute;crivez la situation et le besoin..."
              required
              minLength={3}
              maxLength={500}
              className="w-full px-[9px] py-[7px] border border-[#deeaea] rounded-[7px] text-[12px] text-dark font-sans resize-none h-[90px] leading-relaxed"
            />
          </div>

          {error && (
            <div className="text-[11px] text-red bg-red-lt rounded-md px-2 py-1.5">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={!message.trim() || submitting}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-teal text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
            >
              {submitting ? "Cr\u00e9ation..." : "Cr\u00e9er l'alerte"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium text-izi-gray hover:bg-izi-gray-lt transition-colors"
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
