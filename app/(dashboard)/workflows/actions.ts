"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type BoardColumnCategory } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CATEGORY_ORDER,
  DEFAULT_COLUMNS,
  checkRequiredCategories,
} from "@/lib/board-column";
import { ownedTeamKeys, teamKeysByWorkflow } from "@/lib/board-column-server";
import {
  canAssignTeam,
  canCreateWorkflow,
  canDeleteWorkflow,
  canEditWorkflow,
  canViewWorkflows,
  type WorkflowViewer,
} from "@/lib/workflow-access";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * Le viewer et son périmètre d'équipes. CEO / management passent partout ; un
 * PO n'agit que sur les flux de ses propres équipes (voir lib/workflow-access).
 * Revérifié ici car une Server Action est appelable directement, sans passer
 * par la page.
 */
async function requireViewer(): Promise<
  { ok: true; viewer: WorkflowViewer; orgId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Non authentifié" };
  if (!canViewWorkflows(session.user.role)) {
    return { ok: false, error: "Accès refusé" };
  }
  const orgId = session.user.orgId;
  return {
    ok: true,
    orgId,
    viewer: {
      id: session.user.id,
      role: session.user.role,
      ownedTeamKeys: await ownedTeamKeys(orgId, session.user.id),
    },
  };
}

/**
 * Charge un flux et vérifie que le viewer a le droit de le modifier. Toutes les
 * mutations de flux et de colonnes passent par là — un seul endroit à auditer.
 */
async function requireEditableWorkflow(
  viewer: WorkflowViewer,
  orgId: string,
  workflowId: string
): Promise<{ ok: true; isDefault: boolean } | { ok: false; error: string }> {
  const wf = await prisma.boardWorkflow.findFirst({
    where: { id: workflowId, orgId },
    select: { id: true, isDefault: true, createdById: true },
  });
  if (!wf) return { ok: false, error: "Flux introuvable" };

  const byWorkflow = await teamKeysByWorkflow(orgId);
  const allowed = canEditWorkflow(viewer, {
    isDefault: wf.isDefault,
    createdById: wf.createdById,
    teamKeys: byWorkflow[wf.id] ?? [],
  });
  if (!allowed) {
    return {
      ok: false,
      error: "Ce flux est utilisé par une équipe que vous ne pilotez pas",
    };
  }
  return { ok: true, isDefault: wf.isDefault };
}

function revalidate() {
  revalidatePath("/workflows");
  revalidatePath("/sprints");
}

function isCategory(v: string): v is BoardColumnCategory {
  return (CATEGORY_ORDER as string[]).includes(v);
}

// ── Flux ─────────────────────────────────────────────────────────────────────

