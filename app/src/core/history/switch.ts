// The `history` switch of `Options > Port Additions...` as the store reads it (ARCHITECTURE-PLUS
// P1.2, P4.2). Owner: N3.
//
// Pure. fs/history-db.ts may import core/history but not core/plus (the layer rule of P2.4), so the
// store reads the switch through this one function, which uses N0's readPlus.

import type { Settings } from '../../contracts';
import { readPlus } from '../plus/settings';

/** True while the `history` switch is on (the default, D1); malformed settings read as on. */
export function historySwitchOn(settings: Pick<Settings, 'app'>): boolean {
  return readPlus(settings).history;
}
