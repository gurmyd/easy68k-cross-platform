// Feature "help": the Help panel, the About boxes, the examples (ARCHITECTURE.md 9.2, H1).
//
// Contributes the eight commands of the Help menus and of F1, the Help panel (a drawer on the
// right edge in every mode, shown with `showPanel(ctx, 'help')`) and the two About dialogs.
// The pages themselves are the original's, imported into app/public/help by tools/import-help.mjs.
//
// Owner: W3 > H1.

import type { FeatureModule } from '../../contracts';
import { EditorAboutDialog, SimulatorAboutDialog } from './AboutDialog';
import { commands } from './commands';
import { HelpPanel } from './HelpPanel';

export const feature: FeatureModule = {
  id: 'help',
  commands,
  panels: [{ id: 'help', title: 'Help', mode: 'editor', component: HelpPanel }],
  dialogs: {
    'about.editor': EditorAboutDialog,
    'about.sim': SimulatorAboutDialog,
  },
};
