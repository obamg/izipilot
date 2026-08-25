"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  assignSupportRequestSchema,
  changeSupportRequestStatusSchema,
  commentSupportRequestSchema,
  convertSupportRequestToTaskSchema,
  createSupportRequestSchema,
  deleteSupportAttachmentSchema,
  triageSupportRequestSchema,
} from "@/lib/validations/support-request";
import {
  accessFor,
  departmentTeam,
  loadRequestForViewer,
  nextReference,
  resolveAutoAssignee,
  supportRecipients,
  supportRequestInclude,
  type Viewer,
} from "@/lib/support-request-server";
import { canTransition, computeDueAt, isOpenStatus, SUPPORT_STATUS_META } from "@/lib/support-request";
import { notifySupportRequest } from "@/lib/support-notify";
import { deleteAttachment } from "@/lib/storage";
import { resolveInitialColumn } from "@/lib/board-column-server";
import { log } from "@/lib/log";

const logger = log.child("support/actions");

function fail(error: string) {
  return { ok: false as const, error };
}

function revalidate(id?: string) {
  revalidatePath("/support");
  revalidatePath("/support/queue");
  if (id) revalidatePath(`/support/${id}`);
}

async function viewerOrNull(): Promise<Viewer | null> {
  const session = await auth();
  if (!session?.user) return null;
  return { id: session.user.id, orgId: session.user.orgId, role: session.user.role };
}

/**
 * Dépose une demande auprès d'un département guichet. La référence lisible est
 * générée avec retry : deux dépôts simultanés peuvent viser le même numéro, et
 * c'est l'index unique (orgId, reference) qui tranche.
 */
export async function createSupportRequest(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  // VIEWER est en lecture seule sur toute l'app (CLAUDE.md).
  if (viewer.role === "VIEWER") return fail("Accès refusé");

  const parsed = createSupportRequestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Données invalides");
  }
  const { departmentId, category, priority, title, description, requestedAssigneeId } =
    parsed.data;

  const department = await prisma.department.findFirst({
    where: { id: departmentId, orgId: viewer.orgId, acceptsRequests: true, isActive: true },
    select: { id: true, code: true },
  });
  if (!department) return fail("Ce département n'accepte pas de demandes");

  // Le destinataire souhaité doit appartenir à l'équipe du guichet visé —
  // sinon n'importe qui pourrait s'adresser à n'importe qui dans l'org, ce qui
  // vide le guichet de son sens et envoie des demandes IT à la compta.
  if (requestedAssigneeId) {
    const team = await departmentTeam(viewer.orgId, department.id);
    if (!team.some((u) => u.id === requestedAssigneeId)) {
      return fail("Cette personne ne fait pas partie de l'équipe de ce guichet");
    }
  }

  const now = new Date();
  // Le souhait du demandeur l'emporte sur l'auto-affectation ; à défaut, on
  // retombe sur l'agent traiteur du guichet.
  const assigneeId =
    requestedAssigneeId ?? (await resolveAutoAssignee(viewer.orgId, department.id));

  let created: { id: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const reference = await nextReference(
      viewer.orgId,
      department.code,
      now.getUTCFullYear(),
      attempt
    );
    try {
      created = await prisma.supportRequest.create({
        data: {
          orgId: viewer.orgId,
          reference,
          requesterId: viewer.id,
          departmentId: department.id,
          assigneeId,
          requestedAssigneeId: requestedAssigneeId ?? null,
          category,
          priority,
          status: "SUBMITTED",
          title,
          description,
          dueAt: computeDueAt(priority, now),
        },
        select: { id: true },
      });
    } catch (err) {
      const isRefConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isRefConflict) throw err;
    }
  }
  if (!created) return fail("Impossible de générer une référence, réessayez");

  revalidate(created.id);
  await notifyOnChange(created.id, "NEW", viewer.id, null);
  return { ok: true as const, data: { id: created.id } };
}

