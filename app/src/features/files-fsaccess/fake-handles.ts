// An in-memory stand-in for the File System Access API, for unit tests under Node (which has no
// such API). It behaves as Chromium does where the backends depend on it:
//
//   - names are checked ('', '.', '..', '/' and '\' are refused with a TypeError);
//   - a file where a folder is asked for, or the reverse, is a TypeMismatchError, a missing entry a
//     NotFoundError, removing a non-empty folder without `recursive` an InvalidModificationError;
//   - a writable stream changes nothing until close(), which replaces the file at once (Chromium
//     writes a swap file and moves it into place), and abort() drops it;
//   - handles name a place (a folder and a name), not a particular file: a handle to a file that
//     was removed and created again reaches the new file;
//   - permissions: every handle of one tree shares a FakePermission. While its state is not
//     'granted', operations reject with NotAllowedError; requestPermission() rejects with a
//     SecurityError unless `activation` is true (a click shortly before), and otherwise answers
//     `answer`.
//
//   const disk = new FakeDisk();
//   const root = disk.root('coursework');                 // a FakeDirectoryHandle
//   disk.writeExternally('coursework/prog.X68', bytes);   // another program changes a file
//
// Not used by the application. Owner: FS2.

import type { Bytes } from '../../contracts';
import type {
  FsaDirectoryHandle,
  FsaFile,
  FsaFileHandle,
  FsaHandle,
  FsaPermissionMode,
  FsaPermissionState,
  FsaWritable,
} from '../../fs/fsaccess-backend';

interface FileNode {
  kind: 'file';
  data: Uint8Array;
  mtime: number;
}
interface DirNode {
  kind: 'dir';
  children: Map<string, FileNode | DirNode>;
}

function domError(name: string, message: string): Error {
  return new DOMException(message, name);
}

