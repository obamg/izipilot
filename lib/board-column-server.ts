/**
 * Accès base pour les flux de colonnes : résolution du flux d'une équipe,
 * chargement pour le tableau, et placement initial d'une tâche.
 *
 * Règle de résolution (une seule, appliquée partout) :
 *   produit → département → flux par défaut de l'org
 * Le produit l'emporte sur le département parce que c'est déjà l'ordre retenu
 * par lib/sprint-serialize#serializeSprintTask pour l'étiquette d'équipe : une
 * carte affiche le produit quand les deux sont renseignés, elle doit donc
 * suivre le flux du produit.
 */

import type { Prisma, BoardColumnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_COLUMNS,
  sortColumns,
  type BoardColumnDef,
  type BoardWorkflowDef,
} from "@/lib/board-column";

export const boardColumnSelect = {
  id: true,
  label: true,
  color: true,
  category: true,
  sortOrder: true,
  wipLimit: true,
} satisfies Prisma.BoardColumnSelect;

export const boardWorkflowInclude = {
  columns: { orderBy: [{ sortOrder: "asc" as const }, { label: "asc" as const }] },
} satisfies Prisma.BoardWorkflowInclude;

type WorkflowRow = Prisma.BoardWorkflowGetPayload<{
  include: typeof boardWorkflowInclude;
}>;

export function serializeWorkflow(w: WorkflowRow): BoardWorkflowDef {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    isDefault: w.isDefault,
    columns: sortColumns(w.columns).map(
      (c): BoardColumnDef => ({
        id: c.id,
        label: c.label,
        color: c.color,
        category: c.category,
        sortOrder: c.sortOrder,
        wipLimit: c.wipLimit,
      })
    ),
  };
}

/**
 * Le flux par défaut de l'org, créé à la volée s'il n'existe pas — une org née
 * hors du seed (ou dont le flux par défaut aurait été supprimé en base) doit
 * quand même afficher un tableau utilisable.
 */
export async function ensureDefaultWorkflow(orgId: string): Promise<WorkflowRow> {
  const existing = await prisma.boardWorkflow.findFirst({
    where: { orgId, isDefault: true },
    include: boardWorkflowInclude,
  });
  if (existing) return existing;

  return prisma.boardWorkflow.create({
    data: {
      orgId,
      name: "Flux par défaut",
      description: "Colonnes standard appliquées à toute équipe sans flux dédié.",
      isDefault: true,
      columns: {
        create: DEFAULT_COLUMNS.map((c, i) => ({
          orgId,
          label: c.label,
          color: c.color,
          category: c.category,
          sortOrder: i,
        })),
      },
    },
    include: boardWorkflowInclude,
  });
}

/** Tous les flux de l'org (par défaut en tête), colonnes incluses. */
export async function loadWorkflows(orgId: string): Promise<BoardWorkflowDef[]> {
  await ensureDefaultWorkflow(orgId);
  const rows = await prisma.boardWorkflow.findMany({
    where: { orgId },
    include: boardWorkflowInclude,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(serializeWorkflow);
}

/**
 * Quel flux s'applique à quelle équipe. Les clés sont celles du filtre du
 * tableau ("P:<id>" / "D:<id>") pour que le client puisse résoudre le flux à
 * afficher sans aller-retour serveur.
 */
export interface TeamWorkflowMap {
  defaultWorkflowId: string;
  byTeam: Record<string, string>;
}

export async function loadTeamWorkflowMap(orgId: string): Promise<TeamWorkflowMap> {
  const fallback = await ensureDefaultWorkflow(orgId);
  const [products, departments] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, workflowId: { not: null } },
      select: { id: true, workflowId: true },
    }),
    prisma.department.findMany({
      where: { orgId, workflowId: { not: null } },
      select: { id: true, workflowId: true },
    }),
  ]);

  const byTeam: Record<string, string> = {};
  for (const p of products) if (p.workflowId) byTeam[`P:${p.id}`] = p.workflowId;
  for (const d of departments) if (d.workflowId) byTeam[`D:${d.id}`] = d.workflowId;

  return { defaultWorkflowId: fallback.id, byTeam };
}

/** L'id du flux qui s'applique à une tâche, d'après ses étiquettes d'équipe. */
export async function resolveWorkflowId(
  orgId: string,
  team: { departmentId?: string | null; productId?: string | null }
): Promise<string> {
  if (team.productId) {
    const p = await prisma.product.findFirst({
      where: { id: team.productId, orgId },
      select: { workflowId: true },
    });
    if (p?.workflowId) return p.workflowId;
  }
  if (team.departmentId) {
    const d = await prisma.department.findFirst({
      where: { id: team.departmentId, orgId },
      select: { workflowId: true },
    });
    if (d?.workflowId) return d.workflowId;
  }
  const fallback = await ensureDefaultWorkflow(orgId);
  return fallback.id;
}

/**
 * La colonne où déposer une tâche de cette équipe pour une catégorie donnée.
 * Renvoie null si le flux n'a aucune colonne de cette catégorie : l'appelant
 * laisse alors columnId à null et la tâche reste rangée par son statut.
 */
export async function resolveColumnFor(
  orgId: string,
  team: { departmentId?: string | null; productId?: string | null },
  category: BoardColumnCategory
): Promise<string | null> {
  const workflowId = await resolveWorkflowId(orgId, team);
  const column = await prisma.boardColumn.findFirst({
    where: { orgId, workflowId, category },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true },
  });
  return column?.id ?? null;
}

/**
 * Les équipes dont la personne est responsable, sous forme de clés de filtre
 * ("P:<id>" / "D:<id>"). C'est le périmètre d'un PO sur les flux.
 */
export async function ownedTeamKeys(
  orgId: string,
  userId: string
): Promise<string[]> {
  const [products, departments] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, ownerId: userId },
      select: { id: true },
    }),
    prisma.department.findMany({
      where: { orgId, ownerId: userId },
      select: { id: true },
    }),
  ]);
  return [
    ...products.map((p) => `P:${p.id}`),
    ...departments.map((d) => `D:${d.id}`),
  ];
}

/** Les clés d'équipe rattachées à chaque flux — nécessaire pour trancher les droits. */
export async function teamKeysByWorkflow(
  orgId: string
): Promise<Record<string, string[]>> {
  const [products, departments] = await Promise.all([
    prisma.product.findMany({
      where: { orgId, workflowId: { not: null } },
      select: { id: true, workflowId: true },
    }),
    prisma.department.findMany({
      where: { orgId, workflowId: { not: null } },
      select: { id: true, workflowId: true },
    }),
  ]);

  const out: Record<string, string[]> = {};
  const push = (workflowId: string, key: string) => {
    (out[workflowId] ??= []).push(key);
  };
  for (const p of products) if (p.workflowId) push(p.workflowId, `P:${p.id}`);
  for (const d of departments) if (d.workflowId) push(d.workflowId, `D:${d.id}`);
  return out;
}

/** Colonne de départ d'une tâche fraîchement créée (première colonne « À faire »). */
export function resolveInitialColumn(
  orgId: string,
  team: { departmentId?: string | null; productId?: string | null }
): Promise<string | null> {
  return resolveColumnFor(orgId, team, "TODO");
}
