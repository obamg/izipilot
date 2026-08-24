/**
 * Stockage de fichiers sur disque local (volume Docker monté sur UPLOAD_DIR).
 * Pas de dépendance externe : l'app tourne sur un VPS, pas sur Vercel, donc le
 * système de fichiers est persistant tant que le volume l'est.
 *
 * Règles de sûreté appliquées ici, à ne pas contourner ailleurs :
 *  - le nom de fichier fourni par l'utilisateur n'entre JAMAIS dans le chemin ;
 *    on génère une clé opaque et on garde le nom d'origine en base, pour
 *    l'affichage et le Content-Disposition uniquement ;
 *  - toute lecture revérifie que le chemin résolu reste sous la racine, ce qui
 *    neutralise une clé forgée contenant "..".
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALLOWED_MIME_TYPES, isAllowedMimeType, MAX_ATTACHMENT_BYTES } from "./attachments";

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "./var/uploads");
}

/**
 * Résout une clé de stockage en chemin absolu, en refusant tout ce qui sort de
 * la racine. Throw plutôt que retourner null : un appelant qui ignore le cas
 * d'erreur ne doit pas se retrouver à lire un fichier arbitraire.
 */
function resolveKey(storageKey: string): string {
  const root = uploadRoot();
  const full = path.resolve(root, storageKey);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return full;
}

export interface StoredFile {
  storageKey: string;
  size: number;
}

/**
 * Écrit une pièce jointe et renvoie sa clé. Le nom de fichier généré est un
 * UUID + l'extension déduite du type MIME (jamais celle du nom d'origine).
 */
export async function storeAttachment(
  scope: string,
  data: Buffer | Uint8Array,
  mimeType: string
): Promise<StoredFile> {
  if (!isAllowedMimeType(mimeType)) {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("File too large");
  }
  // `scope` vient d'un id cuid généré côté serveur, mais on le nettoie quand
  // même — c'est la seule partie du chemin qui n'est pas un UUID d'ici.
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeScope) throw new Error("Invalid storage scope");

  const storageKey = `${safeScope}/${randomUUID()}${ALLOWED_MIME_TYPES[mimeType]}`;
  const full = resolveKey(storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return { storageKey, size: data.byteLength };
}

export async function readAttachment(storageKey: string): Promise<Buffer> {
  return readFile(resolveKey(storageKey));
}

/**
 * Supprime le fichier. Ne throw pas si le fichier a déjà disparu : la ligne en
 * base fait foi, et un orphelin sur disque ne doit pas bloquer la suppression.
 */
export async function deleteAttachment(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }
}

/** Nom de fichier assaini pour l'en-tête Content-Disposition. */
export function safeDownloadName(filename: string): string {
  const base = path.basename(filename).replace(/["\\\r\n]/g, "");
  return base.slice(0, 120) || "fichier";
}
