// Feature "additions": the dialog Options > Port Additions... (ARCHITECTURE-PLUS P3.5, P3.6).
//
// Contributes:
//   dialogs   `plus.options` (modal), AdditionsDialog.tsx
//   commands  `app.additions.options`  Options > Port Additions... in both modes (always enabled);
//             the argument `{ group: 'storage' }` (the Files panel's storage line, P3.2.6) puts the
//             focus on `Empty Trash`
//
// The switches are `AppSettings.plus` (read with readPlus of core/plus/settings.ts); the figures
// and the two buttons act on ctx.history (figures.ts, actions.ts). Texts: texts.ts.
//
// Owner: N0 > N7.

import type { FeatureModule } from '../../contracts';
import { showAdditions } from './actions';
import { AdditionsDialog } from './AdditionsDialog';
import { ADDITIONS_COMMAND, ADDITIONS_DIALOG_ID } from './texts';

export const feature: FeatureModule = {
  id: 'additions',
  dialogs: { [ADDITIONS_DIALOG_ID]: AdditionsDialog },
  commands: {
    [ADDITIONS_COMMAND]: { run: (ctx, arg) => showAdditions(ctx, arg) },
  },
};
