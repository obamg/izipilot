/**
 * Demandes internes — accès DB, droits et auto-affectation.
 * La logique pure (statuts, SLA, stats) vit dans lib/support-request.ts.
 */

import type { UserRole } from "@prisma/client";
import { prisma } from "./prisma";
import { formatReference, type SupportActorKind } from "./support-request";

export interface Viewer {
  id: string;
  orgId: string;
  role: UserRole;
}

/** Départements dont le viewer tient le guichet (support, owner ou membre). */
export async function supportedDepartmentIds(viewer: Viewer): Promise<string[]> {
  const depts = await prisma.department.findMany({
    where: {
      orgId: viewer.orgId,
      acceptsRequests: true,
      OR: [
        { supportUserId: viewer.id },
        { ownerId: viewer.id },
        { members: { some: { userId: viewer.id } } },
      ],
    },
    select: { id: true },
  });
  return depts.map((d) => d.id);
}

/** Le CODIR voit et traite toutes les demandes de l'org. */
export function isSupportAdmin(role: UserRole): boolean {
  return role === "CEO" || role === "MANAGEMENT";
}

/** Départements ouverts aux demandes — alimente le sélecteur du formulaire. */
export async function requestableDepartments(orgId: string) {
  return prisma.department.findMany({
    where: { orgId, acceptsRequests: true, isActive: true },
    select: { id: true, code: true, name: true, color: true },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Équipe d'un guichet : agent traiteur, responsable et membres, actifs
 * uniquement. C'est la liste des personnes qu'un demandeur peut viser — on ne
 * laisse pas adresser une demande IT à quelqu'un de la compta.
 */
export async function departmentTeam(orgId: string, departmentId: string) {
  return prisma.user.findMany({
    where: {
      orgId,
      isActive: true,
      OR: [
        { supportedDepartments: { some: { id: departmentId } } },
        { ownedDepartments: { some: { id: departmentId } } },
        { departmentMembers: { some: { departmentId } } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Équipes de tous les guichets ouverts, indexées par département. */
export async function requestableDepartmentsWithTeams(orgId: string) {
  const departments = await requestableDepartments(orgId);
  return Promise.all(
    departments.map(async (d) => ({
      ...d,
      team: await departmentTeam(orgId, d.id),
    }))
  );
}

/**
 * Personne à qui la demande revient par défaut : le support désigné du
 * département, à défaut son responsable. Renvoie null si le département a
 * disparu (le guichet reste alors non assigné plutôt que de bloquer le dépôt).
 */
export async function resolveAutoAssignee(
  orgId: string,
  departmentId: string
): Promise<string | null> {
  const dept = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
    select: { supportUserId: true, ownerId: true, supportUser: { select: { isActive: true } } },
  });
  if (!dept) return null;
  // Un support désactivé (départ, congé long) ne doit pas recevoir la demande :
  // on retombe sur le responsable pour qu'elle soit vue.
  if (dept.supportUserId && dept.supportUser?.isActive) return dept.supportUserId;
  return dept.ownerId;
}

/**
 * Prochaine référence libre pour un département, ex "IT-2026-0042".
 * La séquence repart à 1 chaque année. Le padding sur 4 chiffres rend le tri
 * lexicographique équivalent au tri numérique jusqu'à 9999 demandes/an.
 */
export async function nextReference(
  orgId: string,
  departmentCode: string,
  year: number,
  attempt = 0
): Promise<string> {
  const prefix = `${departmentCode.toUpperCase()}-${year}-`;
  const last = await prisma.supportRequest.findFirst({
    where: { orgId, reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const lastSeq = last ? Number.parseInt(last.reference.slice(prefix.length), 10) : 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1 + attempt;
  return formatReference(departmentCode, year, seq);
}

/** Ce que le viewer a le droit de faire sur une demande donnée. */
export interface SupportAccess {
  canView: boolean;
  /** Traite la demande : statut, assignation, qualification, note interne. */
  canHandle: boolean;
  /** A déposé la demande : annulation, clôture, refus de la résolution. */
  isRequester: boolean;
  /** Rôle retenu pour les transitions de statut. */
  actor: SupportActorKind;
}

interface RequestForAccess {
  requesterId: string;
  assigneeId: string | null;
  departmentId: string;
}

export async function accessFor(
  viewer: Viewer,
  request: RequestForAccess
): Promise<SupportAccess> {
  const isRequester = request.requesterId === viewer.id;
  const admin = isSupportAdmin(viewer.role);

  let canHandle = admin || request.assigneeId === viewer.id;
  if (!canHandle) {
    const supported = await supportedDepartmentIds(viewer);
    canHandle = supported.includes(request.departmentId);
  }
  // VIEWER est en lecture seule sur toute l'app (CLAUDE.md) — il peut suivre
  // une demande mais jamais agir dessus, même s'il en est le destinataire.
  if (viewer.role === "VIEWER") canHandle = false;

  return {
    canView: canHandle || isRequester,
    canHandle,
    isRequester,
    // Le support l'emporte quand la personne est les deux : un membre de l'IT
    // qui dépose sa propre demande garde ses droits de traitement.
    actor: canHandle ? "SUPPORT" : "REQUESTER",
  };
}

export const supportRequestInclude = {
  requester: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true, email: true } },
  requestedAssignee: { select: { id: true, name: true } },
  department: { select: { id: true, code: true, name: true, color: true } },
  task: { select: { id: true, title: true, status: true, sprintId: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;

/**
 * Charge une demande en vérifiant l'org, puis calcule les droits du viewer.
 * Renvoie null si elle n'existe pas ou si le viewer n'a rien à y voir — les
 * deux cas sont indistinguables côté appelant, pour ne pas révéler l'existence
 * d'une demande d'un autre périmètre.
 */
export async function loadRequestForViewer(viewer: Viewer, requestId: string) {
  const request = await prisma.supportRequest.findFirst({
    where: { id: requestId, orgId: viewer.orgId },
    include: supportRequestInclude,
  });
  if (!request) return null;

  const access = await accessFor(viewer, request);
  if (!access.canView) return null;
  return { request, access };
}

/**
 * Destinataires des notifications côté guichet : l'assigné, le support désigné
 * et le responsable du département. Dédupliqué, sans l'auteur de l'événement
 * (personne n'a besoin d'être notifié de sa propre action).
 */
export async function supportRecipients(
  orgId: string,
  departmentId: string,
  assigneeId: string | null,
  excludeUserId?: string
): Promise<Array<{ id: string; name: string; email: string }>> {
  const dept = await prisma.department.findFirst({
    where: { id: departmentId, orgId },
    select: { supportUserId: true, ownerId: true },
  });

  const ids = new Set<string>();
  if (assigneeId) ids.add(assigneeId);
  if (dept?.supportUserId) ids.add(dept.supportUserId);
  if (dept?.ownerId) ids.add(dept.ownerId);
  if (excludeUserId) ids.delete(excludeUserId);
  if (ids.size === 0) return [];

  return prisma.user.findMany({
    where: { id: { in: [...ids] }, orgId, isActive: true },
    select: { id: true, name: true, email: true },
  });
}
