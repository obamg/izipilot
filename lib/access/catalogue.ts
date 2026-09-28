export interface LevelForReadiness {
  enabled: boolean;
  archivedAt: Date | null;
  priority: number | null;
  isAdmin: boolean | null;
}

export interface AssetForReadiness {
  ownerId: string | null;
  archivedAt: Date | null;
}

/**
 * Un actif est ouvert aux demandes des employés seulement quand le
 * propriétaire et au moins un niveau sélectionnable complet existent
 * (spec §4 : "Enable employee requests only after ownership and selectable
 * level metadata are complete").
 */
export function isReadyForRequests(
  asset: AssetForReadiness,
  levels: LevelForReadiness[]
): boolean {
  if (!asset.ownerId || asset.archivedAt) return false;

  const selectable = levels.filter((l) => l.enabled && !l.archivedAt);
  if (selectable.length === 0) return false;

  return selectable.every((l) => l.priority !== null && l.isAdmin !== null);
}

/** Un changement de priorité ou de drapeau admin invalide les approbations en cours (spec §4). */
export function catalogueChangeRequiresVersionBump(
  changedFields: Array<"priority" | "isAdmin">
): boolean {
  return changedFields.length > 0;
}

export function nextCatalogueVersion(current: number): number {
  return current + 1;
}
