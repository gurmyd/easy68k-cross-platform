// The viewer of files that are not text: PDFs, pictures and a notice (ARCHITECTURE-PLUS P3.4).
// Owner: N0 > N6.
//
// STUB of N0: an empty feature module and a viewer service whose wants() returns false, so that
// every file opens as text, as in the original. The owner replaces the bodies and keeps the exports.

import type { AppContext, FeatureModule, ViewerService } from '../../contracts';

export const feature: FeatureModule = { id: 'viewer' };

/** The factory of AppContext.viewer (ARCHITECTURE-PLUS P4.4). */
export function createViewerService(_ctx: AppContext): ViewerService {
  return {
    wants: () => false,
    show: () => {},
  };
}
