// Asking the Files panel of a window to show a path: after an import, after Help > Examples...
// (the command app.files.toggle with FilesRevealArg, contracts/commands.ts), from the checks.
// The panel registers itself while it is mounted. A request made while it is not (the panel was
// hidden and app.files.toggle has only just asked for it to be shown) waits until it mounts, so
// that "show the panel and reveal this path" works in one step. Such a waiting request is dropped
// when the panel has not mounted PENDING_REVEAL_MS after it was made in Editor mode (or after the
// next switch to Editor mode, for a request made in another mode, where the Files panel does not
// exist), and when the panel is toggled without a path: a panel that does not mount must not
// reveal a stale path much later. No DOM: tested under Node.
// Owner: FS1.

import type { AppContext, FilesRevealArg, VPath } from '../../contracts';

/** How long a remembered request waits for the Files panel to mount. Mounting after showPanel takes
 *  one render; this limit is far above that also on a slow machine. */
export const PENDING_REVEAL_MS = 5000;

interface PendingReveal {
  path: VPath;
  timer: ReturnType<typeof setTimeout> | null;
  /** Stops listening for the switch to Editor mode, while waiting for it. */
  unsubscribe: (() => void) | null;
}

const revealers = new WeakMap<AppContext, (path: VPath) => void>();
const pending = new WeakMap<AppContext, PendingReveal>();

/** The window's mode, or null for a context without a store (tests). */
function modeOf(ctx: AppContext): string | null {
  return ctx.store?.getState?.().mode ?? null;
}

/** Drops a request that is waiting for the panel of this window, if any. */
export function forgetPendingReveal(ctx: AppContext): void {
  const waiting = pending.get(ctx);
  if (!waiting) return;
  if (waiting.timer !== null) clearTimeout(waiting.timer);
  waiting.unsubscribe?.();
  pending.delete(ctx);
}

/**
 * Starts the time limit of a waiting request. The Files panel exists only in Editor mode: a
 * request made in another mode (Help > Examples... from the simulator's menu) waits for the next
 * switch to Editor mode, and the limit starts then.
 */
function armLimit(ctx: AppContext, entry: PendingReveal): void {
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (pending.get(ctx) !== entry) return;
    const mode = modeOf(ctx);
    if (mode === null || mode === 'editor') {
      pending.delete(ctx);
      return;
    }
    entry.unsubscribe = ctx.store.subscribe(() => {
      if (modeOf(ctx) !== 'editor' || pending.get(ctx) !== entry) return;
      entry.unsubscribe?.();
      entry.unsubscribe = null;
      armLimit(ctx, entry);
    });
  }, PENDING_REVEAL_MS);
}

/**
 * Called by the mounted Files panel: from now on requests of this window go to `reveal`. A request
 * that waited for the panel is handed over at once. Returns the function that unregisters.
 */
export function registerFilesRevealer(ctx: AppContext, reveal: (path: VPath) => void): () => void {
  revealers.set(ctx, reveal);
  const waiting = pending.get(ctx);
  if (waiting !== undefined) {
    forgetPendingReveal(ctx);
    reveal(waiting.path);
  }
  return () => {
    if (revealers.get(ctx) === reveal) revealers.delete(ctx);
  };
}

/**
 * Asks the Files panel of this window to show `path`. True if the panel is mounted and took the
 * request now; false if it is not, in which case only `remember` keeps the request until the panel
 * mounts, for at most PENDING_REVEAL_MS (the latest such request wins).
 */
export function requestReveal(ctx: AppContext, path: VPath, remember = false): boolean {
  const reveal = revealers.get(ctx);
  if (reveal) {
    forgetPendingReveal(ctx);
    reveal(path);
    return true;
  }
  if (remember) {
    forgetPendingReveal(ctx);
    const entry: PendingReveal = { path, timer: null, unsubscribe: null };
    pending.set(ctx, entry);
    armLimit(ctx, entry);
  }
  return false;
}

/** The path of a FilesRevealArg, or null for any other argument (then the command toggles). */
export function revealPathOf(arg: unknown): VPath | null {
  if (typeof arg !== 'object' || arg === null) return null;
  const reveal = (arg as Partial<FilesRevealArg>).reveal;
  return typeof reveal === 'string' && reveal.startsWith('/') ? reveal : null;
}
