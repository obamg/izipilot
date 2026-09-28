import type { RoleAssignmentLike, UserAvailability, ActingUser } from "./types";

export function isAvailable(user: UserAvailability): boolean {
  if (!user.isActive) return false;
  if (user.lifecycle === "OFFBOARDING" || user.lifecycle === "DEPARTED") return false;
  return true;
}

/**
 * Qui agit effectivement pour cette affectation de rôle : le titulaire s'il
 * est disponible et non marqué indisponible, sinon le suppléant actif.
 * Renvoie null si personne d'éligible — la spec interdit tout saut ou
 * approbateur inventé (§3.2).
 */
export function resolveActingUser(
  assignment: RoleAssignmentLike,
  availability: Map<string, UserAvailability>
): ActingUser | null {
  const primaryAvailability = assignment.userId
    ? availability.get(assignment.userId)
    : undefined;
  const primaryEligible =
    !!assignment.userId &&
    !!primaryAvailability &&
    isAvailable(primaryAvailability) &&
    !assignment.primaryUnavailable;

  if (primaryEligible) {
    return { userId: assignment.userId as string, actsAsPrimary: true };
  }

  if (assignment.backupUserId) {
    const backupAvailability = availability.get(assignment.backupUserId);
    if (backupAvailability && isAvailable(backupAvailability)) {
      return { userId: assignment.backupUserId, actsAsPrimary: false };
    }
  }

  return null;
}
