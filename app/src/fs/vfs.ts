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
//   name that is not mounted reports nothing. An appendFile is reported with `appended` (the size
//   before and the bytes added). The size before is the one the Vfs knows from its own last write or
//   append of that path; only when it knows none is it learnt by a stat inside the path's queue just
//   before the append, so that a log appended at every flush costs one stat, not one per flush. A
//   known size is dropped by every change that did not come through that path's queue: a remove of
//   it or a folder above it, a write of another spelling, a failure, a change the backend reports
//   (after which that path's size is always asked for), an unmount. A change that arrives while the
//   append is in progress leaves `appended` out. Sizes are kept only for a backend that reports
//   others' changes (errata W1.md entry 17). Such reports can arrive late (a BroadcastChannel's
//   do): until another window's report arrives, `at` is what this Vfs knew and may be stale, so a
//   listener confirms the size after the append before it applies `data` (VfsChange.appended).
// - resolve() finds each segment's stored spelling in the listing of its folder. A folder that may
//   not be listed (the desktop app's folders above the granted roots, 7.6) keeps the segment as
//   given; it does not make the name "not found" (defect D1, errata W1.md entry 15). Only an
//   FsError counts as such a refusal: any other exception of list() gives null (entry 16.1).
// - Failures reject with an FsError (fsError(), isFsError()).
// - snapshot() takes files breadth first with sorted names; files below a folder named `.git` (any
//   letter case) come after all others, with the same limits (ARCHITECTURE-PLUS P3.3.10). There is
//   no write guard for `.git`: a program and Save write there as before (P1.1 rule 2).
//
// Owner: W1 (the order of `.git` files: N8 in the stage of additions).

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

/**
 * True when `rel`, a path relative to a folder being snapshot or prepared, names something below a
 * folder named `.git` (any letter case): such files are taken after all others (ARCHITECTURE-PLUS
 * P3.3.10, N8). `rel` itself may be named `.git` (a file of that name is not below one).
 */
export function belowGitFolder(rel: string): boolean {
  const segments = rel.split('/');
  segments.pop();
  return segments.some(isGitName);
}

/** True for the name `.git` in any letter case. */
export function isGitName(name: string): boolean {
  return foldCase(name) === GIT_FOLDED;
}

const GIT_FOLDED = foldCase('.git');

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
  /** The backend reports the changes others make (onExternalChange): only then can a size be kept. */
  reports: boolean;
}

/** A write or append of one path in progress; `stale` once something else may have changed the file. */
interface Pending {
  key: string; // the folded path
  stale: boolean;
}

/** How many file sizes the Vfs keeps at most (the oldest is dropped): logs, not whole folders. */
const MAX_KNOWN_SIZES = 64;

