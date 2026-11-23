// The texts of the viewer (ARCHITECTURE-PLUS P3.4.2), exactly as the document gives them.
// Owner: N6. The code and the tests use these constants; N10's guide check compares them.

/** The strip's button that opens the file as a document (P3.4.2). */
export const OPEN_AS_TEXT = 'Open as Text';
/** The strip's and the notice's button that downloads the file (web only, P3.4.2). */
export const EXPORT = 'Export';
/** The pictures' toggle: pressed = 1:1, not pressed = scaled to fit (P3.4.2). */
export const ACTUAL_SIZE = 'Actual Size';

/** The line under the strip of a PDF viewer, in a browser (P3.4.2). */
export const PDF_HINT_WEB = 'If the PDF does not appear, use Export and open it with another program.';
/** The same line in the desktop app (P3.4.2). */
export const PDF_HINT_DESKTOP = 'If the PDF does not appear, open it from its folder with another program.';

/** The `title` of a PDF's frame: `PDF: report.pdf` (P3.4.2). */
export function pdfFrameTitle(name: string): string {
  return `PDF: ${name}`;
}

/** The notice for another file that is not text, and for a picture that fails to decode (P3.4.2). */
export function noticeText(name: string): string {
  return `"${name}" does not look like text. Opened as text, it will probably look like nonsense.`;
}

/** The notice for a PDF where the browser shows none (`navigator.pdfViewerEnabled` false, P3.4.2). */
export function pdfNoticeText(name: string): string {
  return `"${name}" cannot be shown here because this browser does not show PDF files.`;
}

/**
 * The file's size in the strip. P3.4.2 names "the size" without a form; this one follows the
 * figures of P3.5 ("3.4 MB"): bytes below 1,000, then kB and MB with one decimal (erratum N6 2).
 */
export function sizeText(bytes: number): string {
  if (bytes === 1) return '1 byte';
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 999_950) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