export async function createWorkflow(
  name: string,
  description: string | null
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;
  if (!canCreateWorkflow(viewer)) return fail("Accès refusé");

  const trimmed = name.trim();
  if (trimmed.length < 2) return fail("Nom trop court");
  if (trimmed.length > 60) return fail("Nom trop long (60 caractères max)");

  try {
    // Un nouveau flux part des cinq colonnes standard : une équipe le
    // personnalise ensuite, plutôt que de démarrer sur un tableau vide et
    // inutilisable.
    await prisma.boardWorkflow.create({
      data: {
        orgId,
        name: trimmed,
        description: description?.trim() || null,
        isDefault: false,
        // Trace l'auteur : tant que le flux n'a pas d'équipe, c'est lui seul
        // qui peut y toucher (voir lib/workflow-access).
        createdById: viewer.id,
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
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("Un flux porte déjà ce nom");
    }
    throw e;
  }

  revalidate();
  return { ok: true };
}

export async function updateWorkflow(
  id: string,
  name: string,
  description: string | null
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);

  const trimmed = name.trim();
  if (trimmed.length < 2) return fail("Nom trop court");

  const guard = await requireEditableWorkflow(auth_.viewer, auth_.orgId, id);
  if (!guard.ok) return fail(guard.error);

  try {
    await prisma.boardWorkflow.update({
      where: { id },
      data: { name: trimmed, description: description?.trim() || null },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("Un flux porte déjà ce nom");
    }
    throw e;
  }

  revalidate();
  return { ok: true };
}

export async function deleteWorkflow(id: string): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;

  const wf = await prisma.boardWorkflow.findFirst({
    where: { id, orgId },
    select: { id: true, isDefault: true, createdById: true },
  });
  if (!wf) return fail("Flux introuvable");
  if (wf.isDefault) {
    return fail(
      "Le flux par défaut ne peut pas être supprimé — c'est le filet de sécurité des équipes sans flux dédié"
    );
  }

  const byWorkflow = await teamKeysByWorkflow(orgId);
  const allowed = canDeleteWorkflow(viewer, {
    isDefault: wf.isDefault,
    createdById: wf.createdById,
    teamKeys: byWorkflow[wf.id] ?? [],
  });
  if (!allowed) {
    return fail("Ce flux est utilisé par une équipe que vous ne pilotez pas");
  }

  // Les colonnes tombent en cascade et les tâches concernées repassent à
  // columnId = null (SetNull) : elles restent visibles, rangées par leur
  // catégorie dans le flux par défaut que les équipes récupèrent.
  await prisma.boardWorkflow.delete({ where: { id } });

  revalidate();
  return { ok: true };
}

// ── Colonnes ─────────────────────────────────────────────────────────────────

/**
 * Aligne les tâches d'un ensemble sur la catégorie d'une colonne.
 *
 * `status` est la projection de `column.category` : dès qu'une colonne change
 * de catégorie ou qu'on déplace ses tâches, il faut réécrire le statut, sinon
 * les stats du sprint continueraient de compter la tâche dans l'ancien seau.
 * completedAt suit la même règle qu'à la main sur le tableau.
 */
async function applyCategory(
  tx: Prisma.TransactionClient,
  where: Prisma.SprintTaskWhereInput,
  category: BoardColumnCategory,
  columnId: string | null
) {
  if (category === "DONE") {
    await tx.sprintTask.updateMany({
      where: { ...where, completedAt: null },
      data: { completedAt: new Date() },
    });
    await tx.sprintTask.updateMany({
      where,
      data: { status: category, columnId },
    });
  } else {
    await tx.sprintTask.updateMany({
      where,
      data: { status: category, columnId, completedAt: null },
    });
  }
}

export async function createColumn(
  workflowId: string,
  input: { label: string; color: string; category: string; wipLimit: number | null }
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;

  const label = input.label.trim();
  if (label.length < 1) return fail("Libellé requis");
  if (label.length > 40) return fail("Libellé trop long (40 caractères max)");
  if (!isCategory(input.category)) return fail("Catégorie inconnue");

  const guard = await requireEditableWorkflow(viewer, orgId, workflowId);
  if (!guard.ok) return fail(guard.error);

  const count = await prisma.boardColumn.count({ where: { workflowId } });
  if (count >= 12) {
    return fail("12 colonnes maximum par flux — au-delà le tableau devient illisible");
  }

  await prisma.boardColumn.create({
    data: {
      orgId,
      workflowId,
      label,
      color: input.color,
      category: input.category,
      sortOrder: count,
      wipLimit: input.wipLimit && input.wipLimit > 0 ? input.wipLimit : null,
    },
  });

  revalidate();
  return { ok: true };
}

export async function updateColumn(
  id: string,
  input: { label: string; color: string; category: string; wipLimit: number | null }
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;

  const label = input.label.trim();
  if (label.length < 1) return fail("Libellé requis");
  if (!isCategory(input.category)) return fail("Catégorie inconnue");

  const column = await prisma.boardColumn.findFirst({
    where: { id, orgId },
    select: { id: true, category: true, workflowId: true },
  });
  if (!column) return fail("Colonne introuvable");

  const guard = await requireEditableWorkflow(viewer, orgId, column.workflowId);
  if (!guard.ok) return fail(guard.error);

  // Changer de catégorie ne doit pas priver le flux de son entrée ou de sa
  // sortie.
  if (column.category !== input.category) {
    const siblings = await prisma.boardColumn.findMany({
      where: { workflowId: column.workflowId },
      select: { id: true, category: true },
    });
    const after = siblings.map((c) =>
      c.id === id ? { category: input.category as BoardColumnCategory } : c
    );
    const check = checkRequiredCategories(after);
    if (!check.ok) return fail(check.reason);
  }

  await prisma.$transaction(async (tx) => {
    await tx.boardColumn.update({
      where: { id },
      data: {
        label,
        color: input.color,
        category: input.category as BoardColumnCategory,
        wipLimit: input.wipLimit && input.wipLimit > 0 ? input.wipLimit : null,
      },
    });
    if (column.category !== input.category) {
      await applyCategory(
        tx,
        { orgId, columnId: id },
        input.category as BoardColumnCategory,
        id
      );
    }
  });

  revalidate();
  return { ok: true };
}

export async function deleteColumn(
  id: string,
  moveToColumnId: string
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;

  const column = await prisma.boardColumn.findFirst({
    where: { id, orgId },
    select: { id: true, workflowId: true },
  });
  if (!column) return fail("Colonne introuvable");

  const guard = await requireEditableWorkflow(viewer, orgId, column.workflowId);
  if (!guard.ok) return fail(guard.error);

  const siblings = await prisma.boardColumn.findMany({
    where: { workflowId: column.workflowId },
    select: { id: true, category: true },
  });
  const check = checkRequiredCategories(siblings.filter((c) => c.id !== id));
  if (!check.ok) return fail(check.reason);

  // Supprimer une colonne sans dire où vont ses cartes les laisserait « hors
  // flux » : la destination est donc obligatoire, et doit rester dans le flux.
  const target = siblings.find((c) => c.id === moveToColumnId);
  if (!target) return fail("Choisissez une colonne de destination dans ce flux");

  await prisma.$transaction(async (tx) => {
    await applyCategory(tx, { orgId, columnId: id }, target.category, target.id);
    await tx.boardColumn.delete({ where: { id } });
  });

  revalidate();
  return { ok: true };
}

export async function reorderColumns(
  workflowId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;

  const guard = await requireEditableWorkflow(viewer, orgId, workflowId);
  if (!guard.ok) return fail(guard.error);

  const columns = await prisma.boardColumn.findMany({
    where: { workflowId, orgId },
    select: { id: true },
  });
  const known = new Set(columns.map((c) => c.id));
  if (orderedIds.length !== known.size || orderedIds.some((cid) => !known.has(cid))) {
    return fail("Ordre invalide");
  }

  await prisma.$transaction(
    orderedIds.map((cid, i) =>
      prisma.boardColumn.update({ where: { id: cid }, data: { sortOrder: i } })
    )
  );

  revalidate();
  return { ok: true };
}

// ── Affectation des équipes ──────────────────────────────────────────────────

/**
 * Rattache une équipe ("P:<id>" / "D:<id>") à un flux — ou à rien, pour
 * retomber sur le flux par défaut.
 *
 * Les tâches déjà en cours sont replacées dans la colonne équivalente du
 * nouveau flux, à catégorie constante : changer de flux ne doit jamais faire
 * reculer une tâche ni fausser le sprint en cours.
 *
 * Le droit porte ici sur L'ÉQUIPE, pas sur le flux : un PO choisit le flux de
 * son produit même si ce flux appartient à quelqu'un d'autre. Il pourra alors
 * ne plus avoir le droit de l'éditer — l'écran l'annonce avant le choix.
 */
export async function assignTeamWorkflow(
  teamKey: string,
  workflowId: string | null
): Promise<ActionResult> {
  const auth_ = await requireViewer();
  if (!auth_.ok) return fail(auth_.error);
  const { viewer, orgId } = auth_;

  const [kind, teamId] = [teamKey.slice(0, 1), teamKey.slice(2)];
  if ((kind !== "P" && kind !== "D") || !teamId) return fail("Équipe inconnue");

  if (!canAssignTeam(viewer, teamKey)) {
    return fail("Vous ne pilotez pas cette équipe");
  }

  let targetWorkflowId = workflowId;
  if (targetWorkflowId) {
    const wf = await prisma.boardWorkflow.findFirst({
      where: { id: targetWorkflowId, orgId },
      select: { id: true },
    });
    if (!wf) return fail("Flux introuvable");
  }

  if (kind === "P") {
    const p = await prisma.product.findFirst({
      where: { id: teamId, orgId },
      select: { id: true },
    });
    if (!p) return fail("Produit introuvable");
    await prisma.product.update({
      where: { id: teamId },
      data: { workflowId: targetWorkflowId },
    });
  } else {
    const d = await prisma.department.findFirst({
      where: { id: teamId, orgId },
      select: { id: true },
    });
    if (!d) return fail("Département introuvable");
    await prisma.department.update({
      where: { id: teamId },
      data: { workflowId: targetWorkflowId },
    });
  }

  // Flux effectif après changement (null → celui par défaut).
  if (!targetWorkflowId) {
    const def = await prisma.boardWorkflow.findFirst({
      where: { orgId, isDefault: true },
      select: { id: true },
    });
    targetWorkflowId = def?.id ?? null;
  }

  if (targetWorkflowId) {
    const columns = await prisma.boardColumn.findMany({
      where: { workflowId: targetWorkflowId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, category: true },
    });

    // Le produit prime sur le département pour choisir le flux (cf.
    // board-column-server) : les tâches d'un département excluent donc celles
    // qui portent aussi un produit, sinon on les arracherait au flux du produit.
    const scope: Prisma.SprintTaskWhereInput =
      kind === "P"
        ? { orgId, productId: teamId }
        : { orgId, departmentId: teamId, productId: null };

    for (const category of CATEGORY_ORDER) {
      const target = columns.find((c) => c.category === category);
      await prisma.sprintTask.updateMany({
        where: { ...scope, status: category },
        data: { columnId: target?.id ?? null },
      });
    }
  }

  revalidate();
  return { ok: true };
}
