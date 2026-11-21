// Feature "run": the simulator session, the Run-menu commands, the simulator status bar.
//
// STUB written by W3 (wave 0): an empty feature module, so that the shell runs before this
// feature exists (ARCHITECTURE.md 3.12.3). SH8 owns this folder and replaces the body. The
// exported names and the signature of the factory are contract (section 8, "Stubs"):
// app/src/features/index.ts imports them by name.
//
// A feature module may contribute command handlers (`commands`), panels (`panels`), dialogs
// (`dialogs`) and an `init` function that runs once after every service exists.
//
// Owner: W3 > SH8.

import type { AppContext, FeatureModule, SimSession } from '../../contracts';
import type { SimSessionEnv } from '../../state/services';
import { createInertSimSession } from '../../state/stub-services';

export const feature: FeatureModule = { id: 'run' };

/**
 * The simulator session of this window (3.11.2), placed on the context as `sim`. Called once by
 * the bootstrap, last of all services. `env` carries what feature code may not import (3.1):
 * `env.engines` creates and releases simulator engines (app/src/engine), and
 * `env.createCachedSyncFiles` builds the cached file view of 3.8.4 (app/src/fs/sync/cached.ts).
 * STUB: a session without an engine, in which nothing runs.
 */
export function createSimSession(ctx: AppContext, _env: SimSessionEnv): SimSession {
  return createInertSimSession(ctx);
}
