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

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * Configurer les flux touche la façon dont TOUTES les équipes voient leur
 * travail — réservé au CEO, comme le reste de /admin (le layout l'impose déjà ;
 * on le revérifie ici car une Server Action est appelable directement).
 */
async function requireAdmin(): Promise<
  { ok: true; orgId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Non authentifié" };
  if (session.user.role !== "CEO") return { ok: false, error: "Accès refusé" };
  return { ok: true, orgId: session.user.orgId };
}

function revalidate() {
  revalidatePath("/admin/workflows");
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
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const trimmed = name.trim();
  if (trimmed.length < 2) return fail("Nom trop court");
  if (trimmed.length > 60) return fail("Nom trop long (60 caractères max)");

  try {
    // Un nouveau flux part des cinq colonnes standard : une équipe le
    // personnalise ensuite, plutôt que de démarrer sur un tableau vide et
    // inutilisable.
    await prisma.boardWorkflow.create({
      data: {
        orgId: admin.orgId,
        name: trimmed,
        description: description?.trim() || null,
        isDefault: false,
        columns: {
          create: DEFAULT_COLUMNS.map((c, i) => ({
            orgId: admin.orgId,
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
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const trimmed = name.trim();
  if (trimmed.length < 2) return fail("Nom trop court");

  const existing = await prisma.boardWorkflow.findFirst({
    where: { id, orgId: admin.orgId },
    select: { id: true },
  });
  if (!existing) return fail("Flux introuvable");

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
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const wf = await prisma.boardWorkflow.findFirst({
    where: { id, orgId: admin.orgId },
    select: { id: true, isDefault: true },
  });
  if (!wf) return fail("Flux introuvable");
  if (wf.isDefault) {
    return fail(
      "Le flux par défaut ne peut pas être supprimé — c'est le filet de sécurité des équipes sans flux dédié"
    );
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
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const label = input.label.trim();
  if (label.length < 1) return fail("Libellé requis");
  if (label.length > 40) return fail("Libellé trop long (40 caractères max)");
  if (!isCategory(input.category)) return fail("Catégorie inconnue");

  const wf = await prisma.boardWorkflow.findFirst({
    where: { id: workflowId, orgId: admin.orgId },
    select: { id: true, _count: { select: { columns: true } } },
  });
  if (!wf) return fail("Flux introuvable");
  if (wf._count.columns >= 12) {
    return fail("12 colonnes maximum par flux — au-delà le tableau devient illisible");
  }

  await prisma.boardColumn.create({
    data: {
      orgId: admin.orgId,
      workflowId,
      label,
      color: input.color,
      category: input.category,
      sortOrder: wf._count.columns,
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
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const label = input.label.trim();
  if (label.length < 1) return fail("Libellé requis");
  if (!isCategory(input.category)) return fail("Catégorie inconnue");

  const column = await prisma.boardColumn.findFirst({
    where: { id, orgId: admin.orgId },
    select: { id: true, category: true, workflowId: true },
  });
  if (!column) return fail("Colonne introuvable");

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
        { orgId: admin.orgId, columnId: id },
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
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const column = await prisma.boardColumn.findFirst({
    where: { id, orgId: admin.orgId },
    select: { id: true, workflowId: true },
  });
  if (!column) return fail("Colonne introuvable");

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
    await applyCategory(
      tx,
      { orgId: admin.orgId, columnId: id },
      target.category,
      target.id
    );
    await tx.boardColumn.delete({ where: { id } });
  });

  revalidate();
  return { ok: true };
}

export async function reorderColumns(
  workflowId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const columns = await prisma.boardColumn.findMany({
    where: { workflowId, orgId: admin.orgId },
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
 */
export async function assignTeamWorkflow(
  teamKey: string,
  workflowId: string | null
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return fail(admin.error);

  const [kind, teamId] = [teamKey.slice(0, 1), teamKey.slice(2)];
  if ((kind !== "P" && kind !== "D") || !teamId) return fail("Équipe inconnue");

  let targetWorkflowId = workflowId;
  if (targetWorkflowId) {
    const wf = await prisma.boardWorkflow.findFirst({
      where: { id: targetWorkflowId, orgId: admin.orgId },
      select: { id: true },
    });
    if (!wf) return fail("Flux introuvable");
  }

  if (kind === "P") {
    const p = await prisma.product.findFirst({
      where: { id: teamId, orgId: admin.orgId },
      select: { id: true },
    });
    if (!p) return fail("Produit introuvable");
    await prisma.product.update({
      where: { id: teamId },
      data: { workflowId: targetWorkflowId },
    });
  } else {
    const d = await prisma.department.findFirst({
      where: { id: teamId, orgId: admin.orgId },
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
      where: { orgId: admin.orgId, isDefault: true },
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
        ? { orgId: admin.orgId, productId: teamId }
        : { orgId: admin.orgId, departmentId: teamId, productId: null };

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
