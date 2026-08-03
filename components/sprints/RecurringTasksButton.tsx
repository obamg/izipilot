"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActionPriority, RecurrenceFrequency, UserRole } from "@prisma/client";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { canManageRecurring } from "@/lib/recurring-task";
import type {
  RecurringTaskItem,
  UserOption,
  TeamOption,
  KrOption,
} from "./types";

interface Props {
  initialTemplates: RecurringTaskItem[];
  users: UserOption[];
  products: TeamOption[];
  departments: TeamOption[];
  krs: KrOption[];
  currentUserId: string;
  currentUserRole: UserRole;
}

const PRIORITY_OPTIONS: { value: ActionPriority; label: string }[] = [
  { value: "LOW", label: "Basse" },
  { value: "MEDIUM", label: "Moyenne" },
  { value: "HIGH", label: "Haute" },
  { value: "URGENT", label: "Urgente" },
];

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: "DAILY", label: "Quotidienne" },
  { value: "WEEKLY", label: "Hebdomadaire" },
  { value: "MONTHLY", label: "Mensuelle" },
  { value: "PER_SPRINT", label: "Par sprint" },
];

// Monday-first for the picker; value is the JS getUTCDay index (0=dim..6=sam).
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RecurringTasksButton({
  initialTemplates,
  users,
  products,
  departments,
  krs,
  currentUserId,
  currentUserRole,
}: Props) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<RecurringTaskItem[]>(initialTemplates);

  if (!canManageRecurring(currentUserRole)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[7px] border border-border-soft bg-white px-3.5 py-2 text-[13px] font-medium text-dark hover:border-teal-md hover:text-teal transition-colors"
      >
        ↻ Tâches récurrentes
        {templates.length > 0 && (
          <span className="ml-1.5 font-mono text-[11px] text-izi-gray">
            {templates.length}
          </span>
        )}
      </button>
      {open && (
        <ManagerModal
          templates={templates}
          setTemplates={setTemplates}
          users={users}
          products={products}
          departments={departments}
          krs={krs}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ManagerProps extends Omit<Props, "initialTemplates"> {
  templates: RecurringTaskItem[];
  setTemplates: React.Dispatch<React.SetStateAction<RecurringTaskItem[]>>;
  onClose: () => void;
}

function ManagerModal({
  templates,
  setTemplates,
  users,
  products,
  departments,
  krs,
  currentUserId,
  currentUserRole,
  onClose,
}: ManagerProps) {
  // null = list view; "new" = create form; otherwise the id being edited.
  const [view, setView] = useState<"list" | "new" | string>("list");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggleActive(t: RecurringTaskItem) {
    setBusyId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/recurring-tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de la mise à jour");
        return;
      }
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? data.data : x)));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: RecurringTaskItem) {
    if (!confirm(`Supprimer la tâche récurrente « ${t.title} » ?`)) return;
    setBusyId(t.id);
    setError(null);
    try {
      const res = await fetch(`/api/recurring-tasks/${t.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Échec de la suppression");
        return;
      }
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } finally {
      setBusyId(null);
    }
  }

  const editing =
    view !== "list" && view !== "new"
      ? templates.find((t) => t.id === view) ?? null
      : null;

  const canDelete = (t: RecurringTaskItem) =>
    currentUserRole === "CEO" ||
    currentUserRole === "MANAGEMENT" ||
    t.createdById === currentUserId;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Tâches récurrentes"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-lg text-dark">Tâches récurrentes</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-[18px] leading-none text-izi-gray hover:text-dark"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">
            {error}
          </div>
        )}

        {view === "list" ? (
          <>
            <p className="text-[12px] text-izi-gray mb-3">
              Chaque modèle crée automatiquement une tâche dans le sprint actif
              (ou le backlog) à l&apos;échéance choisie.
            </p>

            {templates.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-border-soft p-8 text-center text-[13px] text-izi-gray">
                Aucune tâche récurrente pour le moment.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className={`rounded-[10px] border border-border-soft bg-white p-3 ${
                      t.isActive ? "" : "opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {t.team && (
                            <span
                              className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded"
                              style={{
                                color: t.team.color,
                                backgroundColor: `${t.team.color}1a`,
                              }}
                              title={t.team.name}
                            >
                              {t.team.code}
                            </span>
                          )}
                          <span className="text-[13px] font-medium text-dark truncate">
                            {t.title}
                          </span>
                          {!t.isActive && (
                            <span className="rounded-full bg-izi-gray-lt px-1.5 py-0.5 text-[9px] font-semibold text-izi-gray">
                              En pause
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-izi-gray">
                          <span className="font-medium text-dark">{t.cadenceLabel}</span>
                          {t.nextRunAt
                            ? ` · prochaine : ${fmtDate(t.nextRunAt)}`
                            : " · au démarrage du sprint"}
                          {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleActive(t)}
                          disabled={busyId === t.id}
                          className="text-[11px] font-medium text-izi-gray hover:text-teal disabled:opacity-50"
                        >
                          {t.isActive ? "Mettre en pause" : "Reprendre"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setView(t.id)}
                          className="text-[11px] font-medium text-izi-gray hover:text-teal"
                        >
                          Modifier
                        </button>
                        {canDelete(t) && (
                          <button
                            type="button"
                            onClick={() => remove(t)}
                            disabled={busyId === t.id}
                            aria-label={`Supprimer ${t.title}`}
                            className="text-[13px] leading-none text-izi-gray hover:text-red disabled:opacity-50"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => { setError(null); setView("new"); }}
                className="rounded-[7px] bg-teal px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-dk transition-colors"
              >
                + Nouvelle tâche récurrente
              </button>
            </div>
          </>
        ) : (
          <RecurringForm
            template={editing}
            users={users}
            products={products}
            departments={departments}
            krs={krs}
            onCancel={() => { setError(null); setView("list"); }}
            onSaved={(saved, isNew) => {
              setTemplates((prev) =>
                isNew ? [saved, ...prev] : prev.map((x) => (x.id === saved.id ? saved : x))
              );
              setView("list");
            }}
          />
        )}
      </div>
    </div>
  );
}

interface FormProps {
  template: RecurringTaskItem | null;
  users: UserOption[];
  products: TeamOption[];
  departments: TeamOption[];
  krs: KrOption[];
  onCancel: () => void;
  onSaved: (saved: RecurringTaskItem, isNew: boolean) => void;
}

function teamValueOf(t: RecurringTaskItem | null): string {
  if (t?.productId) return `P:${t.productId}`;
  if (t?.departmentId) return `D:${t.departmentId}`;
  return "";
}

function RecurringForm({
  template,
  users,
  products,
  departments,
  krs,
  onCancel,
  onSaved,
}: FormProps) {
  const isEdit = Boolean(template);
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [team, setTeam] = useState(teamValueOf(template));
  const [krId, setKrId] = useState(template?.krId ?? "");
  const [assigneeId, setAssigneeId] = useState(template?.assigneeId ?? "");
  const [priority, setPriority] = useState<ActionPriority>(template?.priority ?? "MEDIUM");
  const [storyPoints, setStoryPoints] = useState(
    template?.storyPoints != null ? String(template.storyPoints) : ""
  );
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    template?.frequency ?? "WEEKLY"
  );
  const [weekday, setWeekday] = useState<number>(template?.weekday ?? 1);
  const [monthDay, setMonthDay] = useState<number>(template?.monthDay ?? 1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamOptions = useMemo(
    () => [
      {
        label: "Produits",
        options: products.map((p) => ({
          value: `P:${p.id}`,
          label: `${p.code} — ${p.name}`,
          searchHaystack: p.code,
        })),
      },
      {
        label: "Départements",
        options: departments.map((d) => ({
          value: `D:${d.id}`,
          label: `${d.code} — ${d.name}`,
          searchHaystack: d.code,
        })),
      },
    ],
    [products, departments]
  );

  const krGroups = useMemo(() => {
    const grouped = new Map<string, { entity: string; krs: KrOption[] }>();
    for (const kr of krs) {
      const key = kr.entityCode || "—";
      if (!grouped.has(key))
        grouped.set(key, { entity: `${kr.entityCode} — ${kr.entityName}`, krs: [] });
      grouped.get(key)!.krs.push(kr);
    }
    return Array.from(grouped.values()).map((g) => ({
      label: g.entity,
      options: g.krs.map((kr) => ({
        value: kr.id,
        label: kr.title,
        searchHaystack: g.entity,
      })),
    }));
  }, [krs]);

  function teamFields() {
    if (team.startsWith("P:")) return { productId: team.slice(2), departmentId: null };
    if (team.startsWith("D:")) return { departmentId: team.slice(2), productId: null };
    return { productId: null, departmentId: null };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setIsSaving(true);
    try {
      const { productId, departmentId } = teamFields();
      const points = storyPoints.trim() === "" ? null : Number(storyPoints);
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        productId,
        departmentId,
        krId: krId || null,
        assigneeId: assigneeId || null,
        priority,
        storyPoints: points != null && Number.isFinite(points) ? points : null,
        frequency,
        weekday: frequency === "WEEKLY" ? weekday : null,
        monthDay: frequency === "MONTHLY" ? monthDay : null,
      };

      const res = await fetch(
        isEdit ? `/api/recurring-tasks/${template!.id}` : "/api/recurring-tasks",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erreur lors de l'enregistrement");
        return;
      }
      onSaved(data.data, !isEdit);
    } finally {
      setIsSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[13px] text-dark focus:outline-none focus:border-teal";
  const labelCls = "block text-[11px] font-semibold text-izi-gray mb-1";

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <h3 className="font-serif text-[15px] text-dark">
        {isEdit ? "Modifier la tâche récurrente" : "Nouvelle tâche récurrente"}
      </h3>

      <div>
        <label className={labelCls}>Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={2}
          maxLength={200}
          autoFocus
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={2000}
          className={`${inputCls} resize-none`}
        />
      </div>

      {/* Recurrence */}
      <div className="rounded-[8px] border border-border-soft bg-izi-gray-lt/30 p-3 space-y-2">
        <span className={labelCls}>Récurrence</span>
        <div className="flex flex-wrap gap-2">
          {FREQUENCY_OPTIONS.map((o) => (
            <button
              type="button"
              key={o.value}
              onClick={() => setFrequency(o.value)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium border transition-colors ${
                frequency === o.value
                  ? "border-teal bg-teal text-white"
                  : "border-border-soft bg-white text-dark hover:border-teal-md"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {frequency === "WEEKLY" && (
          <div>
            <label className={labelCls}>Chaque</label>
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              aria-label="Jour de la semaine"
              className={inputCls}
            >
              {WEEKDAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        {frequency === "MONTHLY" && (
          <div>
            <label className={labelCls}>Le (jour du mois, 1–28)</label>
            <select
              value={monthDay}
              onChange={(e) => setMonthDay(Number(e.target.value))}
              aria-label="Jour du mois"
              className={inputCls}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}
        {frequency === "DAILY" && (
          <p className="text-[11px] text-izi-gray">Une tâche sera créée chaque jour.</p>
        )}
        {frequency === "PER_SPRINT" && (
          <p className="text-[11px] text-izi-gray">
            Une tâche sera créée au démarrage de chaque sprint (et tout de suite
            dans le sprint actif, s&apos;il y en a un).
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Responsable</label>
          <SearchableSelect
            value={assigneeId || "NONE"}
            onChange={(v) => setAssigneeId(v === "NONE" ? "" : v)}
            ariaLabel="Responsable"
            allOption={{ value: "NONE", label: "Non assignée" }}
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            className="w-full"
          />
        </div>
        <div>
          <label className={labelCls}>Équipe</label>
          <SearchableSelect
            value={team || "NONE"}
            onChange={(v) => setTeam(v === "NONE" ? "" : v)}
            ariaLabel="Équipe"
            allOption={{ value: "NONE", label: "Aucune équipe" }}
            options={teamOptions}
            className="w-full"
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Key Result lié (optionnel)</label>
        <SearchableSelect
          value={krId || "NONE"}
          onChange={(v) => setKrId(v === "NONE" ? "" : v)}
          ariaLabel="Key Result lié"
          allOption={{ value: "NONE", label: "Aucun KR" }}
          options={krGroups}
          className="w-full"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Priorité</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as ActionPriority)}
            className={inputCls}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Points</label>
          <input
            type="number"
            min={0}
            max={1000}
            value={storyPoints}
            onChange={(e) => setStoryPoints(e.target.value)}
            placeholder="—"
            className={inputCls}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-[7px] bg-red-lt border border-red/30 px-3 py-2 text-[12px] text-red">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-izi-gray border border-border-soft bg-white hover:bg-gray-lt transition-colors"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={isSaving || !title.trim()}
          className="px-3 py-1.5 rounded-[7px] text-[12px] font-medium text-white bg-teal hover:bg-teal-dk transition-colors disabled:opacity-50"
        >
          {isSaving ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer"}
        </button>
      </div>
    </form>
  );
}
