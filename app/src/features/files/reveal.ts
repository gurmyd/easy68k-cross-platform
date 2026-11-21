// Asking the Files panel of a window to show a path: after an import, after Help > Examples...
// (the command app.files.toggle with FilesRevealArg, contracts/commands.ts), from the checks.
// The panel registers itself while it is mounted. A request made while it is not (the panel was
// hidden and app.files.toggle has only just asked for it to be shown) waits until it mounts, so
// that "show the panel and reveal this path" works in one step. No DOM: tested under Node.
// Owner: FS1.

import type { AppContext, FilesRevealArg, VPath } from '../../contracts';

const revealers = new WeakMap<AppContext, (path: VPath) => void>();
const pending = new WeakMap<AppContext, VPath>();

/**
 * Called by the mounted Files panel: from now on requests of this window go to `reveal`. A request
 * that waited for the panel is handed over at once. Returns the function that unregisters.
 */
export function registerFilesRevealer(ctx: AppContext, reveal: (path: VPath) => void): () => void {
  revealers.set(ctx, reveal);
  const waiting = pending.get(ctx);
  if (waiting !== undefined) {
    pending.delete(ctx);
    reveal(waiting);
  }
  return () => {
    if (revealers.get(ctx) === reveal) revealers.delete(ctx);
  };
}

/**
 * Asks the Files panel of this window to show `path`. True if the panel is mounted and took the
 * request now; false if it is not, in which case only `remember` keeps the request until the panel
 * mounts (the latest such request wins).
 */
export function requestReveal(ctx: AppContext, path: VPath, remember = false): boolean {
  const reveal = revealers.get(ctx);
  if (reveal) {
    reveal(path);
    return true;
  }
  if (remember) pending.set(ctx, path);
  return false;
}

/** The path of a FilesRevealArg, or null for any other argument (then the command toggles). */
export function revealPathOf(arg: unknown): VPath | null {
  if (typeof arg !== 'object' || arg === null) return null;
  const reveal = (arg as Partial<FilesRevealArg>).reveal;
  return typeof reveal === 'string' && reveal.startsWith('/') ? reveal : null;
}
