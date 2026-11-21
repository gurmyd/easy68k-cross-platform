import { describe, expect, it } from 'vitest';
import type { BackendChange, Bytes, DirEntry, FileStat, FileSystemBackend, VfsChange } from '../contracts';
import { DEFAULT_SNAPSHOT_LIMITS } from '../contracts';
import { MemoryBackend } from './memory-backend';
import { createVfs, fsError, isFsError } from './vfs';

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const str = (b: Bytes) => String.fromCharCode(...b);

async function vfsWith(files: Record<string, string>) {
  const backend = new MemoryBackend();
  const vfs = createVfs();
  vfs.mount(backend);
  for (const [rel, content] of Object.entries(files)) await backend.writeFile(rel, text(content));
  return { vfs, backend };
}

describe('mounting', () => {
  it('routes paths to the backend of their mount', async () => {
    const vfs = createVfs();
    const memory = new MemoryBackend();
    const browser = new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' });
    vfs.mount(memory);
    vfs.mount(browser);
    expect(vfs.backends().map((b) => b.mount)).toEqual(['memory', 'browser']);
    await vfs.writeFile('/browser/demo/a.txt', text('B'));
    expect(await memory.stat('demo/a.txt')).toBeNull();
    expect(str(await browser.readFile('demo/a.txt'))).toBe('B');
    expect(() => vfs.mount(new MemoryBackend())).toThrow(/already mounted/);
    vfs.unmount('browser');
    await expect(vfs.readFile('/browser/demo/a.txt')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects what is not a VPath', async () => {
    const { vfs } = await vfsWith({});
    await expect(vfs.readFile('memory/x')).rejects.toMatchObject({ code: 'invalid-path' });
    await expect(vfs.writeFile('/memory/../x', text('x'))).rejects.toMatchObject({ code: 'invalid-path' });
    await expect(vfs.stat('/nothing/x')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('passes the operations through', async () => {
    const { vfs } = await vfsWith({});
    await vfs.writeFile('/memory/d/f.txt', text('one'));
    await vfs.appendFile('/memory/d/f.txt', text('+two'));
    expect(str(await vfs.readFile('/memory/d/f.txt'))).toBe('one+two');
    expect((await vfs.stat('/memory/d/f.txt'))?.size).toBe(7);
    expect(await vfs.list('/memory/d')).toEqual([{ name: 'f.txt', kind: 'file' }]);
    await vfs.remove('/memory/d/f.txt');
    expect(await vfs.stat('/memory/d/f.txt')).toBeNull();
  });
});

describe('mkdirp (gate I1)', () => {
  it('creates the folder and the folders above it, and may be repeated', async () => {
    const { vfs, backend } = await vfsWith({});
    await vfs.mkdirp('/memory/a/b/c');
    await vfs.mkdirp('/memory/a/b/c');
    await vfs.mkdirp('/memory/a');
    expect((await vfs.stat('/memory/a/b/c'))?.kind).toBe('dir');
    expect(await vfs.list('/memory/a/b/c')).toEqual([]);
    expect(await backend.list('a')).toEqual([{ name: 'b', kind: 'dir' }]);
  });

  it('is reported as one write of the folder asked for, also when it existed', async () => {
    const { vfs } = await vfsWith({});
    const seen: VfsChange[] = [];
    const below: VfsChange[] = [];
    vfs.subscribe('/', (c) => seen.push(c));
    vfs.subscribe('/memory/x', (c) => below.push(c));
    await vfs.mkdirp('/memory/x/y');
    await vfs.mkdirp('/memory/x/y');
    await vfs.mkdirp('/memory/other');
    expect(seen).toEqual([
      { path: '/memory/x/y', kind: 'write', origin: 'local' },
      { path: '/memory/x/y', kind: 'write', origin: 'local' },
      { path: '/memory/other', kind: 'write', origin: 'local' },
    ]);
    expect(below).toHaveLength(2);
  });

  it('fails like the backend and then reports nothing', async () => {
    const { vfs } = await vfsWith({ 'd/f.txt': 'x' });
    const seen: VfsChange[] = [];
    vfs.subscribe('/', (c) => seen.push(c));
    await expect(vfs.mkdirp('/memory/d/f.txt/sub')).rejects.toMatchObject({ code: 'not-directory' });
    await expect(vfs.mkdirp('/memory/d/f.txt')).rejects.toMatchObject({ code: 'not-directory' });
    await expect(vfs.mkdirp('memory/d')).rejects.toMatchObject({ code: 'invalid-path' });
    await expect(vfs.mkdirp('/memory/../d')).rejects.toMatchObject({ code: 'invalid-path' });
    await expect(vfs.mkdirp('/nothing/d')).rejects.toMatchObject({ code: 'not-found' });
    expect(seen).toEqual([]);
    expect(str(await vfs.readFile('/memory/d/f.txt'))).toBe('x');
  });

  it('the root of a mount exists already', async () => {
    const { vfs } = await vfsWith({});
    await vfs.mkdirp('/memory');
    expect((await vfs.stat('/memory'))?.kind).toBe('dir');
  });
});

describe('fsError', () => {
  it('carries the code', () => {
    const error = fsError('read-only', 'no');
    expect(error).toBeInstanceOf(Error);
    expect(isFsError(error)).toBe(true);
    expect(isFsError(error, 'read-only')).toBe(true);
    expect(isFsError(error, 'not-found')).toBe(false);
    expect(isFsError(new Error('x'))).toBe(false);
  });
});

describe('vfs.resolve (Windows-style names)', () => {
  const files = {
    'demo/prog.X68': 'p',
    'demo/Data.TXT': 'd',
    'demo/Sub Dir/inc.x68': 'i',
    'other/lib.X68': 'l',
  };

  it.each([
    ['prog.X68', '/memory/demo/prog.X68', 'exact name'],
    ['PROG.x68', '/memory/demo/prog.X68', 'mixed case finds the stored spelling'],
    ['data.txt', '/memory/demo/Data.TXT', 'lower case'],
    ['Sub Dir\\inc.x68', '/memory/demo/Sub Dir/inc.x68', 'backslash'],
    ['sub dir/INC.X68', '/memory/demo/Sub Dir/inc.x68', 'slash and case in the folder too'],
    ['.\\prog.X68', '/memory/demo/prog.X68', 'dot'],
    ['..\\other\\LIB.x68', '/memory/other/lib.X68', '.. inside the mount'],
    ['Sub Dir\\..\\prog.X68', '/memory/demo/prog.X68', '.. after a folder'],
    ['nothere\\..\\prog.X68', '/memory/demo/prog.X68', '.. is lexical, as on Windows'],
    ['Sub Dir', '/memory/demo/Sub Dir', 'a folder'],
  ])('/memory/demo + %j -> %j (%s)', async (name, expected) => {
    const { vfs } = await vfsWith(files);
    expect(await vfs.resolve('/memory/demo', name)).toBe(expected);
  });

  it.each([
    ['..\\..\\x.X68', '.. outside the mount'],
    ['C:\\demo\\prog.X68', 'drive letter'],
    ['c:prog.X68', 'drive letter without separator'],
    ['\\demo\\prog.X68', 'leading backslash'],
    ['/demo/prog.X68', 'leading slash'],
    ['missing.X68', 'not found'],
    ['prog.X68\\x', 'a file used as a folder'],
    ['', 'empty name'],
  ])('/memory/demo + %j -> null (%s)', async (name) => {
    const { vfs } = await vfsWith(files);
    expect(await vfs.resolve('/memory/demo', name)).toBeNull();
  });

  it('prefers the exact spelling when two differ only in case', async () => {
    const { vfs } = await vfsWith({ 'd/abc.txt': '1', 'd/ABC.txt': '2' });
    expect(await vfs.resolve('/memory/d', 'ABC.txt')).toBe('/memory/d/ABC.txt');
    expect(await vfs.resolve('/memory/d', 'abc.txt')).toBe('/memory/d/abc.txt');
  });

  it('returns null for an unknown mount or a missing folder', async () => {
    const { vfs } = await vfsWith(files);
    expect(await vfs.resolve('/browser/demo', 'prog.X68')).toBeNull();
    expect(await vfs.resolve('/memory/nofolder', 'prog.X68')).toBeNull();
  });
});

/** A backend whose operations finish in an order chosen by the test (later calls first). */
class SlowBackend extends MemoryBackend {
  delays: number[] = [];
  private calls = 0;
  private wait(): Promise<void> {
    const delay = this.delays[this.calls++] ?? 0;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
  override async writeFile(rel: string, data: Bytes): Promise<void> {
    await this.wait();
    return super.writeFile(rel, data);
  }
  override async appendFile(rel: string, data: Bytes): Promise<void> {
    await this.wait();
    return super.appendFile(rel, data);
  }
  override async remove(rel: string): Promise<void> {
    await this.wait();
    return super.remove(rel);
  }
  override async mkdirp(rel: string): Promise<void> {
    await this.wait();
    return super.mkdirp(rel);
  }
}

describe('per-path ordering', () => {
  it('two overlapping writes to one path finish in call order', async () => {
    const backend = new SlowBackend();
    backend.delays = [30, 0]; // unordered, the second write would land first
    const vfs = createVfs();
    vfs.mount(backend);
    const finished: string[] = [];
    const first = vfs.writeFile('/memory/f.txt', text('first')).then(() => finished.push('first'));
    const second = vfs.writeFile('/memory/f.txt', text('second')).then(() => finished.push('second'));
    await Promise.all([first, second]);
    expect(finished).toEqual(['first', 'second']);
    expect(str(await backend.readFile('f.txt'))).toBe('second');
  });

  it('writes, appends and removes of one path run one at a time in call order', async () => {
    const backend = new SlowBackend();
    backend.delays = [20, 0, 10, 0, 5];
    const vfs = createVfs();
    vfs.mount(backend);
    const ops = [
      vfs.writeFile('/memory/log.txt', text('A')),
      vfs.appendFile('/memory/log.txt', text('B')),
      vfs.appendFile('/memory/log.txt', text('C')),
      vfs.remove('/memory/log.txt'),
      vfs.appendFile('/memory/log.txt', text('D')),
    ];
    await Promise.all(ops);
    expect(str(await backend.readFile('log.txt'))).toBe('D');
  });

  it('mkdirp waits its turn among the writes and removes of its path', async () => {
    const backend = new SlowBackend();
    backend.delays = [30, 0, 15, 0]; // unordered, the mkdirp would run before the file is removed
    const vfs = createVfs();
    vfs.mount(backend);
    const order: string[] = [];
    await Promise.all([
      vfs.writeFile('/memory/name', text('a file first')).then(() => order.push('write')),
      vfs.remove('/memory/name').then(() => order.push('remove')),
      vfs.mkdirp('/memory/name').then(() => order.push('mkdirp')),
      vfs.stat('/memory/name').then((stat) => order.push(`stat:${stat?.kind}`)),
    ]);
    expect(order).toEqual(['write', 'remove', 'mkdirp', 'stat:dir']);
  });

  it('paths that differ only in case share one queue', async () => {
    const backend = new SlowBackend();
    backend.delays = [20, 0];
    const vfs = createVfs();
    vfs.mount(backend);
    const order: string[] = [];
    await Promise.all([
      vfs.writeFile('/memory/F.txt', text('1')).then(() => order.push('F')),
      vfs.writeFile('/memory/f.txt', text('2')).then(() => order.push('f')),
    ]);
    expect(order).toEqual(['F', 'f']);
  });

  it('writes to different paths are not held up by each other', async () => {
    const backend = new SlowBackend();
    backend.delays = [30, 0];
    const vfs = createVfs();
    vfs.mount(backend);
    const order: string[] = [];
    await Promise.all([
      vfs.writeFile('/memory/a.txt', text('a')).then(() => order.push('a')),
      vfs.writeFile('/memory/b.txt', text('b')).then(() => order.push('b')),
    ]);
    expect(order).toEqual(['b', 'a']);
  });

  it('a failed write does not stop the next one; a read waits for earlier writes', async () => {
    const backend = new SlowBackend();
    backend.delays = [20, 0];
    const vfs = createVfs();
    vfs.mount(backend);
    await backend.mkdirp('dir');
    const failing = vfs.writeFile('/memory/dir', text('x')); // a folder: is-directory
    const next = vfs.writeFile('/memory/dir/ok.txt', text('ok'));
    const written = vfs.writeFile('/memory/r.txt', text('late'));
    const read = vfs.readFile('/memory/r.txt');
    await expect(failing).rejects.toMatchObject({ code: 'is-directory' });
    await next;
    await written;
    expect(str(await read)).toBe('late');
  });
});

describe('subscribe', () => {
  it('sees local changes and changes the backend reports, below the prefix only', async () => {
    const { vfs, backend } = await vfsWith({});
    const seen: VfsChange[] = [];
    const all: VfsChange[] = [];
    const stop = vfs.subscribe('/memory/demo', (c) => seen.push(c));
    vfs.subscribe('/', (c) => all.push(c));
    await vfs.writeFile('/memory/demo/a.txt', text('a'));
    await vfs.appendFile('/memory/demo/sub/b.txt', text('b'));
    await vfs.writeFile('/memory/demo2/c.txt', text('c')); // not below /memory/demo
    await backend.externalWrite('demo/ext.txt', text('e'));
    await backend.externalRemove('demo/ext.txt');
    await vfs.remove('/memory/demo/a.txt');
    expect(seen).toEqual([
      { path: '/memory/demo/a.txt', kind: 'write', origin: 'local' },
      { path: '/memory/demo/sub/b.txt', kind: 'write', origin: 'local' },
      { path: '/memory/demo/ext.txt', kind: 'write', origin: 'external' },
      { path: '/memory/demo/ext.txt', kind: 'remove', origin: 'external' },
      { path: '/memory/demo/a.txt', kind: 'remove', origin: 'local' },
    ]);
    expect(all).toHaveLength(6);
    stop();
    await vfs.writeFile('/memory/demo/a.txt', text('again'));
    expect(seen).toHaveLength(5);
  });

  it('reports nothing for a failed write, and nothing after unmount', async () => {
    const { vfs, backend } = await vfsWith({ 'ro.txt': 'x' });
    backend.setReadOnly('ro.txt');
    const seen: VfsChange[] = [];
    vfs.subscribe('/memory', (c) => seen.push(c));
    await expect(vfs.writeFile('/memory/ro.txt', text('y'))).rejects.toMatchObject({ code: 'read-only' });
    vfs.unmount('memory');
    backend.emitExternal({ rel: 'ro.txt', kind: 'write' });
    expect(seen).toEqual([]);
  });
});

describe('snapshot', () => {
  it('takes every file below the folder with its bytes and mtime', async () => {
    const { vfs, backend } = await vfsWith({
      'demo/prog.X68': 'p',
      'demo/inc/a.x68': 'a',
      'demo/inc/deeper/b.x68': 'b',
      'elsewhere/x': 'x',
    });
    const snap = await vfs.snapshot('/memory/demo', DEFAULT_SNAPSHOT_LIMITS);
    expect(snap.root).toBe('/memory/demo');
    expect([...snap.files.keys()].sort()).toEqual(['inc/a.x68', 'inc/deeper/b.x68', 'prog.X68']);
    expect(str(snap.files.get('inc/a.x68')?.data as Bytes)).toBe('a');
    expect(snap.files.get('prog.X68')?.mtime).toBe((await backend.stat('demo/prog.X68'))?.mtime);
    expect(snap.skipped).toEqual([]);
  });

  it('limits the number of files, nearest first', async () => {
    const { vfs } = await vfsWith({ 'd/sub/z1': '1', 'd/a': '1', 'd/b': '1', 'd/c': '1' });
    const snap = await vfs.snapshot('/memory/d', { ...DEFAULT_SNAPSHOT_LIMITS, maxFiles: 2 });
    expect([...snap.files.keys()]).toEqual(['a', 'b']);
    expect(snap.skipped).toEqual([
      { path: 'c', reason: 'too-many' },
      { path: 'sub/z1', reason: 'too-many' },
    ]);
  });

  it('limits the size of one file and of all files', async () => {
    const { vfs } = await vfsWith({ 'd/big': '0123456789', 'd/m1': '12345', 'd/m2': '12345', 'd/m3': '1' });
    const snap = await vfs.snapshot('/memory/d', { ...DEFAULT_SNAPSHOT_LIMITS, maxFileBytes: 9, maxTotalBytes: 10 });
    expect([...snap.files.keys()]).toEqual(['m1', 'm2']);
    expect(snap.skipped).toEqual([
      { path: 'big', reason: 'too-large' },
      { path: 'm3', reason: 'too-large' },
    ]);
  });

  it('limits the depth: files maxDepth folders down are taken, deeper folders are skipped', async () => {
    const { vfs } = await vfsWith({ 'r/0.txt': '', 'r/1/1.txt': '', 'r/1/2/2.txt': '', 'r/1/2/3/3.txt': '' });
    const snap = await vfs.snapshot('/memory/r', { ...DEFAULT_SNAPSHOT_LIMITS, maxDepth: 2 });
    expect([...snap.files.keys()]).toEqual(['0.txt', '1/1.txt', '1/2/2.txt']);
    expect(snap.skipped).toEqual([{ path: '1/2/3', reason: 'too-deep' }]);
  });

  it('lists unreadable files', async () => {
    class Unreadable extends MemoryBackend {
      override async readFile(rel: string): Promise<Bytes> {
        if (rel.endsWith('bad')) throw fsError('io', 'device error');
        return super.readFile(rel);
      }
    }
    const backend = new Unreadable();
    await backend.writeFile('d/bad', text('x'));
    await backend.writeFile('d/good', text('y'));
    const vfs = createVfs();
    vfs.mount(backend);
    const snap = await vfs.snapshot('/memory/d', DEFAULT_SNAPSHOT_LIMITS);
    expect([...snap.files.keys()]).toEqual(['good']);
    expect(snap.skipped).toEqual([{ path: 'bad', reason: 'unreadable' }]);
  });

  it('the default limits are those of 3.8.1', () => {
    expect(DEFAULT_SNAPSHOT_LIMITS).toEqual({
      maxFiles: 2000,
      maxFileBytes: 33554432,
      maxTotalBytes: 268435456,
      maxDepth: 4,
    });
  });

  it('rejects a folder that does not exist', async () => {
    const { vfs } = await vfsWith({ 'f.txt': 'x' });
    await expect(vfs.snapshot('/memory/none', DEFAULT_SNAPSHOT_LIMITS)).rejects.toMatchObject({ code: 'not-found' });
    await expect(vfs.snapshot('/memory/f.txt', DEFAULT_SNAPSHOT_LIMITS)).rejects.toMatchObject({
      code: 'not-directory',
    });
  });
});

describe('a backend without change reports', () => {
  it('can be mounted', async () => {
    const minimal: FileSystemBackend = {
      mount: 'plain',
      kind: 'memory',
      label: 'Plain',
      stat: async (): Promise<FileStat | null> => null,
      readFile: async () => new Uint8Array(0),
      writeFile: async () => {},
      appendFile: async () => {},
      remove: async () => {},
      list: async (): Promise<DirEntry[]> => [],
      mkdirp: async () => {},
    };
    const vfs = createVfs();
    vfs.mount(minimal);
    const seen: BackendChange[] = [];
    vfs.subscribe('/plain', (c) => seen.push({ rel: c.path, kind: c.kind }));
    await vfs.writeFile('/plain/x', text('x'));
    expect(seen).toEqual([{ rel: '/plain/x', kind: 'write' }]);
  });
});
