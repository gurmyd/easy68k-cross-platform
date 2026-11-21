// The decisions of the "sim-files" feature as plain functions, tested under Node:
//
// - the task 58 dialog (trap15-a task 58; ARCHITECTURE.md 3.8.4, 3.8.5): what the program's title,
//   filter and file name become in the application's file dialog;
// - the print jobs of task 10 (3.8.4): which are still waiting, what a job looks like as text in the
//   Printer Output dialog, and the document Platform.print receives.
//
// Owner: SH6.

import type {
  AppContext,
  FileFilter,
  OpenRequest,
  PrintJob,
  SaveRequest,
  SimFileDialogProps,
  SimFileDialogResult,
  VPath,
} from '../../contracts';
import { codePointForByte } from '../../core/codec/cp1252';
import { basename, dirname, isRooted, isVPath, mountOf, resolveLexically } from '../../core/paths/winpath';
import { PAGE_HEIGHT, PAGE_WIDTH, PRINTER_DPI, printerCell } from '../../core/sim-host/printer';

/* ================================================================== task 58 */

/** The id of the task 58 dialog (2.7; contracts/features.ts). */
export const FILE_DIALOG_ID = 'sim.fileDialog';

/** The titles Windows gives a common dialog whose program passed none (trap15-a §10 item 13). */
export const DEFAULT_OPEN_TITLE = 'Open';
export const DEFAULT_SAVE_TITLE = 'Save As';

/** The one filter of a program that passed none: every file, as Windows shows them all. */
export const ALL_FILES_FILTER: FileFilter = { label: 'All Files (*.*)', patterns: ['*.*'] };

/**
 * The program's filter string as file filters. The engine passes `"<list>|<list>"` (the pattern list
 * is also its own description, trap15-a task 58) or an empty string; a general Windows filter
 * ("Text|*.txt|All|*.*") is read the same way. Patterns are separated by ';'.
 */
export function parseProgramFilter(filter: string): FileFilter[] {
  const parts = filter.split('|');
  const out: FileFilter[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const patterns = (parts[i + 1] as string)
      .split(';')
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern !== '');
    if (patterns.length > 0) out.push({ label: parts[i] as string, patterns });
  }
  return out.length > 0 ? out : [ALL_FILES_FILTER];
}

/**
 * The program's initial file name as a VPath, if it names one: relative to the current directory,
 * or an absolute path the port hands out (a VPath; in the desktop app a real path).
 */
export function initialPath(initialName: string, currentDir: VPath | null): VPath | null {
  const name = initialName.trim();
  if (name === '') return null;
  if (isRooted(name)) {
    const slashed = name.replace(/\\/g, '/');
    const path = currentDir !== null && mountOf(currentDir) === 'disk' ? `/disk${slashed}` : slashed;
    return isVPath(path) ? path : null;
  }
  return currentDir === null ? null : resolveLexically(currentDir, name);
}

export type ProgramDialogRequest = { kind: 'open'; request: OpenRequest } | { kind: 'save'; request: SaveRequest };

/** What the task 58 dialog asks of the application's file dialogs (FileDialogs, 3.8.5). */
export function programDialogRequest(props: SimFileDialogProps, currentDir: VPath | null): ProgramDialogRequest {
  const filters = parseProgramFilter(props.filter);
  const initial = initialPath(props.initialName, currentDir);
  if (props.mode === 1) {
    const request: SaveRequest = {
      title: props.title || DEFAULT_SAVE_TITLE,
      filters,
      // The original's Save dialog has no default extension and does not ask before overwriting
      // (trap15-a task 58): the program decides what to do with the name.
      defaultExt: '',
      overwritePrompt: null,
      // Without a name the dialog starts in the program's current directory (contract C1, gate I2).
      ...(initial ? { suggested: initial } : currentDir ? { startDir: currentDir } : {}),
    };
    return { kind: 'save', request };
  }
  const startDir = initial ? dirname(initial) : currentDir;
  const request: OpenRequest = {
    title: props.title || DEFAULT_OPEN_TITLE,
    filters,
    multiple: false,
    ...(startDir ? { startDir } : {}),
    // The original's Open dialog shows the program's name in its File name field (contract C1).
    ...(initial ? { initialName: basename(initial) } : {}),
  };
  return { kind: 'open', request };
}