/** Qualification par le support : catégorie, priorité, échéance. */
export async function triageSupportRequest(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  const parsed = triageSupportRequestSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, category, priority, dueAt } = parsed.data;

  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) return fail("Demande introuvable");
  if (!loaded.access.canHandle) return fail("Accès refusé");
  if (!isOpenStatus(loaded.request.status)) {
    return fail("Demande clôturée — rouvrez-la avant de la requalifier");
  }

  // Une date explicite l'emporte. Sinon, changer la priorité recale l'échéance
  // sur le SLA de la nouvelle priorité, décompté depuis le dépôt.
  let nextDueAt: Date | null | undefined;
  if (dueAt !== undefined) {
    nextDueAt = dueAt ? new Date(dueAt) : null;
  } else if (priority != null && priority !== loaded.request.priority) {
    nextDueAt = computeDueAt(priority, loaded.request.createdAt);
  }

  await prisma.supportRequest.update({
    where: { id },
    data: {
      ...(category != null ? { category } : {}),
      ...(priority != null ? { priority } : {}),
      ...(nextDueAt !== undefined ? { dueAt: nextDueAt } : {}),
      // Nouvelle échéance = nouveau cycle de relance.
      lastOverdueNotifiedAt: null,
    },
  });

  revalidate(id);
  return { ok: true as const };
}

/** Assigne (ou désassigne) la demande à une personne du support. */
export async function assignSupportRequest(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  const parsed = assignSupportRequestSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, assigneeId } = parsed.data;

  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) return fail("Demande introuvable");
  if (!loaded.access.canHandle) return fail("Accès refusé");

  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, orgId: viewer.orgId, isActive: true },
      select: { id: true },
    });
    if (!assignee) return fail("Personne introuvable");
  }
  if (assigneeId === loaded.request.assigneeId) return { ok: true as const };

  await prisma.supportRequest.update({
    where: { id },
    data: {
      assigneeId,
      // Prendre en charge une demande encore brute la fait passer en TRIAGED :
      // sinon la file affiche "Déposée" alors que quelqu'un s'en occupe.
      ...(assigneeId && loaded.request.status === "SUBMITTED"
        ? { status: "TRIAGED" as const }
        : {}),
      ...(loaded.request.firstResponseAt == null && assigneeId
        ? { firstResponseAt: new Date() }
        : {}),
    },
  });

  revalidate(id);
  if (assigneeId && assigneeId !== viewer.id) {
    await notifyUsers(id, "UPDATE", [assigneeId], "Cette demande vous a été assignée.");
  }
  return { ok: true as const };
}

/** Change le statut, avec les transitions autorisées pour l'acteur. */
export async function changeSupportRequestStatus(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  const parsed = changeSupportRequestStatusSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, status, resolutionNote } = parsed.data;

  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) return fail("Demande introuvable");
  const { request, access } = loaded;

  if (request.status === status) return { ok: true as const };
  if (!canTransition(request.status, status, access.actor)) {
    return fail(`Transition impossible depuis « ${SUPPORT_STATUS_META[request.status].label} »`);
  }
  // Une résolution ou un refus sans explication est inexploitable pour le
  // demandeur — on l'exige plutôt que de laisser un ticket muet.
  if ((status === "RESOLVED" || status === "REJECTED") && !resolutionNote?.trim()) {
    return fail("Expliquez la résolution ou le motif du refus");
  }

  const now = new Date();
  const reopening = isOpenStatus(status) && !isOpenStatus(request.status);

  await prisma.supportRequest.update({
    where: { id },
    data: {
      status,
      ...(resolutionNote !== undefined && resolutionNote !== null
        ? { resolutionNote: resolutionNote.trim() || null }
        : {}),
      ...(request.firstResponseAt == null && access.actor === "SUPPORT"
        ? { firstResponseAt: now }
        : {}),
      resolvedAt: status === "RESOLVED" ? now : reopening ? null : request.resolvedAt,
      closedAt:
        status === "CLOSED" || status === "REJECTED" || status === "CANCELLED"
          ? now
          : reopening
            ? null
            : request.closedAt,
      closedById:
        status === "CLOSED" || status === "REJECTED" || status === "CANCELLED"
          ? viewer.id
          : reopening
            ? null
            : request.closedById,
      ...(reopening ? { lastOverdueNotifiedAt: null } : {}),
    },
  });

  revalidate(id);
  const note = resolutionNote?.trim();
  await notifyOnChange(
    id,
    "UPDATE",
    viewer.id,
    `Statut : ${SUPPORT_STATUS_META[status].label}${note ? ` — ${note}` : ""}`
  );
  return { ok: true as const };
}

