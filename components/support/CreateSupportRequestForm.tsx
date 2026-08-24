"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SupportRequestCategory, SupportRequestPriority } from "@prisma/client";
import { createSupportRequest } from "@/app/(dashboard)/support/actions";
import { SUPPORT_CATEGORY_META, SUPPORT_PRIORITY_META } from "@/lib/support-request";

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

const CATEGORIES = Object.keys(SUPPORT_CATEGORY_META) as SupportRequestCategory[];
const PRIORITIES = Object.keys(SUPPORT_PRIORITY_META) as SupportRequestPriority[];

export function CreateSupportRequestForm({
  departments,
}: {
  departments: DepartmentOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [category, setCategory] = useState<SupportRequestCategory>("INCIDENT");
  const [priority, setPriority] = useState<SupportRequestPriority>("NORMAL");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (departments.length === 0) {
    return (
      <div className="rounded-[10px] border border-border-soft bg-white p-4 text-[13px] text-izi-gray">
        Aucun guichet n&apos;est ouvert aux demandes pour l&apos;instant.
      </div>
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createSupportRequest({
        departmentId,
        category,
        priority,
        title,
        description,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/support/${res.data.id}`);
    });
  }

  const field =
    "w-full rounded-[8px] border border-border-soft bg-white px-3 py-2 text-[15px] text-dark focus:outline-none focus:border-teal";
  const label = "block text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray mb-1";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[10px] border border-dashed border-teal-md bg-teal-lt px-4 py-3 text-[14px] font-medium text-teal-dk hover:bg-white transition-colors"
      >
        + Nouvelle demande
      </button>
    );
  }

  return (
    <div className="rounded-[10px] border border-border-soft bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-izi-gray">
          Nouvelle demande
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-izi-gray hover:text-dark"
        >
          Annuler
        </button>
      </div>

      {/* Single-column : les collègues déposent souvent depuis leur téléphone. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Guichet</span>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className={field}
            aria-label="Département destinataire"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={label}>Type de demande</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportRequestCategory)}
            className={field}
            aria-label="Type de demande"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SUPPORT_CATEGORY_META[c].label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-izi-gray">
            {SUPPORT_CATEGORY_META[category].hint}
          </span>
        </label>
      </div>

      <label className="block">
        <span className={label}>Objet</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          placeholder="Ex : Impossible de me connecter au VPN"
          className={field}
        />
      </label>

      <label className="block">
        <span className={label}>Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="Ce qui se passe, depuis quand, ce que vous avez déjà essayé, le message d'erreur exact…"
          className={`${field} resize-y`}
        />
      </label>

      <div>
        <span className={label}>Priorité</span>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => {
            const meta = SUPPORT_PRIORITY_META[p];
            const active = priority === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                aria-pressed={active}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors ${
                  active ? "border-transparent" : "border-border-soft bg-white text-izi-gray"
                }`}
                style={active ? { color: meta.color, backgroundColor: meta.bg } : undefined}
              >
                {meta.label}
                <span className="ml-1 font-normal opacity-70">· {meta.slaHours} h</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-izi-gray">
          L&apos;échéance de traitement découle de la priorité choisie.
        </p>
      </div>

      {error && <p className="text-[12px] text-red">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending || title.trim().length < 4 || description.trim().length < 10}
        className="w-full rounded-[8px] bg-teal px-4 py-2.5 text-[14px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50"
      >
        {pending ? "Envoi…" : "Envoyer la demande"}
      </button>
    </div>
  );
}