function checkName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Name is not allowed: "${name}"`);
  }
}

export class FakePermission {
  state: FsaPermissionState = 'granted';
  /** What requestPermission() answers when it may ask. */
  answer: FsaPermissionState = 'granted';
  /** Whether the page has a user activation (requestPermission works only then). */
  activation = true;
  /** Every requestPermission() call, with its mode. */
  readonly requests: FsaPermissionMode[] = [];
  /** Read access granted while write access is not (the state after a file picker). */
  readOnly = false;

  query(mode: FsaPermissionMode): FsaPermissionState {
    if (this.state === 'granted' && this.readOnly && mode === 'readwrite') return 'prompt';
    return this.state;
  }

  request(mode: FsaPermissionMode): FsaPermissionState {
    this.requests.push(mode);
    if (!this.activation) throw domError('SecurityError', 'User activation is required to request permissions.');
    if (this.answer === 'granted') {
      this.state = 'granted';
      if (mode === 'readwrite') this.readOnly = false;
    } else {
      this.state = this.answer;
    }
    return this.query(mode);
  }

  check(mode: FsaPermissionMode): void {
    if (this.query(mode) !== 'granted') throw domError('NotAllowedError', 'The request is not allowed.');
  }
}

/** A whole fake disk: one tree, one clock, one permission per root handed out. */
export class FakeDisk {
  readonly tree: DirNode = { kind: 'dir', children: new Map() };
  private time = 1_700_000_000_000;
  /** How many writable streams have been closed (each is one write of a whole file). */
  closes = 0;

  /** Strictly increasing milliseconds. */
  now(): number {
    this.time += 7;
    return this.time;
  }

  /** A directory handle for the folder at `path` (created), with its own permission. */
  root(path: string, permission = new FakePermission()): FakeDirectoryHandle {
    const node = this.mkdirs(path);
    const name = path.split('/').filter(Boolean).pop() ?? '';
    return new FakeDirectoryHandle(this, node, name, permission);
  }

  /** A file handle for the file at `path` (created empty when missing), with its own permission. */
  file(path: string, permission = new FakePermission()): FakeFileHandle {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() as string;
    const parent = this.mkdirs(parts.join('/'));
    if (!parent.children.has(name))
      parent.children.set(name, { kind: 'file', data: new Uint8Array(0), mtime: this.now() });
    return new FakeFileHandle(this, parent, name, permission);
  }

  /** Another program writes a file (no permission needed). */
  writeExternally(path: string, data: Bytes): void {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() as string;
    this.mkdirs(parts.join('/')).children.set(name, { kind: 'file', data: data.slice(), mtime: this.now() });
  }

  /** Another program removes a file or folder. */
  removeExternally(path: string): void {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() as string;
    this.mkdirs(parts.join('/')).children.delete(name);
  }

  /** The bytes at `path`, or null. */
  read(path: string): Uint8Array | null {
    const node = this.find(path);
    return node?.kind === 'file' ? node.data.slice() : null;
  }

  find(path: string): FileNode | DirNode | null {
    let node: FileNode | DirNode = this.tree;
    for (const part of path.split('/').filter(Boolean)) {
      if (node.kind !== 'dir') return null;
      const next: FileNode | DirNode | undefined = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  private mkdirs(path: string): DirNode {
    let node = this.tree;
    for (const part of path.split('/').filter(Boolean)) {
      let next = node.children.get(part);
      if (!next) {
        next = { kind: 'dir', children: new Map() };
        node.children.set(part, next);
      }
      if (next.kind !== 'dir') throw new Error(`a file is in the way: ${path}`);
      node = next;
    }
    return node;
  }
}

abstract class FakeHandle {
  constructor(
    protected readonly disk: FakeDisk,
    protected readonly parentOrSelf: DirNode,
    readonly name: string,
    readonly permission: FakePermission,
  ) {}

  async queryPermission(descriptor: { mode: FsaPermissionMode }): Promise<FsaPermissionState> {
    return this.permission.query(descriptor.mode);
  }

  async requestPermission(descriptor: { mode: FsaPermissionMode }): Promise<FsaPermissionState> {
    return this.permission.request(descriptor.mode);
  }
}

export class FakeFileHandle extends FakeHandle implements FsaFileHandle {
  readonly kind = 'file' as const;

  /** The folder node this file lives in. */
  get parent(): DirNode {
    return this.parentOrSelf;
  }

  private node(): FileNode {
    const node = this.parent.children.get(this.name);
    if (!node) throw domError('NotFoundError', `A requested file or directory could not be found: ${this.name}`);
    if (node.kind !== 'file')
      throw domError('TypeMismatchError', `The path supplied exists, but was not an entry of requested type.`);
    return node;
  }

  async getFile(): Promise<FsaFile> {
    this.permission.check('read');
    const node = this.node();
    const data = node.data.slice();
    return {
      size: data.length,
      lastModified: node.mtime,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    };
  }

  async createWritable(options: { keepExistingData?: boolean } = {}): Promise<FsaWritable> {
    this.permission.check('readwrite');
    const current = this.node();
    let buffer = options.keepExistingData ? current.data.slice() : new Uint8Array(0);
    let position = 0;
    let open = true;
    const disk = this.disk;
    const parent = this.parent;
    const name = this.name;
    const permission = this.permission;
    return {
      async write(data: Bytes) {
        if (!open) throw new TypeError('the stream is closed');
        const end = position + data.length;
        if (end > buffer.length) {
          const grown = new Uint8Array(end);
          grown.set(buffer, 0);
          buffer = grown;
        }
        buffer.set(data, position);
        position = end;
      },
      async seek(to: number) {
        position = to;
      },
      async close() {
        if (!open) throw new TypeError('the stream is closed');
        open = false;
        permission.check('readwrite');
        parent.children.set(name, { kind: 'file', data: buffer, mtime: disk.now() });
        disk.closes++;
      },
      async abort() {
        open = false;
      },
    };
  }

  async isSameEntry(other: FsaHandle): Promise<boolean> {
    return other instanceof FakeFileHandle && other.parent === this.parent && other.name === this.name;
  }
}

export class FakeDirectoryHandle extends FakeHandle implements FsaDirectoryHandle {
  readonly kind = 'directory' as const;

  /** The folder node itself. */
  get node(): DirNode {
    return this.parentOrSelf;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FsaFileHandle> {
    checkName(name);
    this.permission.check(options.create ? 'readwrite' : 'read');
    const existing = this.node.children.get(name);
    if (existing?.kind === 'dir')
      throw domError('TypeMismatchError', 'The path supplied exists, but was not an entry of requested type.');
    if (!existing) {
      if (!options.create) throw domError('NotFoundError', `A requested file or directory could not be found: ${name}`);
      this.node.children.set(name, { kind: 'file', data: new Uint8Array(0), mtime: this.disk.now() });
    }
    return new FakeFileHandle(this.disk, this.node, name, this.permission);
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FsaDirectoryHandle> {
    checkName(name);
    this.permission.check(options.create ? 'readwrite' : 'read');
    let existing = this.node.children.get(name);
    if (existing?.kind === 'file')
      throw domError('TypeMismatchError', 'The path supplied exists, but was not an entry of requested type.');
    if (!existing) {
      if (!options.create) throw domError('NotFoundError', `A requested file or directory could not be found: ${name}`);
      existing = { kind: 'dir', children: new Map() };
      this.node.children.set(name, existing);
    }
    return new FakeDirectoryHandle(this.disk, existing, name, this.permission);
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    checkName(name);
    this.permission.check('readwrite');
    const existing = this.node.children.get(name);
    if (!existing) throw domError('NotFoundError', `A requested file or directory could not be found: ${name}`);
    if (existing.kind === 'dir' && existing.children.size > 0 && !options.recursive) {
      throw domError('InvalidModificationError', 'The object can not be modified in this way.');
    }
    this.node.children.delete(name);
  }

  async *entries(): AsyncGenerator<[string, FsaHandle]> {
    this.permission.check('read');
    for (const [name, child] of [...this.node.children]) {
      yield [
        name,
        child.kind === 'dir'
          ? new FakeDirectoryHandle(this.disk, child, name, this.permission)
          : new FakeFileHandle(this.disk, this.node, name, this.permission),
      ];
    }
  }

  async isSameEntry(other: FsaHandle): Promise<boolean> {
    return other instanceof FakeDirectoryHandle && other.node === this.node;
  }

  async resolve(possibleDescendant: FsaHandle): Promise<string[] | null> {
    const target = possibleDescendant as FakeFileHandle | FakeDirectoryHandle;
    const walk = (dir: DirNode, path: string[]): string[] | null => {
      if (target instanceof FakeDirectoryHandle && dir === target.node) return path;
      if (target instanceof FakeFileHandle && dir === target.parent) return [...path, target.name];
      for (const [name, child] of dir.children) {
        if (child.kind !== 'dir') continue;
        const found = walk(child, [...path, name]);
        if (found) return found;
      }
      return null;
    };
    return walk(this.node, []);
  }
}
