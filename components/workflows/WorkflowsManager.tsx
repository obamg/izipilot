"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BoardColumnCategory } from "@prisma/client";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/board-column";
import {
  assignTeamWorkflow,
  createColumn,
  createWorkflow,
  deleteColumn,
  deleteWorkflow,
  reorderColumns,
  updateColumn,
  updateWorkflow,
} from "@/app/(dashboard)/workflows/actions";

export interface AdminColumn {
  id: string;
  label: string;
  color: string;
  category: BoardColumnCategory;
  sortOrder: number;
  wipLimit: number | null;
  taskCount: number;
}

export interface AdminWorkflow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdByName: string | null;
  /** Droits résolus côté serveur — le client ne les recalcule jamais. */
  canEdit: boolean;
  canDelete: boolean;
  /** Pourquoi ce flux est en lecture seule, à afficher tel quel. */
  lockedReason: string | null;
  columns: AdminColumn[];
}

export interface AdminTeam {
  key: string;
  kind: "Produit" | "Département";
  code: string;
  name: string;
  color: string;
  workflowId: string | null;
}

interface Props {
  workflows: AdminWorkflow[];
  teams: AdminTeam[];
  canCreate: boolean;
  /** CEO / management : voit et pilote tout. Sinon, périmètre limité. */
  isFullAccess: boolean;
}

const INPUT =
  "rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] text-dark focus:outline-none focus:border-teal";
const BTN =
  "rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-[12px] font-medium text-dark hover:border-teal transition-colors disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-[7px] bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal-dk transition-colors disabled:opacity-50";

const SWATCHES = [
  "#5f6e7a",
  "#185FA5",
  "#008081",
  "#1d9e75",
  "#f4a900",
  "#e23c4a",
  "#534AB7",
  "#D85A30",
];

