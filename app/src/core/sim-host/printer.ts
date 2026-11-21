// The printer page device of task 10 (ARCHITECTURE.md 3.8.4, end).
//
// The engine keeps the original's page logic (trap15-a task 10: margins, line and form feeds, the
// carried-over overshoot at the right margin). This device is the printer it talks to: a virtual
// page of 8.5 x 11 inches at 600 pixels per inch, whose cell width and row height follow the
// Printer Font setting, and which collects the characters drawn between BeginDoc and EndDoc. Each
// EndDoc - a form feed, or a page overflow - submits one print job, which the Printer Output
// dialog (features/sim-files) lists until it is printed (Platform.print) or discarded.
//
// Owner: W1 > SH6.

import { PrinterMetric, type PrintJob, type PrinterDeps, type PrinterDeviceApi } from '../../contracts';

export type { PrintedChar, PrinterDeps, PrintJob } from '../../contracts';

/** Printer pixels per inch of the virtual page. */
export const PRINTER_DPI = 600;
/** 8.5 x 11 inches. */
export const PAGE_WIDTH = 5100;
export const PAGE_HEIGHT = 6600;

/**
 * The character cell of a font on the virtual page: TextWidth("W") and TextHeight("Xp") as a
 * fixed-pitch font of that size measures at 600 dpi (3.8.4).
 */
export function printerCell(size: number): { colWidth: number; rowHeight: number } {
  const pixels = (Math.max(1, size) * PRINTER_DPI) / 72;
  return { colWidth: Math.max(1, Math.round(pixels * 0.6)), rowHeight: Math.max(1, Math.round(pixels * 1.13)) };
}

export class PrinterDevice implements PrinterDeviceApi {
  private readonly deps: PrinterDeps;
  private job: PrintJob | null = null;

  constructor(deps: PrinterDeps) {
    this.deps = deps;
  }

  /** The job being collected, if a document is open (for tests and the session). */
  get openJob(): PrintJob | null {
    return this.job;
  }

  /**
   * Options > Printer Font, or a simulator reset. The metrics are read from the setting at every
   * question, so nothing is cached here; an open document keeps the font it was started with.
   */
  fontChanged(): void {}

  /** No open job afterwards; one that was open is submitted as it stands. */
  resetToStartup(): void {
    this.finish();
  }

  printerBeginDoc(): void {
    // The original's printer would refuse a second BeginDoc ("Printing in progress"); the engine
    // asks for one only after Options > Printer Font abandoned a document. The port ends the old
    // job and starts a new one (docs/differences/SH6.md).
    this.finish();
    this.job = this.newJob();
  }

  printerEndDoc(): void {
    // A form feed with no open document still makes the engine begin one first; an EndDoc alone
    // would be an empty page.
    if (!this.job) this.job = this.newJob();
    this.finish();
  }

  printerMetric(which: number): number {
    const cell = printerCell(this.deps.font().size);
    switch (which) {
      case PrinterMetric.RowHeight:
        return cell.rowHeight;
      case PrinterMetric.ColWidth:
        return cell.colWidth;
      case PrinterMetric.PageHeight:
        return PAGE_HEIGHT;
      case PrinterMetric.PageWidth:
        return PAGE_WIDTH;
      default:
        return 0;
    }
  }

  printerTextOut(x: number, y: number, ch: number): void {
    if (!this.job) this.job = this.newJob(); // the engine always begins first; be safe
    this.job.chars.push({ x, y, ch: ch & 0xff });
  }

  private newJob(): PrintJob {
    const font = this.deps.font();
    return { font: { name: font.name, size: font.size }, chars: [] };
  }

  private finish(): void {
    const job = this.job;
    this.job = null;
    if (job) this.deps.submit(job);
  }
}