/** Ajoute un message au fil. `isInternal` est réservé au support. */
export async function commentSupportRequest(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  const parsed = commentSupportRequestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Données invalides");
  }
  const { id, content, isInternal } = parsed.data;

  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) return fail("Demande introuvable");
  const { request, access } = loaded;
  if (viewer.role === "VIEWER") return fail("Accès refusé");
  if (isInternal && !access.canHandle) return fail("Accès refusé");

  await prisma.$transaction([
    prisma.supportRequestComment.create({
      data: { requestId: id, authorId: viewer.id, content, isInternal },
    }),
    prisma.supportRequest.update({
      where: { id },
      data:
        // Le délai de première réponse se compte sur la première réponse
        // publique du support — une note interne ne répond à personne.
        request.firstResponseAt == null && access.actor === "SUPPORT" && !isInternal
          ? { firstResponseAt: new Date() }
          : {},
    }),
  ]);

  revalidate(id);
  // Une note interne ne notifie jamais le demandeur.
  if (isInternal) {
    const recipients = await supportRecipients(
      viewer.orgId,
      request.departmentId,
      request.assigneeId,
      viewer.id
    );
    await notifyUsers(
      id,
      "UPDATE",
      recipients.map((r) => r.id),
      "Nouvelle note interne."
    );
  } else {
    await notifyOnChange(id, "UPDATE", viewer.id, "Nouveau message sur la demande.");
  }
  return { ok: true as const };
}

/** Transforme une demande validée en tâche de sprint (lien conservé). */
export async function convertSupportRequestToTask(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  const parsed = convertSupportRequestToTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");
  const { id, sprintId, departmentId, assigneeId } = parsed.data;

  const loaded = await loadRequestForViewer(viewer, id);
  if (!loaded) return fail("Demande introuvable");
  const { request, access } = loaded;
  if (!access.canHandle) return fail("Accès refusé");
  if (request.taskId) return fail("Cette demande est déjà liée à une tâche");

  if (sprintId) {
    const sprint = await prisma.sprint.findFirst({
      where: { id: sprintId, orgId: viewer.orgId },
      select: { id: true },
    });
    if (!sprint) return fail("Sprint introuvable");
  }
  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, orgId: viewer.orgId, isActive: true },
      select: { id: true },
    });
    if (!assignee) return fail("Personne introuvable");
  }

  // La priorité de la demande se transpose sur la tâche : URGENT reste URGENT,
  // le reste retombe sur l'échelle ActionPriority.
  const taskPriority =
    request.priority === "URGENT" ? "URGENT" : request.priority === "HIGH" ? "HIGH" : request.priority === "LOW" ? "LOW" : "MEDIUM";

  const taskDepartmentId = departmentId ?? request.departmentId;
  const columnId = await resolveInitialColumn(viewer.orgId, {
    departmentId: taskDepartmentId,
  });

  const task = await prisma.sprintTask.create({
    data: {
      orgId: viewer.orgId,
      sprintId: sprintId ?? null,
      departmentId: taskDepartmentId,
      columnId,
      title: request.title,
      description: `Demande ${request.reference} — déposée par ${request.requester.name}\n\n${request.description}`,
      priority: taskPriority,
      assigneeId: assigneeId ?? request.assigneeId,
      createdById: viewer.id,
      dueDate: request.dueAt,
    },
    select: { id: true },
  });

  await prisma.supportRequest.update({
    where: { id },
    data: {
      taskId: task.id,
      // Une demande convertie est activement traitée.
      ...(request.status === "SUBMITTED" || request.status === "TRIAGED"
        ? { status: "IN_PROGRESS" as const }
        : {}),
      ...(request.firstResponseAt == null ? { firstResponseAt: new Date() } : {}),
    },
  });

  revalidate(id);
  revalidatePath("/sprints");
  await notifyOnChange(
    id,
    "UPDATE",
    viewer.id,
    "Votre demande a été convertie en tâche et planifiée."
  );
  return { ok: true as const, data: { taskId: task.id } };
}

