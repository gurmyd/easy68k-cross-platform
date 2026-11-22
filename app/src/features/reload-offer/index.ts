// The reload offer of ARCHITECTURE-PLUS P3.3.10, for every store (package N8): an open, unmodified
// document whose file was changed outside this window is offered a reload by a toast. The rules
// are in offer.ts; this module connects them to the window.
//
// Exported names are contract (section 8, "Stubs"): app/src/features/index.ts imports `feature` by
// name. It has no command, panel or dialog and no switch (P1.2): it only shows a toast, and acts
// only on its `Reload`.
//
// Owner: N0 > N8.

import type { FeatureModule } from '../../contracts';
import { startReloadOffer } from './offer';

/** How long the second look waits (offer.ts, header): longer than a Save's write and stat take. */
export const SETTLE_MS = 300;

/** What the feature takes from the browser; tests pass their own. */
export interface ReloadOfferFeatureOptions {
  /** Calls the listener when the window regains the focus. Default: the window's `focus` event,
   *  and `visibilitychange` to visible (a tab brought to the front). */
  onFocus?: (listener: () => void) => () => void;
  /** Resolves after the second look's delay. Default: SETTLE_MS of the browser's own timer. */
  settle?: () => Promise<void>;
}

function browserOnFocus(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onVisibility = () => {
    if (document.visibilityState === 'visible') listener();
  };
  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', listener);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

function browserSettle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

export function createReloadOfferFeature(options: ReloadOfferFeatureOptions = {}): FeatureModule {
  return {
    id: 'reload-offer',
    init(ctx) {
      const offer = startReloadOffer({
        documents: ctx.documents,
        vfs: ctx.vfs,
        dialogs: ctx.dialogs,
        onFocus: options.onFocus ?? browserOnFocus,
        settle: options.settle ?? browserSettle,
      });
      return () => offer.stop();
    },
  };
}

export const feature: FeatureModule = createReloadOfferFeature();
