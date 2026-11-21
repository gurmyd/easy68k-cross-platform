// Feature "help": the Help panel, the About boxes, the examples.
//
// STUB written by W3 (wave 0): an empty feature module, so that the shell runs before this
// feature exists (ARCHITECTURE.md 3.12.3). H1 owns this folder and replaces the body. The
// exported names are contract (section 8, "Stubs"): app/src/features/index.ts imports
// them by name.
//
// A feature module may contribute command handlers (`commands`), panels (`panels`), dialogs
// (`dialogs`) and an `init` function that runs once after every service exists.
//
// Owner: W3 > H1.

import type { FeatureModule } from '../../contracts';

export const feature: FeatureModule = { id: 'help' };
