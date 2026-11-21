// The virtual file system (ARCHITECTURE.md 3.8.1): mounts backends under "/<mount>", keeps the
// mutations of one path in call order, resolves Windows-style names, takes snapshots for the
// assembler and reports changes.
//
//     const vfs = createVfs();
//     vfs.mount(new MemoryBackend());
//     await vfs.writeFile('/memory/demo/prog.X68', bytes);
//     await vfs.resolve('/memory/demo', 'PROG.x68');   // '/memory/demo/prog.X68'
//
// Rules:
// - writeFile, appendFile, remove and mkdirp of one path run one at a time, in call order (whatever
//   the backend does with concurrent requests). stat and readFile of that path wait for the
//   mutations requested before them, so a read sees every write that was called before it. Paths
//   are the same path for this rule when they differ only in letter case.
// - Every successful mutation is reported to the subscribers whose prefix contains the path, with
//   origin 'local'; changes a backend reports through onExternalChange are reported with origin
//   'external'. Prefixes are compared with exact letter case. mkdirp is reported as one 'write' of
//   the folder it was asked for (not of the parents it created on the way), also when the folder
//   existed already. mount() and unmount() are reported, synchronously, as a 'write' and a
//   'remove' of "/<mount>" (gate I2, errata FS2.md C1, errata W1.md entry 14); an unmount of a
//   name that is not mounted reports nothing.
// - Failures reject with an FsError (fsError(), isFsError()).
//
// Owner: W1.

import type {
  BackendChange,
  Bytes,
  DirEntry,
  DirSnapshot,
  FileStat,
  FileSystemBackend,
  FsError,
  FsErrorCode,
  SnapshotLimits,
  Vfs,
  VfsChange,
  VPath,
} from '../contracts';
import { foldCase, isVPath, isWithin, joinVPath, matchName, resolveLexically, splitVPath } from '../core/paths/winpath';

/** An Error with an FsErrorCode in `code`. */
export function fsError(code: FsErrorCode, message: string): FsError {
  const error = new Error(message) as Error & { code: FsErrorCode };
  error.name = 'FsError';
  error.code = code;
  return error;
}

/** True if `error` is an FsError (with the given code, if one is given). */
export function isFsError(error: unknown, code?: FsErrorCode): error is FsError {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (code === undefined || (error as { code?: unknown }).code === code)
  );
}

/** A new, empty Vfs. */
export function createVfs(): Vfs {
  return new VirtualFileSystem();
}

interface Mounted {
  backend: FileSystemBackend;
  unsubscribe: () => void;
}

interface Subscription {
  prefix: VPath;
  listener: (change: VfsChange) => void;
}

class VirtualFileSystem implements Vfs {
  private readonly mounts = new Map<string, Mounted>();
  private readonly subscriptions = new Set<Subscription>();
  /** Per path (folded): the promise of the last mutation requested. */
  private readonly tails = new Map<string, Promise<void>>();

  mount(backend: FileSystemBackend): void {
    const name = backend.mount;
    if (!isVPath(`/${name}`) || name.includes('/')) throw new TypeError(`invalid mount name "${name}"`);
    if (this.mounts.has(name)) throw new Error(`"/${name}" is already mounted`);
    const unsubscribe =
      backend.onExternalChange?.((change: BackendChange) => {
        let path: VPath;
        try {
          path = joinVPath(name, change.rel);
        } catch {
          return; // a backend reported a path that is not one: ignore it
        }
        this.emit({ path, kind: change.kind, origin: 'external' });
      }) ?? (() => {});
    this.mounts.set(name, { backend, unsubscribe });
    this.emit({ path: `/${name}`, kind: 'write', origin: 'local' });
  }

  unmount(mount: string): void {
    const mounted = this.mounts.get(mount);
    if (!mounted) return;
    mounted.unsubscribe();
    this.mounts.delete(mount);
    this.emit({ path: `/${mount}`, kind: 'remove', origin: 'local' });
  }

  backends(): FileSystemBackend[] {
    return [...this.mounts.values()].map((m) => m.backend);
  }

  async stat(path: VPath): Promise<FileStat | null> {
    const { backend, rel } = this.locate(path);
    await this.pending(path);
    return backend.stat(rel);
  }

  async readFile(path: VPath): Promise<Bytes> {
    const { backend, rel } = this.locate(path);
    await this.pending(path);
    return backend.readFile(rel);
  }

  writeFile(path: VPath, data: Bytes): Promise<void> {
    return this.mutate(path, 'write', (backend, rel) => backend.writeFile(rel, data));
  }

  appendFile(path: VPath, data: Bytes): Promise<void> {
    return this.mutate(path, 'write', (backend, rel) => backend.appendFile(rel, data));
  }

  remove(path: VPath): Promise<void> {
    return this.mutate(path, 'remove', (backend, rel) => backend.remove(rel));
  }

  mkdirp(path: VPath): Promise<void> {
    // The root of a mount always exists; a backend is never asked to create it.
    return this.mutate(path, 'write', (backend, rel) => (rel === '' ? Promise.resolve() : backend.mkdirp(rel)));
  }

