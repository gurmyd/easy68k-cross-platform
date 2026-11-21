// Window identity (ARCHITECTURE.md 3.8.6 rule 1). Owner: W3.
//
// Several windows of the application may be open at once and share one origin's storage. At start
// each window takes a random id and holds the Web Lock `easy68k.window.<id>` for as long as its
// page lives. The browser releases the lock when the page goes away, however that happens (closed,
// crashed, navigated). A lock that is no longer held therefore means: that window is gone. The
// drafts of 3.9.4 rely on it (a window offers only the drafts of windows that are gone).

/** The parts of the Web Locks API (navigator.locks) that are used; a fake will do in tests. */
export interface LockManagerLike {
  request(name: string, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
  query?(): Promise<{ held?: { name?: string }[] }>;
}

const PREFIX = 'easy68k.window.';

export function windowLockName(windowId: string): string {
  return `${PREFIX}${windowId}`;
}

/** A new random window id. */
export function createWindowId(crypto: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface WindowLock {
  /** Resolves true once the lock is held; false where the Web Locks API does not exist. */
  readonly held: Promise<boolean>;
  /** Gives the lock back before the page ends (tests, and a window that is disposed). */
  release(): void;
}

/** Takes the lock of this window and keeps it until release() or the end of the page. */
export function holdWindowLock(windowId: string, locks: LockManagerLike | null | undefined): WindowLock {
  if (!locks) return { held: Promise.resolve(false), release: () => {} };
  let release: () => void = () => {};
  let released = false;
  const held = new Promise<boolean>((resolveHeld) => {
    locks
      .request(windowLockName(windowId), () => {
        resolveHeld(true);
        // The lock is held for as long as this promise is pending.
        return new Promise<void>((resolve) => {
          release = resolve;
          if (released) resolve();
        });
      })
      .catch(() => resolveHeld(false));
  });
  return {
    held,
    release() {
      released = true;
      release();
    },
  };
}

/**
 * The ids of the windows that are alive right now (their lock is held), this one included.
 * null where the browser cannot tell; callers then treat every other window as alive.
 */
export async function liveWindowIds(locks: LockManagerLike | null | undefined): Promise<Set<string> | null> {
  if (!locks?.query) return null;
  const snapshot = await locks.query();
  const ids = new Set<string>();
  for (const lock of snapshot.held ?? []) {
    if (lock.name?.startsWith(PREFIX)) ids.add(lock.name.slice(PREFIX.length));
  }
  return ids;
}
