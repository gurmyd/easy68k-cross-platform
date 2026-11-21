// Feature "sim-files": the task 58 file dialog, the printer output.
//
//   SimFileDialog.tsx        the dialog `sim.fileDialog` (TRAP #15 task 58, 3.8.4): the application's
//                            file dialog with the program's title and filter
//   PrinterOutputDialog.tsx  the dialog `sim.printerOutput`: the print jobs of task 10, printed
//                            through Platform.print or discarded
//   logic.ts                 the decisions of both, as plain functions
//   printer-state.ts         the waiting jobs and the dialog's state per window
//
// Commands: `sim.file.printerSetup` (File > Printer Setup...) opens the Printer Output dialog,
// because a page cannot open a printer set-up of its own (1.4 note 2): the printer is chosen in the
// system print dialog that Print... opens. A finished job opens the dialog (modeless) as well.
//
// The program's files themselves (core/sim-host/files) and the printer device (core/sim-host/
// printer.ts) are framework-free and built by the run session (features/run, SH8).
//
// Owner: W3 > SH6.

import type { AppContext, FeatureModule } from '../../contracts';
import { FILE_DIALOG_ID, PRINTER_OUTPUT_DIALOG_ID } from './logic';
import { PrinterOutputDialog } from './PrinterOutputDialog';
import { openPrinterOutput } from './printer-state';
import { SimFileDialog } from './SimFileDialog';

const report = (error: unknown): void => console.error('Simulator: the Printer Output dialog failed:', error);

function init(ctx: AppContext): (() => void) | void {
  // A finished job is shown at once, without holding the program (it may go on printing).
  return ctx.sim.onPrintJob?.(() => {
    void openPrinterOutput(ctx, false).catch(report);
  });
}

export const feature: FeatureModule = {
  id: 'sim-files',
  commands: {
    // Always enabled, also while a program runs (sim-ui §3.4).
    'sim.file.printerSetup': {
      run: (ctx) => {
        void openPrinterOutput(ctx, true).catch(report);
      },
    },
  },
  dialogs: {
    [FILE_DIALOG_ID]: SimFileDialog,
    [PRINTER_OUTPUT_DIALOG_ID]: PrinterOutputDialog,
  },
  init,
};
