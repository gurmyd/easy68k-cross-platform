// Feature "stack": the Stack panel (ARCHITECTURE.md 2.6; sim-ui §11) and View > Stack.
//
// Owner: W3 > U2.
//
//   sim.view.stack            shows the panel, brings its tab to the front and moves the focus
//                             into its `View` list (2.3). Showing the panel re-centres it on the
//                             selected register, as the original's FormShow does.
//
// The panel's state lives in one model per window (model.ts).

import type { FeatureModule } from '../../contracts';
import { showPanel } from '../../state/panels';
import { stackModelOf } from './model';
import { StackPanel } from './StackPanel';

export const feature: FeatureModule = {
  id: 'stack',
  commands: {
    'sim.view.stack': {
      run(ctx) {
        showPanel(ctx, 'stack');
      },
    },
  },
  panels: [{ id: 'stack', title: 'Stack', mode: 'simulator', component: StackPanel }],
  init(ctx) {
    return stackModelOf(ctx).start();
  },
};
