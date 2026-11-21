// The Printer Output dialog's state per window: the waiting jobs, and whether the dialog is open.
//
// Owner: SH6.

import type { AppContext } from '../../contracts';
import { PRINTER_OUTPUT_DIALOG_ID, PrintJobList } from './logic';

/** Props of the dialog `sim.printerOutput`. */
export interface PrinterOutputProps {
  /** Opened by Printer Setup... (modal, holds the program as the original's set-up dialog does) or
   *  by a finished job (modeless: the program goes on printing). */
  modal: boolean;
}

interface PrinterState {
  list: PrintJobList;
  /** Closes the open dialog; null while none is open. */
  close: (() => void) | null;
  /** Dialogs asked for and not closed yet. */
  opening: number;
}

const states = new WeakMap<AppContext, PrinterState>();

export function printerStateOf(ctx: AppContext): PrinterState {
  let state = states.get(ctx);
  if (!state) {
    state = { list: new PrintJobList(() => ctx.sim.printJobs ?? []), close: null, opening: 0 };
    states.set(ctx, state);
  }
  return state;
}

/** True while the Printer Output dialog is open (or being opened). */
export function printerOutputOpen(ctx: AppContext): boolean {
  const state = printerStateOf(ctx);
  return state.opening > 0 || state.close !== null;
}

/** Opens the Printer Output dialog; an open modeless one is closed first when a modal one is asked for. */
export async function openPrinterOutput(ctx: AppContext, modal: boolean): Promise<void> {
  const state = printerStateOf(ctx);
  if (printerOutputOpen(ctx)) {
    if (!modal) return; // already on screen
    state.close?.();
  }
  state.opening++;
  try {
    await ctx.dialogs.open<PrinterOutputProps, void>(
      PRINTER_OUTPUT_DIALOG_ID,
      { modal },
      modal ? { modal: true } : { modal: false, holdsProgram: false },
    );
  } finally {
    state.opening--;
  }
}
