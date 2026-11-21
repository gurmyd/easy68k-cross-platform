// Feature "files": the file dialogs, the Files panel, drag and drop, the browser store.
//
// STUB written by W3 (wave 0): an empty feature module, so that the shell runs before this
// feature exists (ARCHITECTURE.md 3.12.3). FS1 owns this folder and replaces the body. The
// exported names and the signature of the factory are contract (section 8, "Stubs"): app/src/features/index.ts imports
// them by name.
//
// A feature module may contribute command handlers (`commands`), panels (`panels`), dialogs
// (`dialogs`) and an `init` function that runs once after every service exists.
//
// Owner: W3 > FS1.

import type { AppContext, FeatureModule, FileDialogs } from '../../contracts';
import { createStubFileDialogs } from '../../state/stub-services';

export const feature: FeatureModule = { id: 'files' };

/**
 * The file dialogs of the application (3.8.5). Called once by the bootstrap, after `dialogs` and
 * `vfs` exist. STUB: every dialog answers Cancel.
 */
export function createFileDialogs(_ctx: AppContext): FileDialogs {
  return createStubFileDialogs();
}
