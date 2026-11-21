// Feature "memory": the Memory panel (ARCHITECTURE.md 2.6; sim-ui §10) and View > Memory.
//
// Owner: W3 > U2.
//
//   sim.view.memory           shows the panel, brings its tab to the front and moves the focus
//                             into its Address field (2.3). With an argument - a number, or the
//                             hex text of a register field - it first sets the Address field to
//                             that address (rounded down to 16): this is how the Registers panel's
//                             double-click on A0-A7, US or SS works (sim-ui §4.4, 3.11.3):
//                               ctx.commands.run('sim.view.memory', boxText)
//
// The panel's state lives in one model per window (model.ts), so it survives hiding the panel.

import type { AppContext, FeatureModule } from '../../contracts';
import { showPanel } from '../../state/panels';
import { MemoryPanel } from './MemoryPanel';
import { memoryModelOf } from './model';
import { fieldValue } from './rules';

/** The address an argument of `sim.view.memory` stands for, or null for none. */
export function addressArgument(arg: unknown): number | null {
  if (typeof arg === 'number' && Number.isFinite(arg)) return arg >>> 0;
  if (typeof arg === 'string' && /^\s*[0-9a-f]+\s*$/i.test(arg)) return fieldValue(arg.trim().slice(-8));
  return null;
}

export const feature: FeatureModule = {
  id: 'memory',
  commands: {
    'sim.view.memory': {
      run(ctx: AppContext, arg?: unknown) {
        const address = addressArgument(arg);
        if (address !== null) memoryModelOf(ctx).setAddress(address);
        showPanel(ctx, 'memory');
      },
    },
  },
  panels: [{ id: 'memory', title: 'Memory', mode: 'simulator', component: MemoryPanel }],
  init(ctx) {
    return memoryModelOf(ctx).start();
  },
};
