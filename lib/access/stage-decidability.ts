// lib/access/stage-decidability.ts
//
// Module dédié et sans dépendance : seule source de vérité pour le prédicat
// de décidabilité d'une étape d'approbation, partagé entre
// `requests-server.ts` (`decideStage`, contrôle bloquant) et
// `requests-read-server.ts` (`listMyApprovals`, filtre de visibilité). Vivait
// auparavant dans `requests-server.ts`, importé en retour par
// `requests-read-server.ts` — qui importe déjà `canInitiateDepartmentReduction`
// depuis `requests-server.ts` dans l'autre sens — ce qui créait un cycle
// d'imports entre les deux. Extrait ici, sans import d'aucun des deux, pour
// casser ce cycle structurellement plutôt que de compter sur le fait que les
// deux symboles ne sont utilisés que dans des corps de fonction (jamais à
// l'évaluation du module).

export type StageDecidabilityReason =
  | "SEQUENCE_NOT_REACHED"
  | "ACTOR_IS_INITIATOR"
  | "ACTOR_IS_BENEFICIARY"
  | "ACTOR_ALREADY_DECIDED_ANOTHER_STAGE";

export type StageDecidability =
  | { decidable: true }
  | { decidable: false; reason: StageDecidabilityReason };

/**
 * Prédicat pur — aucune lecture, l'appelant fournit déjà tout — partagé entre
 * `decideStage` (contrôle bloquant, avec message d'erreur spécifique par
 * motif) et `listMyApprovals` (filtre de visibilité : une étape que cet
 * acteur ne pourrait de toute façon pas décider ne doit pas apparaître dans
 * sa liste, pour éviter les résultats "en erreur" mystérieux d'une
 * approbation en lot). Seule source de vérité pour ces deux règles :
 *
 * - Ordre des étapes : une étape ne peut être décidée que si toutes les
 *   étapes de séquence inférieure sont déjà APPROVE (jamais de saut d'étape,
 *   ex. CISO avant le chef de département).
 * - Indépendance : ni l'initiateur, ni le bénéficiaire, ni un acteur ayant
 *   déjà décidé une autre étape de la même version.
 *
 * Ne couvre PAS l'éligibilité de rôle (CISO/COO/DEPARTMENT_HEAD scopé
 * département) ni la revalidation catalogue/niveau/affectation : ces
 * contrôles-là dépendent de lectures fraîches (rôles effectifs, catalogue) et
 * restent propres à `decideStage`.
 *
 * Retourne une union discriminée (plutôt qu'un booléen + `reason: X | null`)
 * pour que `decideStage` puisse lire `decidability.reason` sans cast : dans
 * la branche `!decidability.decidable`, TypeScript narrowe déjà `reason` en
 * `StageDecidabilityReason` (jamais `null`).
 */
export function isStageDecidable(
  stage: { id: string; sequence: number },
  allStages: { id: string; sequence: number; decision: string | null; actorId: string | null }[],
  versionInitiatorId: string,
  beneficiaryId: string,
  actorId: string
): StageDecidability {
  const priorStagesNotYetApproved = allStages.some(
    (s) => s.sequence < stage.sequence && s.decision !== "APPROVE"
  );
  if (priorStagesNotYetApproved) {
    return { decidable: false, reason: "SEQUENCE_NOT_REACHED" };
  }
  if (actorId === versionInitiatorId) {
    return { decidable: false, reason: "ACTOR_IS_INITIATOR" };
  }
  if (actorId === beneficiaryId) {
    return { decidable: false, reason: "ACTOR_IS_BENEFICIARY" };
  }
  if (allStages.some((s) => s.actorId === actorId && s.id !== stage.id)) {
    return { decidable: false, reason: "ACTOR_ALREADY_DECIDED_ANOTHER_STAGE" };
  }
  return { decidable: true };
}
