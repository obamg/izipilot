export interface AuditEventInput {
  orgId: string;
  actorId: string;
  actorRole: string | null;
  primaryCoveredId: string | null;
  scopeType: string;
  scopeId: string | null;
  eventType: string;
  objectType: string;
  objectId: string;
  objectVersion: number | null;
  beneficiaryId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  outcome: string;
  correlationId: string | null;
}

/**
 * Construit l'événement d'audit à écrire. Fonction identité pour l'instant :
 * son rôle est de fixer la forme unique par laquelle toute mutation du
 * module passe, pour qu'aucun appelant n'improvise ses propres champs.
 */
export function buildAuditEvent(input: AuditEventInput): AuditEventInput {
  return { ...input };
}

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/**
 * Échappement CSV contre l'injection de formule (spec §13 : "Escape
 * formula-like text in CSV exports"). Un champ commençant par =, +, - ou @
 * est préfixé d'une apostrophe pour qu'Excel/Sheets le traite comme du texte.
 */
export function escapeCsvField(value: string): string {
  let field = value;
  if (FORMULA_PREFIXES.some((p) => field.startsWith(p))) {
    field = `'${field}`;
  }
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    field = `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}
