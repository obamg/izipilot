/**
 * Constantes et helpers de pièces jointes — purs, sans accès disque, donc
 * importables depuis un composant client (le formulaire d'upload en a besoin
 * pour l'attribut `accept` et la vérification de taille avant envoi).
 * L'écriture/lecture réelle vit dans lib/storage.ts, côté serveur uniquement.
 */

/** 10 Mo — au-delà, c'est un partage de fichier, pas une pièce jointe. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Types acceptés. Volontairement restrictif : captures d'écran, documents et
 * exports, ce qui couvre les demandes IT réelles. Pas d'archives ni
 * d'exécutables — ils ne servent qu'à faire transiter des binaires.
 */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export function isAllowedMimeType(mime: string): boolean {
  return Object.hasOwn(ALLOWED_MIME_TYPES, mime);
}

/** Valeur de l'attribut `accept` d'un `<input type="file">`. */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_MIME_TYPES).join(",");

/** Taille lisible pour l'UI ("1,4 Mo"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
