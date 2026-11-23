// The line at the bottom of the Files panel (ARCHITECTURE-PLUS P3.2.6): how much this site stores
// in the browser, how much of it the earlier versions and the Trash take, and about how much is
// free. A button that opens the Storage group of `Options > Port Additions...` (P3.5). Refreshed
// after every change the panel sees, at most once per second. Owner: N5.

import { useEffect, useRef, useState } from 'react';
import type { AppContext } from '../../contracts';
import { pageEstimator, type StorageEstimator } from './import-guard';
import { STORAGE_SEPARATOR, aboutFree, historyUses, siteUses } from './texts';

/** At most one refresh per this many milliseconds. */
export const STORAGE_REFRESH_MS = 1000;

export interface StorageFigures {
  /** estimate(): undefined where the page has no estimate. */
  estimate?: { usage: number; quota: number };
  /** Counted bytes of the earlier versions and the Trash; undefined without a history. */
  history?: number;
}

/** The line's text (P3.2.6). The desktop app shows only the history's part. */
export function storageLineText(figures: StorageFigures, platform: 'web' | 'desktop'): string {
  const parts: string[] = [];
  const estimate = platform === 'web' ? figures.estimate : undefined;
  if (estimate) parts.push(siteUses(estimate.usage));
  parts.push(historyUses(figures.history ?? 0));
  if (estimate) parts.push(aboutFree(Math.max(0, estimate.quota - estimate.usage)));
  return parts.join(STORAGE_SEPARATOR);
}

/** Reads the figures (an estimate that fails counts as none). */
export async function readStorageFigures(ctx: AppContext, estimate: StorageEstimator): Promise<StorageFigures> {
  const figures: StorageFigures = {};
  if (estimate) {
    try {
      const { usage, quota } = await estimate();
      if (typeof usage === 'number' && typeof quota === 'number') figures.estimate = { usage, quota };
    } catch {
      // no estimate
    }
  }
  if (ctx.history) {
    try {
      const usage = await ctx.history.usage();
      figures.history = usage.versionBytes + usage.trashBytes;
    } catch {
      figures.history = 0;
    }
  }
  return figures;
}

/**
 * A throttle: `run` at once when nothing ran within `ms`, else once at the end of that time.
 * Returns the function that asks for a run, and the one that stops.
 */
export function throttle(
  run: () => void,
  ms: number,
  timers: { now(): number; set(fn: () => void, ms: number): () => void },
): { request(): void; stop(): void } {
  let last = -Infinity;
  let pending: (() => void) | null = null;
  const fire = () => {
    pending = null;
    last = timers.now();
    run();
  };
  return {
    request() {
      if (pending) return;
      const wait = last + ms - timers.now();
      if (wait <= 0) fire();
      else pending = timers.set(fire, wait);
    },
    stop() {
      pending?.();
      pending = null;
    },
  };
}

export function StorageLine({ ctx }: { ctx: AppContext }) {
  const [text, setText] = useState(() => storageLineText({}, ctx.platform.kind));
  // How often the figures were read: the browser check holds the line to once per second.
  const [refreshes, setRefreshes] = useState(0);
  const estimator = useRef(pageEstimator()).current;
  useEffect(() => {
    let live = true;
    const refresh = throttle(
      () => {
        setRefreshes((n) => n + 1);
        void readStorageFigures(ctx, estimator).then((figures) => {
          if (live) setText(storageLineText(figures, ctx.platform.kind));
        });
      },
      STORAGE_REFRESH_MS,
      {
        now: () => performance.now(),
        set: (fn, ms) => {
          const id = setTimeout(fn, ms);
          return () => clearTimeout(id);
        },
      },
    );
    refresh.request();
    const stopVfs = ctx.vfs.subscribe('/', () => refresh.request());
    const stopHistory = ctx.history?.subscribe(() => refresh.request()) ?? (() => {});
    return () => {
      live = false;
      refresh.stop();
      stopVfs();
      stopHistory();
    };
  }, [ctx, estimator]);
  return (
    <button
      type="button"
      className="e68-files__storage"
      data-e68-storage-line=""
      data-e68-storage-refreshes={refreshes}
      onClick={() => void ctx.commands.run('app.additions.options', { group: 'storage' })}
    >
      {text}
    </button>
  );
}
