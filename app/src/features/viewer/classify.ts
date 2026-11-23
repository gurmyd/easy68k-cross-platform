// What opens where (ARCHITECTURE-PLUS P3.4.1). Owner: N6. Pure; runs under Node.
//
//   .X68, .L68, .S68 (any letter case)                  text, always, as in the original
//   .pdf                                                 the PDF viewer
//   .png .jpg .jpeg .gif .bmp .webp .svg .ico            the picture viewer
//   any other file with a zero byte in its first 8,192   the notice
//   anything else                                        text, as today
//
// Extensions are compared in any letter case (erratum N6 1). The type of a picture's blob is that
// of its extension, never one sniffed from the bytes (P3.4.2).

import type { Bytes } from '../../contracts';
import { extractFileExt } from '../../core/paths/winpath';

/** What the viewer shows for a file; null = the file opens as text. */
export type ViewerKind = 'pdf' | 'picture' | 'notice';

/** How many bytes are looked at for a zero byte (P3.4.1). */
export const BINARY_PROBE_BYTES = 8192;

/** The extensions that always open as text (the original's own files). */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.x68', '.l68', '.s68']);

/** The picture extensions with the type of their blob (P3.4.2). */
export const PICTURE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
});

/** The type of a PDF's blob (P3.4.2). */
export const PDF_TYPE = 'application/pdf';
/** The type of every download by Export (P3.4.2). */
export const EXPORT_TYPE = 'application/octet-stream';

function extensionOf(path: string): string {
  return extractFileExt(path).toLowerCase();
}

/** True when the first 8,192 bytes hold a zero byte. */
export function looksBinary(bytes: Bytes): boolean {
  const end = Math.min(bytes.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/** The table of P3.4.1: what the viewer shows for `path` with these bytes, or null for text. */
export function viewerKindOf(path: string, bytes: Bytes): ViewerKind | null {
  const ext = extensionOf(path);
  if (TEXT_EXTENSIONS.has(ext)) return null;
  if (ext === '.pdf') return 'pdf';
  if (Object.hasOwn(PICTURE_TYPES, ext)) return 'picture';
  return looksBinary(bytes) ? 'notice' : null;
}

/** The type of the blob the viewer makes for `path` of this kind. */
export function blobTypeOf(path: string, kind: ViewerKind): string {
  if (kind === 'pdf') return PDF_TYPE;
  if (kind === 'picture') return PICTURE_TYPES[extensionOf(path)] ?? EXPORT_TYPE;
  return EXPORT_TYPE;
}
