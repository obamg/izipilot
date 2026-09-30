// lib/access/request-labels.ts
// Libellés français des états d'une demande pour « Mes demandes » (phase 3b,
// spec §8). Logique pure : utilisable côté serveur comme côté client.

export interface RequestStateLabelInput {
  state: string;
  periodStart: string;
  completedAt: string | null;
  taskReason: string | null;
  cancelRequested: boolean;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}

export function requestStateLabel(input: RequestStateLabelInput): string {
  const suffix = input.cancelRequested ? " · annulation demandée" : "";
  switch (input.state) {
    case "PENDING_APPROVAL":
      return "En attente d'approbation";
    case "CLARIFICATION_REQUIRED":
      return "Clarification demandée";
    case "REVISION_REQUIRED":
      return "À réviser";
    case "AUTHORIZED_WAITING_START":
      return `Autorisée — début le ${day(input.periodStart)}`;
    case "READY_FOR_FULFILMENT":
      return "Prête — en attente du propriétaire";
    case "IN_PROGRESS":
      return `En cours d'exécution${suffix}`;
    case "BLOCKED":
      return `Bloquée : ${input.taskReason ?? "motif non précisé"}${suffix}`;
    case "COMPLETED":
      return input.completedAt ? `Exécutée le ${day(input.completedAt)}` : "Exécutée";
    case "REJECTED":
      return "Rejetée";
    case "CANCELLED":
      return "Annulée";
    default:
      return input.state;
  }
}

export const REQUEST_KIND_LABELS: Record<string, string> = {
  GRANT: "Octroi",
  UPGRADE: "Montée de niveau",
  RENEW: "Renouvellement",
  REDUCE: "Réduction",
  REVOKE: "Révocation",
};

/**
 * Action d'annulation offerte à l'initiateur (D-19) : annulation effective
 * avant réclamation, simple demande après, plus rien une fois demandée ou
 * la demande terminée.
 */
export function cancelActionFor(state: string, cancelRequested: boolean): "CANCEL" | "REQUEST_CANCEL" | null {
  if (
    state === "PENDING_APPROVAL" ||
    state === "CLARIFICATION_REQUIRED" ||
    state === "REVISION_REQUIRED" ||
    state === "AUTHORIZED_WAITING_START" ||
    state === "READY_FOR_FULFILMENT"
  ) {
    return "CANCEL";
  }
  if ((state === "IN_PROGRESS" || state === "BLOCKED") && !cancelRequested) return "REQUEST_CANCEL";
  return null;
}
