// The printer page device of task 10 (ARCHITECTURE.md 3.8.4, end).
//
// STUB written by W1 (wave 0). SH6 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub prints nothing and answers
// printerMetric with the engine's default, 0.
//
// Owner: W1 > SH6.

import type { PrinterDeps, PrinterDeviceApi } from '../../contracts';

export type { PrintedChar, PrinterDeps, PrintJob } from '../../contracts';

export class PrinterDevice implements PrinterDeviceApi {
  constructor(private readonly deps: PrinterDeps) {}

  fontChanged(): void {}
  resetToStartup(): void {}
  printerBeginDoc(): void {}
  printerEndDoc(): void {}
  printerMetric(_which: number): number {
    return 0;
  }
  printerTextOut(_x: number, _y: number, _ch: number): void {}
}
