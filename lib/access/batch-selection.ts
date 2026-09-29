// lib/access/batch-selection.ts

/**
 * Sépare la sélection « Approuver la sélection » de « Mes approbations » :
 * une étape dont l'escalade CISO→COO est cochée ne doit JAMAIS partir dans
 * une approbation en lot (le lot envoie une approbation simple, sans
 * `escalateToCoo` ni motif — elle finaliserait la demande en sautant la
 * signature COO annoncée à l'écran). Ces étapes sont exclues du lot et
 * doivent être traitées individuellement.
 */
export function splitBatchSelection(
  selected: Record<string, boolean>,
  escalateById: Record<string, boolean>
): { approvable: string[]; escalating: string[] } {
  const approvable: string[] = [];
  const escalating: string[] = [];
  for (const [stageId, isSelected] of Object.entries(selected)) {
    if (!isSelected) continue;
    if (escalateById[stageId]) escalating.push(stageId);
    else approvable.push(stageId);
  }
  return { approvable, escalating };
}
