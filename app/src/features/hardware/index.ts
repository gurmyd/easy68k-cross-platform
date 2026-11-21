// Feature "hardware": the Hardware panel (ARCHITECTURE.md 2.6, 3.3.3; hardware §2-§5).
//
//   - command `sim.view.hardware` (View > Hardware): shows the panel, as Hardware->Show() does;
//   - the panel `hardware` of Simulator mode (HardwarePanel.tsx);
//   - init(): keeps the engine's idea of the window's visibility equal to the panel's. Whenever the
//     panel becomes visible - by the command, by its tab, by task 32/0, or by a restored layout - the
//     engine is told `setHardwareVisible(true)` through the queue, which performs the original's
//     FormShow (the switch byte becomes $00, the switch pictures stay; hardware §2.4, 2.4 of the
//     architecture). Hiding it tells the engine too, so that the next show zeroes the byte again.
//
// The HardwareModel itself (core/sim-host/hardware/model.ts) is built by the simulator session
// (features/run, SH8) and reached here as `ctx.sim.hardware`.
//
// Owner: W3 > SH7.

import type { AppContext, FeatureModule } from '../../contracts';
import { panelVisible, showPanel } from '../../state/panels';
import { HardwarePanel } from './HardwarePanel';

/** The panel id of 2.4. */
export const HARDWARE_PANEL = 'hardware';

/**
 * Tells the engine whenever the Hardware panel's visibility changes, and once at the start if the
 * restored layout shows it. Returns the function that stops watching.
 */
export function syncHardwareVisibility(ctx: AppContext): () => void {
  let visible = panelVisible(ctx, HARDWARE_PANEL);
  if (visible) ctx.sim.hardware.actions.setVisible(true);
  return ctx.settings.subscribe(() => {
    const now = panelVisible(ctx, HARDWARE_PANEL);
    if (now === visible) return;
    visible = now;
    ctx.sim.hardware.actions.setVisible(now);
  });
}

export const feature: FeatureModule = {
  id: 'hardware',
  commands: {
    'sim.view.hardware': {
      run: (ctx) => showPanel(ctx, HARDWARE_PANEL),
    },
  },
  panels: [{ id: HARDWARE_PANEL, title: 'Hardware', mode: 'simulator', component: HardwarePanel }],
  init: (ctx) => syncHardwareVisibility(ctx),
};
