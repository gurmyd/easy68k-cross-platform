// An in-memory SyncFiles view (ARCHITECTURE.md 3.8.4, mount "/memory"): for tests of ProgramFiles,
// the sound device and anything else that needs synchronous files. It follows the SyncFiles
// contract of fs/backend-contract.ts.
//
//     const view = new MemorySyncFiles({ files: { '/memory/demo/data.txt': bytes } });
//     view.resolve('/memory/demo', 'DATA.TXT');   // '/memory/demo/data.txt'
//
// What the view may reach: the folders given as `reach` (default "/memory") and everything below.
// Folders exist when they are a reach root, were prepared, or contain a file. A file can be
// created only in a folder that exists, as fopen() on Windows.
//
// Owner: W1.

import type { Bytes, SyncFiles, VPath } from '../../contracts';
import { dirname, isVPath, isWithin, matchName, resolveLexically, splitVPath } from '../../core/paths/winpath';

export interface MemorySyncFilesOptions {
  /** Initial files by VPath. */
  files?: Record<VPath, Bytes>;
  /** Files that cannot be written, created or removed. */
  readOnly?: VPath[];
  /** Folders the view may reach (default ["/memory"]). */
  reach?: VPath[];
}

interface Entry {
  data: Uint8Array;
  readOnly: boolean;
}

export class MemorySyncFiles implements SyncFiles {
  readonly unsettled = false; // every change is in "storage" at once

  private readonly files = new Map<VPath, Entry>();
  private readonly dirs = new Set<VPath>();
  private readonly reach: VPath[];

  constructor(options: MemorySyncFilesOptions = {}) {
    this.reach = options.reach ?? ['/memory'];
    for (const root of this.reach) {
      if (!isVPath(root)) throw new TypeError(`not a virtual path: "${root}"`);
      this.dirs.add(root);
    }
    for (const [path, data] of Object.entries(options.files ?? {})) this.put(path, data);
    for (const path of options.readOnly ?? []) this.setReadOnly(path, true);
  }

  async prepare(dir: VPath): Promise<void> {
    if (!this.reachable(dir)) throw new Error(`not reachable by this view: ${dir}`);
    this.addDirs(dir);
  }

  async revalidate(): Promise<void> {}

  resolve(dir: VPath, name: string): VPath | null {
    if (!isVPath(dir)) return null;
    const lexical = resolveLexically(dir, name);
    if (lexical === null || !this.reachable(lexical)) return null;
    // Take the stored spelling of every segment that exists; keep the rest as given.
    const { mount, rel } = splitVPath(lexical);
    let path: VPath = `/${mount}`;
    for (const segment of rel === '' ? [] : rel.split('/')) {
      const match = matchName(this.childNames(path), segment);
      path = `${path}/${match ?? segment}`;
    }
    return this.reachable(path) ? path : null;
  }

  stat(path: VPath): { size: number; readOnly: boolean } | null {
    const entry = this.files.get(path);
    return entry ? { size: entry.data.length, readOnly: entry.readOnly } : null;
  }

  read(path: VPath, position: number, count: number): Bytes | null {
    const entry = this.files.get(path);
    if (!entry || position < 0 || count < 0) return null;
    const start = Math.min(position, entry.data.length);
    return entry.data.slice(start, Math.min(start + count, entry.data.length));
  }

  write(path: VPath, position: number, data: Bytes): boolean {
    const entry = this.files.get(path);
    if (!entry || entry.readOnly || position < 0) return false;
    const end = position + data.length;
    if (end > entry.data.length) {
      const grown = new Uint8Array(end); // the gap before position reads as zero bytes
      grown.set(entry.data);
      entry.data = grown;
    }
    entry.data.set(data, position);
    return true;
  }

  create(path: VPath): boolean {
    if (!isVPath(path) || !this.reachable(path) || this.dirs.has(path)) return false;
    const existing = this.files.get(path);
    if (existing) {
      if (existing.readOnly) return false;
      existing.data = new Uint8Array(0);
      return true;
    }
    if (!this.dirs.has(dirname(path))) return false;
    this.files.set(path, { data: new Uint8Array(0), readOnly: false });
    return true;
  }

  remove(path: VPath): boolean {
    const entry = this.files.get(path);
    if (!entry || entry.readOnly) return false;
    this.files.delete(path);
    return true;
  }

  async settled(): Promise<void> {}

  // ---- test helpers -----------------------------------------------------------------------

  /** Puts a file (and its folders) into the view. */
  put(path: VPath, data: Bytes): void {
    if (!isVPath(path)) throw new TypeError(`not a virtual path: "${path}"`);
    this.addDirs(dirname(path));
    const existing = this.files.get(path);
    this.files.set(path, { data: data.slice(), readOnly: existing?.readOnly ?? false });
  }

  /** The bytes of a file (a copy), or undefined. */
  get(path: VPath): Bytes | undefined {
    return this.files.get(path)?.data.slice();
  }

  /** Every file path, sorted. */
  paths(): VPath[] {
    return [...this.files.keys()].sort();
  }

  setReadOnly(path: VPath, readOnly = true): void {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`no such file: ${path}`);
    entry.readOnly = readOnly;
  }

  // ---- internals ------------------------------------------------------------------------------

  private reachable(path: VPath): boolean {
    return this.reach.some((root) => isWithin(path, root));
  }

  private addDirs(dir: VPath): void {
    for (let d = dir; ; d = dirname(d)) {
      this.dirs.add(d);
      if (dirname(d) === d) break;
    }
  }

  private childNames(dir: VPath): string[] {
    const prefix = `${dir}/`;
    const names = new Set<string>();
    for (const path of [...this.dirs, ...this.files.keys()]) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        names.add(slash < 0 ? rest : rest.slice(0, slash));
      }
    }
    return [...names];
  }
}