/** `path` is `folder` or lies below it; both folded. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
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
  /**
   * The size of a file after this Vfs's own last write or append of it, by exact path; the oldest
   * first. Dropped by any change that did not come through that path's queue (errata W1.md entry 17).
   */
  private readonly sizes = new Map<VPath, number>();
  /** The write or append in progress, by folded path (one at a time per path: the queue). */
  private readonly inProgress = new Map<string, Pending>();
  /** Folded paths someone else has changed: their sizes are never kept again, but asked for. */
  private readonly shared = new Set<string>();

  mount(backend: FileSystemBackend): void {
    const name = backend.mount;
    if (!isVPath(`/${name}`) || name.includes('/')) throw new TypeError(`invalid mount name "${name}"`);
    if (this.mounts.has(name)) throw new Error(`"/${name}" is already mounted`);
    const reports = typeof backend.onExternalChange === 'function';
    const unsubscribe =
      backend.onExternalChange?.((change: BackendChange) => {
        let path: VPath;
        try {
          path = joinVPath(name, change.rel);
        } catch {
          return; // a backend reported a path that is not one: ignore it
        }
        this.forget(path);
        this.shared.add(foldCase(path));
        this.emit({ path, kind: change.kind, origin: 'external' });
      }) ?? (() => {});
    this.forget(`/${name}`);
    this.mounts.set(name, { backend, unsubscribe, reports });
    this.emit({ path: `/${name}`, kind: 'write', origin: 'local' });
  }

  unmount(mount: string): void {
    const mounted = this.mounts.get(mount);
    if (!mounted) return;
    mounted.unsubscribe();
    this.mounts.delete(mount);
    this.forget(`/${mount}`);
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
    return this.mutate(path, 'write', async (backend, rel) => {
      const token = this.begin(path);
      try {
        await backend.writeFile(rel, data);
      } finally {
        this.end(path, token);
      }
      this.learnSize(path, token, data.length);
    });
  }

  appendFile(path: VPath, data: Bytes): Promise<void> {
    // The change says what was appended (VfsChange.appended, request SH6-append-change), so that a
    // view holding a copy of the file need not read it whole again. The size before is the one this
    // Vfs knows from its own last write or append of the path (`sizes`), or else a stat inside the
    // path's queue, just before the append (errata W1.md entry 17). If it cannot be learnt, or
    // something else may have changed the file meanwhile, the change says nothing more than
    // 'write', and the append itself goes ahead unchanged. The bytes are copied at the call, so
    // that the file and the change both hold what the caller passed, even if it reuses its buffer.
    const copy = data.slice();
    let appended: VfsChange['appended'];
    return this.mutate(
      path,
      'write',
      async (backend, rel) => {
        const known = this.sizes.get(path);
        const token = this.begin(path);
        let before: number | null;
        try {
          before =
            known ??
            (await backend.stat(rel).then(
              (stat) => (stat === null ? 0 : stat.kind === 'file' ? stat.size : null),
              () => null,
            ));
          await backend.appendFile(rel, copy);
        } finally {
          this.end(path, token);
        }
        if (before === null || token.stale) return;
        appended = { at: before, data: copy };
        this.learnSize(path, token, before + copy.length);
      },
      () => (appended === undefined ? {} : { appended }),
    );
  }

  remove(path: VPath): Promise<void> {
    return this.mutate(path, 'remove', async (backend, rel) => {
      this.forget(path);
      try {
        await backend.remove(rel);
      } finally {
        this.forget(path);
      }
    });
  }

  mkdirp(path: VPath): Promise<void> {
    // The root of a mount always exists; a backend is never asked to create it. Creating folders
    // changes no file, so the sizes this Vfs knows stay as they are.
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
    // Walk from the mount root and take each segment's stored spelling from the listing of its
    // folder: the exact one if it exists, otherwise the first entry that matches without regard to
    // case. A folder that is missing or a file ends the walk. A folder that may not be listed (the
    // desktop app's folders above the granted roots, 7.6) cannot tell spellings: its segment is
    // kept as given, and a last segment kept that way must then be found by stat (errata W1.md
    // entry 15). Nothing the backend refuses is asked for in another way.
    const segments = rel === '' ? [] : rel.split('/');
    const stored: string[] = [];
    let lastUnlisted = false;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as string;
      const isLast = i === segments.length - 1;
      let entries: DirEntry[];
      try {
        entries = await mounted.backend.list(stored.join('/'));
      } catch (error) {
        // Only a backend's own refusal (an FsError other than not-found / not-directory) means "may
        // not be listed". Anything else (a TypeError, a plain Error without a code) is a fault of
        // the backend, not an answer about the folder: the name is not found, as before the repair
        // of D1, and the walk does not go on past it (errata W1.md entry 16.1).
        if (!isFsError(error) || error.code === 'not-found' || error.code === 'not-directory') return null;
        stored.push(segment);
        lastUnlisted = isLast;
        continue;
      }
      const candidates = isLast ? entries : entries.filter((e) => e.kind === 'dir');
      const match = matchName(
        candidates.map((e) => e.name),
        segment,
      );
      if (match === null) return null;
      stored.push(match);
    }
    if (lastUnlisted) {
      const found = await mounted.backend.stat(stored.join('/')).catch(() => null);
      if (found === null) return null;
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
    /** Takes one file within the limits, or records why it is skipped. */
    const take = async (path: string): Promise<void> => {
      if (snapshot.files.size >= limits.maxFiles) {
        snapshot.skipped.push({ path, reason: 'too-many' });
        return;
      }
      try {
        const stat = await backend.stat(join(rootRel, path));
        if (!stat || stat.kind !== 'file') throw fsError('not-found', path);
        if (stat.size > limits.maxFileBytes || totalBytes + stat.size > limits.maxTotalBytes) {
          snapshot.skipped.push({ path, reason: 'too-large' });
          return;
        }
        const data = await backend.readFile(join(rootRel, path));
        if (data.length > limits.maxFileBytes || totalBytes + data.length > limits.maxTotalBytes) {
          snapshot.skipped.push({ path, reason: 'too-large' });
          return;
        }
        totalBytes += data.length;
        snapshot.files.set(path, { data, mtime: stat.mtime });
      } catch {
        snapshot.skipped.push({ path, reason: 'unreadable' });
      }
    };
    // Breadth first, names sorted: files near the root are taken before deeper ones when a limit
    // is reached, and the result does not depend on the backend's listing order. Files below a
    // folder named .git are taken after all others, in the same order and with the same limits
    // (ARCHITECTURE-PLUS P3.3.10, N8): while everything fits, the set of files is the same.
    const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }];
    const inGit: string[] = [];
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
        if (belowGitFolder(path)) inGit.push(path);
        else await take(path);
      }
    }
    for (const path of inGit) await take(path);
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

  /**
   * A write or append of `path` starts (inside its queue). Every other spelling of the path, and
   * anything below it, loses its known size, and a write or append of those in progress is marked
   * stale: on a disk that ignores letter case they are the same file.
   */
  private begin(path: VPath): Pending {
    const pending: Pending = { key: foldCase(path), stale: false };
    this.forget(path);
    this.inProgress.set(pending.key, pending);
    return pending;
  }

  private end(path: VPath, pending: Pending): void {
    if (this.inProgress.get(pending.key) === pending) this.inProgress.delete(pending.key);
  }

  /** The file at `path` is `size` bytes long after this Vfs's own write or append, if nothing else intervened. */
  private learnSize(path: VPath, pending: Pending, size: number): void {
    if (pending.stale || !this.mayKeepSize(path)) return;
    this.sizes.delete(path);
    this.sizes.set(path, size);
    if (this.sizes.size > MAX_KNOWN_SIZES) this.sizes.delete(this.sizes.keys().next().value as VPath);
  }

  /**
   * A size may be kept only where the backend reports the changes others make, and only for a path
   * that nobody else has changed since the mount: there a report may come late (another window's
   * appends), and the size is asked for before each append instead.
   */
  private mayKeepSize(path: VPath): boolean {
    const { mount } = splitVPath(path);
    if (!this.mounts.get(mount)?.reports) return false;
    let folder = foldCase(path);
    for (;;) {
      if (this.shared.has(folder)) return false;
      const slash = folder.lastIndexOf('/');
      if (slash <= 0) return true;
      folder = folder.slice(0, slash);
    }
  }

  /** Something changed `path` or what lies below it: drop the sizes known there and mark work in progress stale. */
  private forget(path: string): void {
    const folder = foldCase(path);
    for (const known of [...this.sizes.keys()]) if (within(foldCase(known), folder)) this.sizes.delete(known);
    for (const pending of this.inProgress.values()) if (within(pending.key, folder)) pending.stale = true;
  }

  /** Resolves when the mutations requested for `path` so far have finished (successfully or not). */
  private pending(path: VPath): Promise<void> {
    return this.tails.get(foldCase(path)) ?? Promise.resolve();
  }

  private mutate(
    path: VPath,
    kind: VfsChange['kind'],
    op: (backend: FileSystemBackend, rel: string) => Promise<void>,
    extra: () => Partial<VfsChange> = () => ({}),
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
    return result.then(() => this.emit({ ...extra(), path, kind, origin: 'local' }));
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