  async list(path: VPath): Promise<DirEntry[]> {
    const { backend, rel } = this.locate(path);
    return backend.list(rel);
  }

  async resolve(dir: VPath, name: string): Promise<VPath | null> {
    if (!isVPath(dir)) return null;
    const lexical = resolveLexically(dir, name);
    if (lexical === null) return null;
    const { mount, rel } = splitVPath(lexical);
    const mounted = this.mounts.get(mount);
    if (!mounted) return null;
    // Walk from the mount root and take each segment's stored spelling: the exact one if it
    // exists, otherwise the first entry that matches without regard to case.
    const segments = rel === '' ? [] : rel.split('/');
    const stored: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      let entries: DirEntry[];
      try {
        entries = await mounted.backend.list(stored.join('/'));
      } catch {
        return null;
      }
      const isLast = i === segments.length - 1;
      const candidates = isLast ? entries : entries.filter((e) => e.kind === 'dir');
      const match = matchName(
        candidates.map((e) => e.name),
        segments[i] as string,
      );
      if (match === null) return null;
      stored.push(match);
    }
    return joinVPath(mount, stored.join('/'));
  }

  async snapshot(dir: VPath, limits: SnapshotLimits): Promise<DirSnapshot> {
    const { backend, rel: rootRel } = this.locate(dir);
    const rootStat = await backend.stat(rootRel);
    if (!rootStat) throw fsError('not-found', `no such folder: ${dir}`);
    if (rootStat.kind !== 'dir') throw fsError('not-directory', `not a folder: ${dir}`);

    const snapshot: DirSnapshot = { root: dir, files: new Map(), skipped: [] };
    let totalBytes = 0;
    const join = (a: string, b: string) => (a === '' ? b : b === '' ? a : `${a}/${b}`);
    // Breadth first, names sorted: files near the root are taken before deeper ones when a limit
    // is reached, and the result does not depend on the backend's listing order.
    const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }];
    while (queue.length > 0) {
      const { rel, depth } = queue.shift() as { rel: string; depth: number };
      let entries: DirEntry[];
      try {
        entries = await backend.list(join(rootRel, rel));
      } catch {
        if (rel !== '') snapshot.skipped.push({ path: rel, reason: 'unreadable' });
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        const path = join(rel, entry.name);
        if (entry.kind === 'dir') {
          if (depth + 1 > limits.maxDepth) snapshot.skipped.push({ path, reason: 'too-deep' });
          else queue.push({ rel: path, depth: depth + 1 });
          continue;
        }
        if (snapshot.files.size >= limits.maxFiles) {
          snapshot.skipped.push({ path, reason: 'too-many' });
          continue;
        }
        try {
          const stat = await backend.stat(join(rootRel, path));
          if (!stat || stat.kind !== 'file') throw fsError('not-found', path);
          if (stat.size > limits.maxFileBytes || totalBytes + stat.size > limits.maxTotalBytes) {
            snapshot.skipped.push({ path, reason: 'too-large' });
            continue;
          }
          const data = await backend.readFile(join(rootRel, path));
          if (data.length > limits.maxFileBytes || totalBytes + data.length > limits.maxTotalBytes) {
            snapshot.skipped.push({ path, reason: 'too-large' });
            continue;
          }
          totalBytes += data.length;
          snapshot.files.set(path, { data, mtime: stat.mtime });
        } catch {
          snapshot.skipped.push({ path, reason: 'unreadable' });
        }
      }
    }
    return snapshot;
  }

  subscribe(prefix: VPath, listener: (change: VfsChange) => void): () => void {
    const subscription: Subscription = { prefix, listener };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  // ---- internals ----------------------------------------------------------------------

  private locate(path: VPath): { backend: FileSystemBackend; rel: string } {
    if (!isVPath(path)) throw fsError('invalid-path', `not a virtual path: "${path}"`);
    const { mount, rel } = splitVPath(path);
    const mounted = this.mounts.get(mount);
    if (!mounted) throw fsError('not-found', `nothing is mounted at /${mount}`);
    return { backend: mounted.backend, rel };
  }

  /** Resolves when the mutations requested for `path` so far have finished (successfully or not). */
  private pending(path: VPath): Promise<void> {
    return this.tails.get(foldCase(path)) ?? Promise.resolve();
  }

  private mutate(
    path: VPath,
    kind: VfsChange['kind'],
    op: (backend: FileSystemBackend, rel: string) => Promise<void>,
  ): Promise<void> {
    let located: { backend: FileSystemBackend; rel: string };
    try {
      located = this.locate(path);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = foldCase(path);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => op(located.backend, located.rel));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result.then(() => this.emit({ path, kind, origin: 'local' }));
  }

  private emit(change: VfsChange): void {
    for (const { prefix, listener } of [...this.subscriptions]) {
      if (prefix !== '/' && !isWithin(change.path, prefix)) continue;
      try {
        listener(change);
      } catch (error) {
        // A failing listener must not fail the write that triggered it or starve the others.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
