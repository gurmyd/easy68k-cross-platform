// A file-system backend in memory (ARCHITECTURE.md 3.8.1, mount "/memory"): for tests, fakes and
// the wave-0 stub services. It follows the backend contract of fs/backend-contract.ts.
//
//     const backend = new MemoryBackend();                 // mount "memory"
//     const other = new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' });
//
// Test helpers: setReadOnly(), externalWrite() / externalRemove() (change the content as another
// window would and report it through onExternalChange), emitExternal().
//
// Owner: W1.

import type { BackendChange, Bytes, DirEntry, FileStat, FileSystemBackend } from '../contracts';
import { fsError } from './vfs';

export interface MemoryBackendOptions {
  mount?: string; // default "memory"
  kind?: FileSystemBackend['kind']; // default 'memory'
  label?: string; // default "Memory"
  /** Clock for modification times (milliseconds). Default: wall clock; times always increase. */
  now?: () => number;
}

interface FileEntry {
  /** Appended pieces, merged on the next read or rewrite: appendFile costs O(data.length). */
  chunks: Uint8Array[];
  size: number;
  mtime: number;
  readOnly: boolean;
}

export class MemoryBackend implements FileSystemBackend {
  readonly mount: string;
  readonly kind: FileSystemBackend['kind'];
  readonly label: string;

  private readonly files = new Map<string, FileEntry>();
  /** Directories by rel, with their creation time; '' is the root. */
  private readonly dirs = new Map<string, number>();
  private readonly listeners = new Set<(change: BackendChange) => void>();
  private readonly clock: () => number;
  private lastTime = 0;

  constructor(options: MemoryBackendOptions = {}) {
    this.mount = options.mount ?? 'memory';
    this.kind = options.kind ?? 'memory';
    this.label = options.label ?? 'Memory';
    this.clock = options.now ?? (() => Date.now());
    this.dirs.set('', this.time());
  }

  async stat(rel: string): Promise<FileStat | null> {
    checkRel(rel, true);
    const file = this.files.get(rel);
    if (file) return { kind: 'file', size: file.size, mtime: file.mtime, readOnly: file.readOnly };
    const dir = this.dirs.get(rel);
    if (dir !== undefined) return { kind: 'dir', size: 0, mtime: dir, readOnly: false };
    return null;
  }

  async readFile(rel: string): Promise<Bytes> {
    checkRel(rel, true);
    const file = this.files.get(rel);
    if (!file) {
      if (this.dirs.has(rel)) throw fsError('is-directory', `is a folder: ${rel}`);
      throw fsError('not-found', `no such file: ${rel}`);
    }
    return merge(file).slice();
  }

  async writeFile(rel: string, data: Bytes): Promise<void> {
    const file = this.prepareWrite(rel);
    file.chunks = [data.slice()];
    file.size = data.length;
    file.mtime = this.time();
  }

  async appendFile(rel: string, data: Bytes): Promise<void> {
    const file = this.prepareWrite(rel);
    if (data.length > 0) file.chunks.push(data.slice());
    file.size += data.length;
    file.mtime = this.time();
  }

  async remove(rel: string): Promise<void> {
    checkRel(rel, false);
    const file = this.files.get(rel);
    if (file) {
      if (file.readOnly) throw fsError('read-only', `read-only: ${rel}`);
      this.files.delete(rel);
      return;
    }
    if (!this.dirs.has(rel)) throw fsError('not-found', `no such file or folder: ${rel}`);
    const prefix = `${rel}/`;
    for (const key of [...this.files.keys()]) if (key.startsWith(prefix)) this.files.delete(key);
    for (const key of [...this.dirs.keys()]) if (key === rel || key.startsWith(prefix)) this.dirs.delete(key);
  }

  async list(rel: string): Promise<DirEntry[]> {
    checkRel(rel, true);
    if (this.files.has(rel)) throw fsError('not-directory', `not a folder: ${rel}`);
    if (!this.dirs.has(rel)) throw fsError('not-found', `no such folder: ${rel}`);
    const prefix = rel === '' ? '' : `${rel}/`;
    const entries: DirEntry[] = [];
    const isChild = (key: string) =>
      key.startsWith(prefix) && key.length > prefix.length && !key.includes('/', prefix.length);
    for (const key of this.dirs.keys()) if (isChild(key)) entries.push({ name: key.slice(prefix.length), kind: 'dir' });
    for (const key of this.files.keys())
      if (isChild(key)) entries.push({ name: key.slice(prefix.length), kind: 'file' });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async mkdirp(rel: string): Promise<void> {
    checkRel(rel, true);
    this.makeDirs(rel);
  }

  onExternalChange(listener: (change: BackendChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---- test helpers -----------------------------------------------------------------------

  /** Marks an existing file read-only (writeFile, appendFile and remove then fail with 'read-only'). */
  setReadOnly(rel: string, readOnly = true): void {
    const file = this.files.get(rel);
    if (!file) throw fsError('not-found', `no such file: ${rel}`);
    file.readOnly = readOnly;
  }

  /** Writes a file as another window would, and reports it through onExternalChange. */
  async externalWrite(rel: string, data: Bytes): Promise<void> {
    await this.writeFile(rel, data);
    this.emitExternal({ rel, kind: 'write' });
  }

  /** Removes a file as another window would, and reports it through onExternalChange. */
  async externalRemove(rel: string): Promise<void> {
    await this.remove(rel);
    this.emitExternal({ rel, kind: 'remove' });
  }

  /** Reports a change to the onExternalChange listeners without changing anything. */
  emitExternal(change: BackendChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  // ---- internals ------------------------------------------------------------------------------

  private time(): number {
    this.lastTime = Math.max(this.clock(), this.lastTime + 1);
    return this.lastTime;
  }

  private prepareWrite(rel: string): FileEntry {
    checkRel(rel, false);
    if (this.dirs.has(rel)) throw fsError('is-directory', `is a folder: ${rel}`);
    const existing = this.files.get(rel);
    if (existing) {
      if (existing.readOnly) throw fsError('read-only', `read-only: ${rel}`);
      return existing;
    }
    const slash = rel.lastIndexOf('/');
    if (slash > 0) this.makeDirs(rel.slice(0, slash));
    const file: FileEntry = { chunks: [], size: 0, mtime: 0, readOnly: false };
    this.files.set(rel, file);
    return file;
  }

  private makeDirs(rel: string): void {
    if (rel === '') return;
    const segments = rel.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const dir = segments.slice(0, i).join('/');
      if (this.files.has(dir)) throw fsError('not-directory', `not a folder: ${dir}`);
      if (!this.dirs.has(dir)) this.dirs.set(dir, this.time());
    }
  }
}

/** Throws 'invalid-path' unless rel is a path inside the mount ('' allowed only if allowRoot). */
function checkRel(rel: string, allowRoot: boolean): void {
  if (rel === '') {
    if (allowRoot) return;
    throw fsError('invalid-path', 'the root of a mount is not a file');
  }
  if (rel.startsWith('/') || rel.endsWith('/') || rel.includes('\\'))
    throw fsError('invalid-path', `invalid path: "${rel}"`);
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') throw fsError('invalid-path', `invalid path: "${rel}"`);
  }
}

function merge(file: FileEntry): Uint8Array {
  if (file.chunks.length === 1) return file.chunks[0] as Uint8Array;
  const out = new Uint8Array(file.size);
  let offset = 0;
  for (const chunk of file.chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  file.chunks = [out];
  return out;
}
