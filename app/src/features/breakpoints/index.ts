// Feature "breakpoints": the Break Points panel (ARCHITECTURE.md 2.6, note 40; sim-ui §12.2) and
// View > Break Points.
//
// Owner: W3 > U3.
//
//   sim.view.breakpoints      shows the panel, brings its tab to the front and moves the focus
//                             into its Registers grid (2.3).
//
// The grids and their rules are in core/breakpoints; the panel's state lives in one model per
// window (model.ts), which sends the stored rows to the engine and empties the grids after a cold
// start. The simple PC breakpoints of the listing gutter belong to sim-main (U1).

import type { FeatureModule } from '../../contracts';
import { showPanel } from '../../state/panels';
import { BreakpointsPanel } from './BreakpointsPanel';
import { breakpointsModelOf } from './model';

export const feature: FeatureModule = {
  id: 'breakpoints',
  commands: {
    'sim.view.breakpoints': {
      run(ctx) {
        showPanel(ctx, 'breakpoints');
      },
    },
  },
  panels: [{ id: 'breakpoints', title: 'Break Points', mode: 'simulator', component: BreakpointsPanel }],
  init(ctx) {
    return breakpointsModelOf(ctx).start();
  },
};