/** Supprime une pièce jointe (son auteur ou le support). */
export async function deleteSupportAttachment(input: unknown) {
  const viewer = await viewerOrNull();
  if (!viewer) return fail("Non authentifié");
  const parsed = deleteSupportAttachmentSchema.safeParse(input);
  if (!parsed.success) return fail("Données invalides");

  const attachment = await prisma.supportRequestAttachment.findFirst({
    where: { id: parsed.data.attachmentId, request: { orgId: viewer.orgId } },
    select: {
      id: true,
      storageKey: true,
      uploadedById: true,
      request: {
        select: { id: true, requesterId: true, assigneeId: true, departmentId: true },
      },
    },
  });
  if (!attachment) return fail("Pièce jointe introuvable");

  const access = await accessFor(viewer, attachment.request);
  if (!access.canView) return fail("Accès refusé");
  if (attachment.uploadedById !== viewer.id && !access.canHandle) {
    return fail("Accès refusé");
  }

  await prisma.supportRequestAttachment.delete({ where: { id: attachment.id } });
  // Le fichier part après la ligne : un orphelin sur disque est moins grave
  // qu'une ligne pointant vers un fichier absent.
  await deleteAttachment(attachment.storageKey).catch((err) =>
    logger.warn("attachment file delete failed", { key: attachment.storageKey, err: String(err) })
  );

  revalidate(attachment.request.id);
  return { ok: true as const };
}

// ── Notifications ───────────────────────────────────────────────────────────

/**
 * Recharge la demande et notifie l'autre côté : le guichet quand le demandeur
 * agit, le demandeur quand le guichet agit. L'auteur n'est jamais notifié.
 */
async function notifyOnChange(
  requestId: string,
  kind: "NEW" | "UPDATE",
  actorId: string,
  message: string | null
) {
  try {
    const request = await prisma.supportRequest.findUnique({
      where: { id: requestId },
      include: supportRequestInclude,
    });
    if (!request) return;

    const support = await supportRecipients(
      request.orgId,
      request.departmentId,
      request.assigneeId,
      actorId
    );
    const recipients = [...support];
    if (request.requesterId !== actorId) {
      const requester = await prisma.user.findFirst({
        where: { id: request.requesterId, isActive: true },
        select: { id: true, name: true, email: true },
      });
      if (requester && !recipients.some((r) => r.id === requester.id)) {
        recipients.push(requester);
      }
    }

    await notifySupportRequest({ kind, request, recipients, message });
  } catch (err) {
    logger.error("notify failed", { requestId }, err);
  }
}

/** Notifie une liste d'ids précise (assignation, note interne). */
async function notifyUsers(
  requestId: string,
  kind: "NEW" | "UPDATE",
  userIds: ReadonlyArray<string>,
  message: string
) {
  if (userIds.length === 0) return;
  try {
    const [request, users] = await Promise.all([
      prisma.supportRequest.findUnique({
        where: { id: requestId },
        include: supportRequestInclude,
      }),
      prisma.user.findMany({
        where: { id: { in: [...userIds] }, isActive: true },
        select: { id: true, name: true, email: true },
      }),
    ]);
    if (!request) return;
    await notifySupportRequest({ kind, request, recipients: users, message });
  } catch (err) {
    logger.error("notify failed", { requestId }, err);
  }
}
