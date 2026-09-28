// lib/access/roles-server.ts
import { prisma } from "@/lib/prisma";
import { isAvailable } from "./roles";
import type { EffectiveRole } from "./scope";
import type { AccessModuleRole } from "./types";

export interface RoleAssignmentDTO {
  id: string;
  role: AccessModuleRole;
  userId: string | null;
  userName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  backupUserId: string | null;
  backupUserName: string | null;
  primaryUnavailable: boolean;
  revision: number;
}

function toDTO(row: {
  id: string;
  role: AccessModuleRole;
  userId: string | null;
  departmentId: string | null;
  backupUserId: string | null;
  primaryUnavailable: boolean;
  revision: number;
  user: { name: string } | null;
  department: { name: string } | null;
  backupUser: { name: string } | null;
}): RoleAssignmentDTO {
  return {
    id: row.id,
    role: row.role,
    userId: row.userId,
    userName: row.user?.name ?? null,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    backupUserId: row.backupUserId,
    backupUserName: row.backupUser?.name ?? null,
    primaryUnavailable: row.primaryUnavailable,
    revision: row.revision,
  };
}

const INCLUDE = {
  user: { select: { name: true } },
  department: { select: { name: true } },
  backupUser: { select: { name: true } },
} as const;

export async function listRoleAssignments(orgId: string): Promise<RoleAssignmentDTO[]> {
  const rows = await prisma.accessRoleAssignment.findMany({
    where: { orgId },
    include: INCLUDE,
    orderBy: [{ role: "asc" }],
  });
  return rows.map(toDTO);
}

/**
 * Rôles effectifs d'un utilisateur : titulaire direct, ou suppléant actif
 * d'une affectation dont le titulaire est indisponible. Combine les rôles à
 * titulaire (userId) et les DEPARTMENT_HEAD (portés par Department.ownerId,
 * pas par AccessRoleAssignment.userId).
 */
export async function getEffectiveRoleHolders(
  orgId: string,
  userId: string
): Promise<EffectiveRole[]> {
  const [roleAssignments, ownedDepartments] = await Promise.all([
    prisma.accessRoleAssignment.findMany({ where: { orgId } }),
    prisma.department.findMany({ where: { orgId, ownerId: userId }, select: { id: true } }),
  ]);

  const userIds = new Set<string>();
  for (const a of roleAssignments) {
    if (a.userId) userIds.add(a.userId);
    if (a.backupUserId) userIds.add(a.backupUserId);
  }
  userIds.add(userId);

  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, isActive: true },
    }),
    prisma.accessProfile.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, lifecycle: true },
    }),
  ]);
  const isActiveById = new Map(users.map((u) => [u.id, u.isActive]));
  const lifecycleById = new Map(profiles.map((p) => [p.userId, p.lifecycle]));
  const availability = (id: string) =>
    isAvailable({
      userId: id,
      isActive: isActiveById.get(id) ?? false,
      lifecycle: lifecycleById.get(id) ?? null,
    });

  const effective: EffectiveRole[] = [];

  for (const a of roleAssignments) {
    if (a.role === "DEPARTMENT_HEAD") continue; // traité séparément ci-dessous
    if (a.userId === userId && availability(userId) && !a.primaryUnavailable) {
      effective.push({ role: a.role, actsAsPrimary: true, departmentId: null });
    } else if (
      a.backupUserId === userId &&
      availability(userId) &&
      (a.primaryUnavailable || !a.userId || !availability(a.userId))
    ) {
      effective.push({ role: a.role, actsAsPrimary: false, departmentId: null });
    }
  }

  // Chef de département direct (Department.ownerId).
  for (const dept of ownedDepartments) {
    if (availability(userId)) {
      effective.push({ role: "DEPARTMENT_HEAD", actsAsPrimary: true, departmentId: dept.id });
    }
  }

  // Suppléant d'un chef de département : agit seulement si le titulaire
  // (Department.ownerId) est explicitement marqué indisponible.
  const departmentHeadAssignments = roleAssignments.filter(
    (a) => a.role === "DEPARTMENT_HEAD" && a.backupUserId === userId && a.departmentId
  );
  if (departmentHeadAssignments.length > 0) {
    const departments = await prisma.department.findMany({
      where: { id: { in: departmentHeadAssignments.map((a) => a.departmentId as string) } },
      select: { id: true, ownerId: true },
    });
    const ownerByDept = new Map(departments.map((d) => [d.id, d.ownerId]));
    for (const a of departmentHeadAssignments) {
      const owner = ownerByDept.get(a.departmentId as string);
      const ownerUnavailable = !owner || !availability(owner);
      if (availability(userId) && a.primaryUnavailable && ownerUnavailable) {
        effective.push({
          role: "DEPARTMENT_HEAD",
          actsAsPrimary: false,
          departmentId: a.departmentId as string,
        });
      }
    }
  }

  return effective;
}

export interface UpsertRoleAssignmentInput {
  orgId: string;
  role: Exclude<AccessModuleRole, "DEPARTMENT_HEAD">;
  userId: string;
  backupUserId: string | null;
}

/**
 * Attribue ou remplace le titulaire d'un rôle non lié à un département.
 * S'appuie sur les contraintes en base (Tâche 2) pour l'unicité CISO/COO et
 * le suppléant distinct du titulaire ; ici on ne fait que traduire l'erreur
 * Postgres en message explicite.
 */
export async function upsertRoleAssignment(
  input: UpsertRoleAssignmentInput
): Promise<RoleAssignmentDTO> {
  if (input.backupUserId === input.userId) {
    throw new RoleAssignmentError("Le suppléant ne peut pas être la même personne que le titulaire");
  }

  const existing = await prisma.accessRoleAssignment.findFirst({
    where: { orgId: input.orgId, role: input.role, userId: input.userId },
  });

  try {
    const row = existing
      ? await prisma.accessRoleAssignment.update({
          where: { id: existing.id },
          data: { backupUserId: input.backupUserId, revision: { increment: 1 } },
          include: INCLUDE,
        })
      : await prisma.accessRoleAssignment.create({
          data: {
            orgId: input.orgId,
            role: input.role,
            userId: input.userId,
            backupUserId: input.backupUserId,
          },
          include: INCLUDE,
        });
    return toDTO(row);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new RoleAssignmentError(
        `Il existe déjà un titulaire ${input.role} pour cette organisation`
      );
    }
    throw err;
  }
}

export async function setPrimaryUnavailable(
  assignmentId: string,
  orgId: string,
  unavailable: boolean
): Promise<RoleAssignmentDTO> {
  const row = await prisma.accessRoleAssignment.update({
    where: { id: assignmentId, orgId },
    data: { primaryUnavailable: unavailable, revision: { increment: 1 } },
    include: INCLUDE,
  });
  return toDTO(row);
}

export async function deleteRoleAssignment(assignmentId: string, orgId: string): Promise<void> {
  await prisma.accessRoleAssignment.delete({ where: { id: assignmentId, orgId } });
}

export class RoleAssignmentError extends Error {}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
