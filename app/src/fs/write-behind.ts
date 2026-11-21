// Write-behind helper (ARCHITECTURE.md 3.8.1): per path, one write in flight, the newest bytes
// written next, the data taken when a write starts.
//
//     const behind = new WriteBehind((path, data) => vfs.writeFile(path, data));
//     behind.schedule('/browser/demo/out.txt', () => currentBytes());   // starts a write now
//     behind.schedule('/browser/demo/out.txt', () => currentBytes());   // runs after it, once
//     await behind.settled();
//
// schedule() starts the write at once when nothing is in flight for that path. While a write is
// in flight, further schedules for the path collapse into one follow-up write, which reads its
// bytes from the newest getter when it starts. When to schedule (the 500 ms rate of 3.8.4, on
// close, on stop) is the caller's business.
//
// A failed write is reported to `onError` and not retried; settled() still resolves.
//
// Owner: W1.

import type { Bytes, VPath } from '../contracts';

interface PathState {
  inFlight: boolean;
  next: (() => Bytes) | null;
}

export class WriteBehind {
  private readonly paths = new Map<VPath, PathState>();
  private waiters: (() => void)[] = [];

  constructor(
    private readonly write: (path: VPath, data: Bytes) => Promise<void>,
    private readonly onError: (path: VPath, error: unknown) => void = () => {},
  ) {}

  /** Writes the bytes `data()` returns at the moment the write starts. */
  schedule(path: VPath, data: () => Bytes): void {
    let state = this.paths.get(path);
    if (!state) {
      state = { inFlight: false, next: null };
      this.paths.set(path, state);
    }
    state.next = data;
    if (!state.inFlight) this.start(path, state);
  }

  /** True while a write for `path` is scheduled or in flight. */
  isPending(path: VPath): boolean {
    return this.paths.has(path);
  }

  /** True while any write is scheduled or in flight. */
  get busy(): boolean {
    return this.paths.size > 0;
  }

  /** Resolves when no write is scheduled or in flight (immediately if none is). */
  settled(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private start(path: VPath, state: PathState): void {
    const take = state.next as () => Bytes;
    state.next = null;
    state.inFlight = true;
    let write: Promise<void>;
    try {
      write = this.write(path, take());
    } catch (error) {
      write = Promise.reject(error);
    }
    write
      .catch((error: unknown) => this.onError(path, error))
      .finally(() => {
        state.inFlight = false;
        if (state.next) {
          this.start(path, state);
          return;
        }
        this.paths.delete(path);
        if (!this.busy) {
          const waiters = this.waiters;
          this.waiters = [];
          for (const resolve of waiters) resolve();
        }
      });
  }
}
