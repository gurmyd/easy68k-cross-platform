// The viewer's browser side: its `blob:` URLs and Export's download (ARCHITECTURE-PLUS P3.4.2).
// Owner: N6.
//
// Every blob is made from bytes the page has read, with an explicit type: the viewer's own
// (application/pdf, the picture types of classify.ts) or, for Export, application/octet-stream,
// so that a browser never treats a download as a document to show. No viewer blob is ever put into
// a link, a new window or a frame other than the viewer's own.

import type { Bytes } from '../../contracts';
import { EXPORT_TYPE } from './classify';
import type { ObjectUrls } from './model';

/** How long Export keeps its URL: Safari starts a download asynchronously. */
export const EXPORT_URL_LIFETIME_MS = 60_000;

/** URL.createObjectURL and revokeObjectURL with the explicit type. */
export const browserObjectUrls: ObjectUrls = {
  create: (bytes, type) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })),
  revoke: (url) => URL.revokeObjectURL(url),
};

/** Export on the web: offers the bytes as a download named `name`, always as application/octet-stream. */
export function downloadFile(name: string, bytes: Bytes): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: EXPORT_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), EXPORT_URL_LIFETIME_MS);
}

/** `navigator.pdfViewerEnabled`; true where the browser does not say (it then tries the frame). */
export function browserPdfViewerEnabled(): boolean {
  if (typeof navigator === 'undefined') return true;
  return (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
}