/** Shows the task 58 dialog through ctx.fileDialogs; resolves to the chosen file or null (Cancel). */
export async function showProgramFileDialog(
  ctx: Pick<AppContext, 'fileDialogs'> & { sim: { files: { currentDir: VPath | null } } },
  props: SimFileDialogProps,
): Promise<SimFileDialogResult> {
  const choice = programDialogRequest(props, ctx.sim.files.currentDir);
  if (choice.kind === 'save') return (await ctx.fileDialogs.save(choice.request)) ?? null;
  const paths = await ctx.fileDialogs.open(choice.request);
  return paths?.[0] ?? null;
}

/* ================================================================== print jobs */

/** The id of the Printer Output dialog (not in the list of 2.7; docs/porting/errata/SH6.md). */
export const PRINTER_OUTPUT_DIALOG_ID = 'sim.printerOutput';
export const PRINTER_OUTPUT_TITLE = 'Printer Output';

/** The jobs of a session that were neither printed nor discarded, and the jobs' numbers. */
export class PrintJobList {
  private readonly done = new WeakSet<PrintJob>();
  private readonly numbers = new WeakMap<PrintJob, number>();
  private counted = 0;

  constructor(private readonly all: () => readonly PrintJob[]) {}

  /** Waiting jobs, oldest first. */
  waiting(): PrintJob[] {
    return this.all().filter((job) => !this.done.has(job));
  }

  /** 1 for the first job of the session, 2 for the second ... */
  numberOf(job: PrintJob): number {
    for (const each of this.all()) if (!this.numbers.has(each)) this.numbers.set(each, ++this.counted);
    return this.numbers.get(job) ?? 0;
  }

  /** Printed or discarded: no longer listed. */
  settle(job: PrintJob): void {
    this.done.add(job);
  }
}

/** One line of the dialog's list: `Job 1 - 3 lines, 42 characters - Courier New 10`. */
export function jobLabel(job: PrintJob, number: number): string {
  const lines = new Set(job.chars.map((c) => c.y)).size;
  const count = job.chars.length;
  return (
    `Job ${number} - ${lines} ${lines === 1 ? 'line' : 'lines'}, ${count} ${count === 1 ? 'character' : 'characters'}` +
    ` - ${job.font.name} ${job.font.size}`
  );
}

/** The job as text, one line per printed row, each character in its column (the dialog's preview). */
export function jobText(job: PrintJob): string {
  const cell = printerCell(job.font.size);
  const left = Math.floor(PAGE_WIDTH / 8);
  const top = Math.floor(PAGE_HEIGHT / 11);
  const rows = new Map<number, string[]>();
  for (const { x, y, ch } of job.chars) {
    const row = Math.max(0, Math.round((y - top) / cell.rowHeight));
    const col = Math.max(0, Math.round((x - left) / cell.colWidth));
    const line = rows.get(row) ?? [];
    while (line.length < col) line.push(' ');
    line[col] = String.fromCodePoint(codePointForByte(ch));
    rows.set(row, line);
  }
  const last = Math.max(-1, ...rows.keys());
  const out: string[] = [];
  for (let row = 0; row <= last; row++) out.push((rows.get(row) ?? []).join('').replace(/\s+$/, ''));
  return out.join('\n');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inches = (pixels: number) => `${(pixels / PRINTER_DPI).toFixed(4)}in`;

/**
 * The document Platform.print receives for a job: one 8.5 x 11 inch page with every character at
 * its position on the virtual page (600 pixels per inch), in the job's font. Black on white: it is
 * paper, whatever the application's theme.
 */
export function jobHtml(job: PrintJob, title: string): string {
  const family = `'${job.font.name.replace(/['\\]/g, '')}', 'Courier New', monospace`;
  const spans = job.chars
    .map(({ x, y, ch }) => {
      const glyph = escapeHtml(String.fromCodePoint(codePointForByte(ch)));
      return `<span style="left:${inches(x)};top:${inches(y)}">${glyph}</span>`;
    })
    .join('');
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    '@page { size: 8.5in 11in; margin: 0; }',
    'html, body { margin: 0; padding: 0; background: #fff; }',
    `.page { position: relative; width: 8.5in; height: 11in; overflow: hidden; color: #000;`,
    `  font-family: ${family}; font-size: ${job.font.size}pt; line-height: 1; }`,
    '.page span { position: absolute; white-space: pre; }',
    '</style></head>',
    `<body><div class="page">${spans}</div></body></html>`,
  ].join('\n');
}

/** The title of a printed job (the print dialog shows it; a PDF printer suggests it as the name). */
export function jobTitle(number: number): string {
  return `EASy68K printer output ${number}`;
}
