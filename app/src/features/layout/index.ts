// The dock layout commands (ARCHITECTURE-PLUS P3.1.4): app.layout.move with the dialog layout.move, app.layout.lock, app.layout.reset.
// Owner: N0 > N1.
//
// STUB of N0: an empty feature module, as W3 wrote one for every feature. The owner replaces the
// body and keeps `export const feature: FeatureModule`.

import type { FeatureModule } from '../../contracts';

export const feature: FeatureModule = { id: 'layout' };
