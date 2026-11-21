// The print document of the editor's Print command (editor-ui §13.1; ARCHITECTURE.md 1.4 note 2).
// Owner: E6.
//
// The original draws the text line by line on the printer's canvas (mainS.cpp:409-512). The port
// builds one self-contained HTML page with the same content and hands it to `Platform.print`,
// which shows the system's print dialog (browser or desktop app). The rules kept:
//
//   - the text is the selection or the whole document (the caller decides);
//   - every tab character is expanded with the document's own rule (tabs.ts);
//   - the document's editor font and size; monochrome (black on white, no syntax colours);
//   - no header, no line numbers, no word wrap: an over-long line is clipped at the page edge;
//   - a line that is exactly the page marker is not printed and starts a new page.
//
// Page breaks. The original prints `PageHeight / TextHeight("W")` lines per page and starts a new
// page after a marker line. The number of lines per page is the browser's to decide (it knows the
// paper), so the page holds the text as blocks separated by forced page breaks, one block per
// stretch of text between markers, and the browser breaks long blocks by itself. The blocks follow
// the original's loop exactly:
//
//   - a marker on the first line gives an empty first page; two markers in a row give an empty
//     page between them;
//   - a marker on the last line gives no empty page after it (the loop ends), but an empty page
//     that was already started stays (a text ending in two markers ends with an empty page);
//   - an empty text gives one empty page;
//   - like the original's edit control, a text that ends with a line break has no extra empty
//     line at the end.
//
// The page has no script (the desktop app prints from a window without JavaScript) and no
// external resource. Its colours are literal black and white: the application's design tokens
// do not exist inside it, and paper is white in both themes.

import type { TabType } from '../../contracts';
import { expandTabs } from './tabs';

/** NEW_PAGE_MARKER of asm.h:261; the assembler's PAGE directive writes it into listings. */
export const NEW_PAGE_MARKER = '<------------------------------ PAGE ------------------------------>';

export interface PrintSource {
  /** The text to print (the selection or the whole document), lines separated by "\n". */
  text: string;
  tabType: TabType;
  tabSize: number;
  /** The document's font, as stored in its trailer (`DocumentState.fontName` / `fontSize`). */
  fontName: string;
  fontSize: number;
  /** The document's path, or its name while it has none (`Project.CurrentFile`). */
  file: string;
}

export interface PrintDocument {
  /** The job title of the original: `EASy68K ` + the document's path. */
  title: string;
  /** The pages forced by markers; each is a list of lines (tabs expanded). */
  pages: string[][];
  /** The page handed to Platform.print. */
  html: string;
}

/** The lines of a text as the original's edit control counts them (no empty line after a final break). */
export function printLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Splits lines into the pages the marker lines force (see the top of this file). The result has
 * at least one page; a page can be empty.
 */
export function splitPages(lines: readonly string[]): string[][] {
  const pages: string[][] = [[]];
  let markers = 0;
  for (const line of lines) {
    if (line === NEW_PAGE_MARKER) {
      pages.push([]);
      markers++;
    } else {
      pages[pages.length - 1]!.push(line);
    }
  }
  // A marker on the last line: the loop ends without starting the page that would follow it.
  if (markers > 0 && lines[lines.length - 1] === NEW_PAGE_MARKER) pages.pop();
  return pages;
}

/** Text for HTML element content. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** CSS font-family for the document's font: its own name first, then fixed-pitch fallbacks. */
export function printFontFamily(name: string): string {
  const clean = name.replace(/["\\<>\n\r;{}]/g, '').trim();
  const first = clean.length > 0 ? `"${clean}", ` : '';
  return `${first}"Courier New", Courier, monospace`;
}

/** CSS font size in points; a size that makes no sense prints at the default 10 pt. */
export function printFontSize(points: number): number {
  return Number.isFinite(points) && points >= 4 && points <= 96 ? points : 10;
}

/**
 * Builds the print document. Throws `PrintTabSizeError` (tabs.ts) when the text has a tab
 * character and the fixed tab size is 0; the original's print job fails there.
 */
export function buildPrintDocument(source: PrintSource): PrintDocument {
  const expanded = expandTabs(source.text, source.tabType, source.tabSize);
  const pages = splitPages(printLines(expanded));
  const title = `EASy68K ${source.file}`;
  const family = printFontFamily(source.fontName);
  const size = printFontSize(source.fontSize);
  // An empty page holds one blank, so that the browser prints it as a page of its own. The line
  // break right after <pre> is there because the HTML parser drops one there: without it, an empty
  // first line would be lost.
  const body = pages
    .map((lines) => {
      const content = lines.join('\n');
      return `<pre class="page">\n${content === '' ? ' ' : escapeHtml(content)}</pre>`;
    })
    .join('\n');
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="color-scheme" content="light">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    '@page { margin: 12mm; }',
    'html, body { margin: 0; padding: 0; background: #fff; color: #000; }',
    'body { print-color-adjust: economy; -webkit-print-color-adjust: economy; }',
    `.page { margin: 0; padding: 0; font-family: ${family}; font-size: ${size}pt; line-height: normal;`,
    '  font-weight: normal; font-style: normal; color: #000; background: none;',
    '  white-space: pre; overflow: hidden; tab-size: 8; }',
    '.page + .page { break-before: page; page-break-before: always; }',
    '</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { title, pages, html };
}
