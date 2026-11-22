// The storage-tight toast (ARCHITECTURE-PLUS P3.3.4). Owner: N4.
//
// Shown once per window when `ctx.history.state()` becomes `tight`, with the text of
// core/history/texts.ts; it stays until dismissed (duration 0). A window shows it again only after
// it has seen free space above 64 MB (quota - usage of the storage estimate) and a second shortage.
// The state is read from `state()` and `subscribe` (any change, from this window or another);
// while the toast is not armed, each notification with a state other than `tight` reads the
// estimate once. Without an estimate (a browser that has none), leaving `tight` re-arms it: the
// store itself leaves `tight` only when it sees room (errata N3).

import type { AppContext } from '../../contracts';
import { STORAGE_TIGHT_TOAST } from '../../core/history/texts';

/** Free space above which a window may show the toast again (P3.3.4). */
export const REARM_FREE_BYTES = 64 * 1024 * 1024;

/** The storage estimate of the browser, or null where there is none. */
export type EstimateSource = (() => Promise<{ quota?: number; usage?: number }>) | null;

/** The browser's `navigator.storage.estimate`, or null. */
export function browserEstimate(): EstimateSource {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  return storage && typeof storage.estimate === 'function' ? () => storage.estimate() : null;
}

/** Watches the history of one window; returns the function that stops it. */
export function startTightNotice(ctx: Pick<AppContext, 'history' | 'dialogs'>, estimate: EstimateSource): () => void {
  const history = ctx.history;
  if (!history) return () => {};
  let armed = true;
  let wasTight = false;
  let checking = false;
  let stopped = false;

  const rearmIfRoomy = () => {
    if (!estimate) {
      armed = true;
      return;
    }
    if (checking) return;
    checking = true;
    estimate()
      .then((value) => {
        const free = (value.quota ?? 0) - (value.usage ?? 0);
        if (!stopped && value.quota !== undefined && free > REARM_FREE_BYTES) armed = true;
      })
      .catch(() => {})
      .finally(() => {
        checking = false;
      });
  };

  const look = () => {
    if (stopped) return;
    const tight = history.state() === 'tight';
    if (tight && !wasTight && armed) {
      armed = false;
      ctx.dialogs.toast(STORAGE_TIGHT_TOAST, undefined, { duration: 0 });
    }
    if (!tight && !armed) rearmIfRoomy();
    wasTight = tight;
  };

  const unsubscribe = history.subscribe(look);
  look();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