export function WorkflowsManager({
  workflows,
  teams,
  canCreate,
  isFullAccess,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  /** Toute mutation passe par ici : une seule place pour l'erreur et le refresh. */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Échec de l'opération");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-[8px] border border-[#e23c4a] bg-[#fceaea] px-3 py-2 text-[12px] text-[#e23c4a]"
        >
          {error}
        </div>
      )}

      <section className="rounded-[10px] border border-border-soft bg-teal-lt/40 px-4 py-3">
        <p className="text-[12px] leading-relaxed text-dark">
          Chaque colonne porte un <strong>libellé libre</strong> et une{" "}
          <strong>catégorie</strong>. Le libellé est ce que voit l&apos;équipe ; la
          catégorie est ce que lisent le burndown, la vélocité, le report au sprint
          suivant et l&apos;évaluation. Vous pouvez donc créer « En revue » ou
          « Chez le client » sans jamais fausser une statistique.
        </p>
        {!isFullAccess && (
          <p className="mt-2 text-[11px] leading-relaxed text-izi-gray">
            Vous pilotez les flux de vos équipes. Un flux partagé avec une équipe que
            vous ne pilotez pas reste visible mais verrouillé — le modifier changerait
            le tableau de quelqu&apos;un d&apos;autre.
          </p>
        )}
      </section>

      {/* ── Flux ─────────────────────────────────────────────────────────── */}
      {workflows.map((wf) => (
        <WorkflowCard
          key={wf.id}
          workflow={wf}
          teams={teams.filter((t) => t.workflowId === wf.id)}
          pending={pending}
          run={run}
        />
      ))}

      {canCreate && (
        <section className="rounded-[10px] border border-dashed border-border-soft bg-white px-4 py-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
            Nouveau flux
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex : Flux IT"
              aria-label="Nom du nouveau flux"
              className={`${INPUT} min-w-[200px] flex-1`}
            />
            <button
              type="button"
              disabled={pending || newName.trim().length < 2}
              className={BTN_PRIMARY}
              onClick={() =>
                run(async () => {
                  const res = await createWorkflow(newName, null);
                  if (res.ok) setNewName("");
                  return res;
                })
              }
            >
              Créer
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-izi-gray">
            Le nouveau flux démarre avec les cinq colonnes standard — personnalisez-le
            ensuite, puis rattachez-y vos équipes.
          </p>
        </section>
      )}

      {/* ── Affectation des équipes ──────────────────────────────────────── */}
      <section className="rounded-[10px] border border-border-soft bg-white px-4 py-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
          {isFullAccess ? "Flux par équipe" : "Mes équipes"}
        </h3>
        <p className="mb-3 text-[11px] text-izi-gray">
          Les tâches en cours sont replacées dans la colonne équivalente du nouveau
          flux — un changement ne fait jamais reculer une tâche.
        </p>
        {teams.length === 0 && (
          <p className="text-[12px] italic text-izi-gray">
            Vous ne pilotez aucun produit ni département pour l&apos;instant.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {teams.map((team) => (
            <div
              key={team.key}
              className="flex items-center gap-2 rounded-[8px] border border-border-soft px-2.5 py-2"
            >
              <span
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                style={{ color: team.color, backgroundColor: `${team.color}1a` }}
              >
                {team.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-dark" title={team.name}>
                {team.name}
              </span>
              <select
                value={team.workflowId ?? ""}
                disabled={pending}
                aria-label={`Flux de ${team.name}`}
                className={`${INPUT} max-w-[150px]`}
                onChange={(e) =>
                  run(() => assignTeamWorkflow(team.key, e.target.value || null))
                }
              >
                <option value="">Flux par défaut</option>
                {workflows
                  .filter((w) => !w.isDefault)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Carte d'un flux ──────────────────────────────────────────────────────────

interface WorkflowCardProps {
  workflow: AdminWorkflow;
  teams: AdminTeam[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}

function WorkflowCard({ workflow, teams, pending, run }: WorkflowCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [adding, setAdding] = useState(false);

  const ids = workflow.columns.map((c) => c.id);

  function move(index: number, delta: number) {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() => reorderColumns(workflow.id, next));
  }

  return (
    <section className="rounded-[10px] border border-border-soft bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft px-4 py-3">
        <div className="flex items-center gap-2">
          {renaming ? (
            <>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Nom du flux"
                className={INPUT}
              />
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await updateWorkflow(workflow.id, name, workflow.description);
                    if (res.ok) setRenaming(false);
                    return res;
                  })
                }
              >
                Enregistrer
              </button>
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  setName(workflow.name);
                  setRenaming(false);
                }}
              >
                Annuler
              </button>
            </>
          ) : (
            <>
              <h2 className="font-serif text-[16px] text-dark">{workflow.name}</h2>
              {workflow.isDefault && (
                <span className="rounded bg-teal-lt px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-teal-dk">
                  par défaut
                </span>
              )}
              {!workflow.canEdit && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-izi-gray-lt px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-izi-gray"
                  title={workflow.lockedReason ?? undefined}
                >
                  <span aria-hidden>🔒</span> lecture seule
                </span>
              )}
            </>
          )}
        </div>
        {!renaming && workflow.canEdit && (
          <div className="flex items-center gap-2">
            <button type="button" className={BTN} onClick={() => setRenaming(true)}>
              Renommer
            </button>
            {workflow.canDelete && (
              <button
                type="button"
                className={`${BTN} text-[var(--red)]`}
                disabled={pending}
                onClick={() => run(() => deleteWorkflow(workflow.id))}
              >
                Supprimer
              </button>
            )}
          </div>
        )}
      </header>

      {workflow.lockedReason && (
        <p className="border-b border-border-soft bg-izi-gray-lt/50 px-4 py-2 text-[11px] leading-snug text-izi-gray">
          {workflow.lockedReason}
        </p>
      )}

      <div className="px-4 py-3">
        <p className="mb-2 text-[11px] text-izi-gray">
          {teams.length > 0 ? (
            <>Utilisé par {teams.map((t) => t.code).join(", ")}</>
          ) : workflow.isDefault ? (
            <>Appliqué à toute équipe sans flux dédié</>
          ) : (
            <>
              Aucune équipe rattachée pour l&apos;instant
              {workflow.createdByName && <> · créé par {workflow.createdByName}</>}
            </>
          )}
        </p>

        <ul className="space-y-1.5">
          {workflow.columns.map((col, i) => (
            <ColumnRow
              key={col.id}
              column={col}
              siblings={workflow.columns}
              index={i}
              total={workflow.columns.length}
              pending={pending}
              editable={workflow.canEdit}
              run={run}
              onMove={move}
            />
          ))}
        </ul>

        {workflow.canEdit &&
          (adding ? (
            <ColumnForm
              pending={pending}
              onCancel={() => setAdding(false)}
              onSubmit={(input) =>
                run(async () => {
                  const res = await createColumn(workflow.id, input);
                  if (res.ok) setAdding(false);
                  return res;
                })
              }
            />
          ) : (
            <button
              type="button"
              className={`${BTN} mt-2`}
              onClick={() => setAdding(true)}
              disabled={workflow.columns.length >= 12}
            >
              + Ajouter une colonne
            </button>
          ))}
      </div>
    </section>
  );
}

// ── Ligne de colonne ─────────────────────────────────────────────────────────

interface ColumnRowProps {
  column: AdminColumn;
  siblings: AdminColumn[];
  index: number;
  total: number;
  pending: boolean;
  /** Faux sur un flux verrouillé : la ligne reste lisible, sans action. */
  editable: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  onMove: (index: number, delta: number) => void;
}

function ColumnRow({
  column,
  siblings,
  index,
  total,
  pending,
  editable,
  run,
  onMove,
}: ColumnRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [moveTo, setMoveTo] = useState(
    siblings.find((c) => c.id !== column.id)?.id ?? ""
  );

  if (editing) {
    return (
      <li>
        <ColumnForm
          initial={column}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(input) =>
            run(async () => {
              const res = await updateColumn(column.id, input);
              if (res.ok) setEditing(false);
              return res;
            })
          }
        />
      </li>
    );
  }

  return (
    <li className="rounded-[8px] border border-border-soft px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: column.color }}
          aria-hidden
        />
        <span className="text-[13px] font-medium text-dark">{column.label}</span>
        <span
          className="rounded bg-izi-gray-lt px-1.5 py-0.5 text-[10px] text-izi-gray"
          title={CATEGORY_META[column.category].hint}
        >
          {CATEGORY_META[column.category].label}
        </span>
        {column.wipLimit && (
          <span className="font-mono text-[10px] text-izi-gray" title="Limite d'encours">
            max {column.wipLimit}
          </span>
        )}
        <span className="font-mono text-[10px] text-izi-gray">
          {column.taskCount} tâche{column.taskCount > 1 ? "s" : ""}
        </span>

        {editable && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={`${BTN} px-2`}
              aria-label={`Monter ${column.label}`}
              disabled={pending || index === 0}
              onClick={() => onMove(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={`${BTN} px-2`}
              aria-label={`Descendre ${column.label}`}
              disabled={pending || index === total - 1}
              onClick={() => onMove(index, 1)}
            >
              ↓
            </button>
            <button type="button" className={BTN} onClick={() => setEditing(true)}>
              Modifier
            </button>
            <button
              type="button"
              className={`${BTN} text-[var(--red)]`}
              disabled={total <= 1}
              onClick={() => setConfirming((v) => !v)}
            >
              Supprimer
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border-soft pt-2">
          <span className="text-[11px] text-izi-gray">
            Déplacer les {column.taskCount} tâche{column.taskCount > 1 ? "s" : ""} vers
          </span>
          <select
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            aria-label="Colonne de destination"
            className={INPUT}
          >
            {siblings
              .filter((c) => c.id !== column.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={pending || !moveTo}
            onClick={() =>
              run(async () => {
                const res = await deleteColumn(column.id, moveTo);
                if (res.ok) setConfirming(false);
                return res;
              })
            }
          >
            Confirmer
          </button>
          <button type="button" className={BTN} onClick={() => setConfirming(false)}>
            Annuler
          </button>
        </div>
      )}
    </li>
  );
}

// ── Formulaire de colonne (création et édition) ──────────────────────────────

interface ColumnFormValue {
  label: string;
  color: string;
  category: string;
  wipLimit: number | null;
}

interface ColumnFormProps {
  initial?: AdminColumn;
  pending: boolean;
  onSubmit: (value: ColumnFormValue) => void;
  onCancel: () => void;
}

function ColumnForm({ initial, pending, onSubmit, onCancel }: ColumnFormProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]);
  const [category, setCategory] = useState<string>(initial?.category ?? "IN_PROGRESS");
  const [wipLimit, setWipLimit] = useState<string>(
    initial?.wipLimit ? String(initial.wipLimit) : ""
  );

  const categoryHint = CATEGORY_META[category as BoardColumnCategory]?.hint;

  return (
    <div className="mt-2 rounded-[8px] border border-teal-md bg-teal-lt/30 px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
            Libellé
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex : En revue"
            className={`${INPUT} w-[160px]`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
            Catégorie
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={INPUT}
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
            Limite (optionnel)
          </span>
          <input
            type="number"
            min={0}
            value={wipLimit}
            onChange={(e) => setWipLimit(e.target.value)}
            placeholder="—"
            className={`${INPUT} w-[90px]`}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-izi-gray">
            Couleur
          </span>
          <div className="flex items-center gap-1">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Couleur ${s}`}
                aria-pressed={color === s}
                onClick={() => setColor(s)}
                className={`h-5 w-5 rounded-full border-2 transition-transform ${
                  color === s ? "border-dark scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: s }}
              />
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={pending || label.trim().length < 1}
            onClick={() =>
              onSubmit({
                label,
                color,
                category,
                wipLimit: wipLimit ? Number(wipLimit) : null,
              })
            }
          >
            {initial ? "Enregistrer" : "Ajouter"}
          </button>
          <button type="button" className={BTN} onClick={onCancel}>
            Annuler
          </button>
        </div>
      </div>

      {categoryHint && (
        <p className="mt-2 text-[11px] leading-snug text-izi-gray">{categoryHint}</p>
      )}
    </div>
  );
}
