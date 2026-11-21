// Feature "sim-main": the Registers, Listing and Messages panels of Simulator mode - the panes of
// the original main window (ARCHITECTURE.md 2.3, 3.11.3, 3.11.4, 4.6; sim-ui §4-§7).
//
// Contributes:
//   panels    `registers`, `listing` (with the breakpoint gutter), `messages` (Simulator mode)
//   dialog    `sim.find` (Search > Find..., modeless)
//   commands  `sim.search.find`, `sim.search.gotoPC`, `sim.bp.clearAllPC`, `sim.cycles.clear`
//   init      the window's SimMainModel (model.ts), which follows the run controller
//
// The behaviour lives in model.ts (state and actions, tested under Node with the real engine);
// the components only draw it.
//
// Owner: W3 > U1.

import type { AppContext, FeatureModule } from '../../contracts';
import { FindDialog, FIND_DIALOG_ID } from './FindDialog';
import { ListingPanel } from './ListingPanel';
import { MessagesPanel } from './MessagesPanel';
import { attachSimMain, simMainOf } from './model';
import { RegistersPanel } from './RegistersPanel';
import './sim-main.css';

/** True while the Find dialog of this window is open. */
function findDialogOpen(ctx: AppContext): boolean {
  return ctx.store.getState().dialogs.stack.some((dialog) => dialog.id === FIND_DIALOG_ID);
}

export const feature: FeatureModule = {
  id: 'sim-main',
  panels: [
    { id: 'registers', title: 'Registers', mode: 'simulator', component: RegistersPanel },
    { id: 'listing', title: 'Listing', mode: 'simulator', component: ListingPanel },
    { id: 'messages', title: 'Messages', mode: 'simulator', component: MessagesPanel },
  ],
  dialogs: { [FIND_DIALOG_ID]: FindDialog },
  commands: {
    // Search > Find... (Ctrl+F): shows the modeless Find dialog; always available (sim-ui §3.6).
    'sim.search.find': {
      run(ctx) {
        if (findDialogOpen(ctx)) {
          simMainOf(ctx).focusFind();
          return;
        }
        void ctx.dialogs.open(FIND_DIALOG_ID, {}, { modal: false });
      },
    },
    // Search > Go to PC (Ctrl+G): highlight() - re-select and show the current instruction.
    'sim.search.gotoPC': {
      run(ctx) {
        simMainOf(ctx).gotoPC();
      },
    },
    // The gutter's context menu (sim-ui §3.3).
    'sim.bp.clearAllPC': {
      run(ctx) {
        simMainOf(ctx).clearAllBreakpoints();
      },
    },
    // The `Clear Cycles` button of the Registers panel (sim-ui §5).
    'sim.cycles.clear': {
      run(ctx) {
        simMainOf(ctx).clearCycles();
      },
    },
  },
  init(ctx) {
    return attachSimMain(ctx);
  },
};
