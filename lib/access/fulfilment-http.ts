// lib/access/fulfilment-http.ts
// Réponses HTTP communes aux routes /api/access/tasks/** (phase 3b, D-8,
// D-22) : messages en français et `code` distinguable (FP:337) —
// NOT_FOUND → 404, STALE / INVALID_TRANSITION → 409, VALIDATION → 400.
import { FulfilmentError, fulfilmentErrorStatus } from "./fulfilment-server";

export function unauthenticated(): Response {
  return Response.json({ error: "Non authentifié" }, { status: 401 });
}

export function validationError(details: unknown): Response {
  return Response.json({ error: "Données invalides", code: "VALIDATION", details }, { status: 400 });
}

/** Corps JSON, ou `null` s'il est absent ou illisible (→ 400 par le schéma Zod). */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function fulfilmentErrorResponse(err: unknown): Response {
  if (err instanceof FulfilmentError) {
    return Response.json({ error: err.message, code: err.code }, { status: fulfilmentErrorStatus(err.code) });
  }
  throw err;
}
