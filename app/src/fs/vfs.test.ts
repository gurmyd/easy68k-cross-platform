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

  it('on a backend that refuses nothing, lists each folder on the way once and asks nothing else', async () => {
    const backend = new CountingBackend();
    const vfs = createVfs();
    vfs.mount(backend);
    for (const [rel, content] of Object.entries(files)) await backend.writeFile(rel, text(content));
    backend.calls.length = 0;
    expect(await vfs.resolve('/memory/demo', 'SUB DIR\\INC.X68')).toBe('/memory/demo/Sub Dir/inc.x68');
    expect(backend.calls).toEqual(['list ', 'list demo', 'list demo/Sub Dir']);
    backend.calls.length = 0;
    expect(await vfs.resolve('/memory/demo', 'missing\\x.X68')).toBeNull();
    expect(backend.calls).toEqual(['list ', 'list demo']);
    backend.calls.length = 0;
    expect(await vfs.resolve('/memory/demo', 'prog.X68\\x')).toBeNull();
    expect(backend.calls).toEqual(['list ', 'list demo']);
  });
});

/** A MemoryBackend that records the calls resolve makes. */
class CountingBackend extends MemoryBackend {
  readonly calls: string[] = [];
  override async list(rel: string): Promise<DirEntry[]> {
    this.calls.push(`list ${rel}`);
    return super.list(rel);
  }
  override async stat(rel: string): Promise<FileStat | null> {
    this.calls.push(`stat ${rel}`);
    return super.stat(rel);
  }
}

/**
 * The desktop app's /disk as the main process serves it (desktop/src/fs-ipc.ts, security.ts):
 * stat, list and readFile refuse every path that is not inside a granted root, with the code and
 * the message the bridge gives (`io`, "refused: ..."). With `caseInsensitive` it behaves like a
 * macOS or Windows disk: a path in another letter case names the same entry, and the granted-root
 * check is made on the stored spelling (the main process's canonicalPath). Folders listed in
 * `unreadable` exist but cannot be listed (code `read-only`, as EACCES arrives).
 */
class GrantedDisk extends MemoryBackend {
  readonly calls: string[] = [];
  constructor(
    private readonly granted: readonly string[],
    private readonly options: { caseInsensitive?: boolean; unreadable?: readonly string[] } = {},
  ) {
    super({ mount: 'disk', kind: 'disk', label: 'This Mac' });
  }

  /** The stored spelling of `rel` where the disk ignores case (as far as it exists). */
  private async canonical(rel: string): Promise<string> {
    if (!this.options.caseInsensitive || rel === '') return rel;
    const out: string[] = [];
    let exists = true;
    for (const segment of rel.split('/')) {
      let chosen = segment;
      if (exists) {
        const entries = await super.list(out.join('/')).catch(() => null);
        const hit = entries?.find((e) => e.name.toLowerCase() === segment.toLowerCase());
        if (hit) chosen = hit.name;
        else exists = false;
      }
      out.push(chosen);
    }
    return out.join('/');
  }

  private async allowed(rel: string): Promise<string> {
    const real = await this.canonical(rel);
    if (!this.granted.some((root) => real === root || real.startsWith(`${root}/`))) {
      throw fsError('io', `refused: outside the folders this app may use: /disk/${rel}`);
    }
    return real;
  }

  override async list(rel: string): Promise<DirEntry[]> {
    this.calls.push(`list ${rel}`);
    const real = await this.allowed(rel);
    if (this.options.unreadable?.includes(real)) throw fsError('read-only', `not permitted: /disk/${rel}`);
    return super.list(real);
  }

  override async stat(rel: string): Promise<FileStat | null> {
    this.calls.push(`stat ${rel}`);
    return super.stat(await this.allowed(rel));
  }

  override async readFile(rel: string): Promise<Bytes> {
    this.calls.push(`readFile ${rel}`);
    return super.readFile(await this.allowed(rel));
  }
}

describe('vfs.resolve on a mount that refuses to list above a granted folder (defect D1)', () => {
  const DEMO = '/disk/Users/me/demo';
  async function diskWith(options: ConstructorParameters<typeof GrantedDisk>[1] = {}) {
    const disk = new GrantedDisk(['Users/me/demo'], options);
    for (const [rel, content] of Object.entries({
      'Users/me/demo/tutorial1.X68': 's',
      'Users/me/demo/tutorial1.L68': 'l',
      'Users/me/demo/Sub/Data.TXT': 'd',
      'Users/me/demo/locked/inside.txt': 'i',
      'Users/me/other/secret.txt': 'x',
    })) {
      await disk.writeFile(rel, text(content));
    }
    const vfs = createVfs();
    vfs.mount(disk);
    disk.calls.length = 0;
    return { vfs, disk };
  }

  it('DV5 reproduction: stat finds the .L68, and so does resolve', async () => {
    const { vfs } = await diskWith();
    expect((await vfs.stat(`${DEMO}/tutorial1.L68`))?.kind).toBe('file');
    expect(await vfs.resolve(DEMO, 'tutorial1.L68')).toBe(`${DEMO}/tutorial1.L68`);
  });

  for (const caseInsensitive of [false, true]) {
    const disk = caseInsensitive ? 'a disk that ignores letter case' : 'a case-sensitive disk';
    describe(`on ${disk}`, () => {
      it.each([
        ['tutorial1.L68', `${DEMO}/tutorial1.L68`, 'the name exists exactly as given'],
        ['TUTORIAL1.l68', `${DEMO}/tutorial1.L68`, 'another letter case in the last segment: the stored spelling'],
        ['sub\\DATA.txt', `${DEMO}/Sub/Data.TXT`, 'another letter case in a folder below the granted root'],
        ['.\\Sub/..\\tutorial1.X68', `${DEMO}/tutorial1.X68`, "'.', '..' and both separators"],
        ['..\\demo\\tutorial1.L68', `${DEMO}/tutorial1.L68`, 'out of the granted root and back in the same case'],
        ['Sub', `${DEMO}/Sub`, 'a folder'],
      ])('%j -> %j (%s)', async (name, expected) => {
        const { vfs } = await diskWith({ caseInsensitive });
        expect(await vfs.resolve(DEMO, name)).toBe(expected);
      });

      it.each([
        ['missing.L68', 'a name that does not exist'],
        ['Sub\\missing\\x.txt', 'a folder that does not exist'],
        ['tutorial1.X68\\x', 'a file used as a folder'],
        ['..\\other\\secret.txt', 'a file outside the granted roots, although it exists'],
        ['..\\..\\me\\other\\secret.txt', 'the same, through more folders'],
        ['..', 'the folder above the granted root'],
        ['C:\\Users\\me\\demo\\tutorial1.L68', 'a drive letter'],
        ['', 'an empty name'],
      ])('%j -> null (%s)', async (name) => {
        const { vfs } = await diskWith({ caseInsensitive });
        expect(await vfs.resolve(DEMO, name)).toBeNull();
      });

      it('the granted folder itself, named from the folder above it', async () => {
        const { vfs } = await diskWith({ caseInsensitive });
        expect(await vfs.resolve('/disk/Users/me', 'demo')).toBe(DEMO);
      });

      it('a folder that may not be listed for another reason: the name as given, if it is there', async () => {
        const { vfs } = await diskWith({ caseInsensitive, unreadable: ['Users/me/demo/locked'] });
        expect(await vfs.resolve(DEMO, 'locked\\inside.txt')).toBe(`${DEMO}/locked/inside.txt`);
        expect(await vfs.resolve(DEMO, 'locked\\missing.txt')).toBeNull();
        // The spelling cannot be learnt there; a disk that ignores case still finds the file.
        expect(await vfs.resolve(DEMO, 'locked\\INSIDE.TXT')).toBe(
          caseInsensitive ? `${DEMO}/locked/INSIDE.TXT` : null,
        );
      });
    });
  }

  it('a segment above the granted root in another letter case: found where the disk ignores case', async () => {
    // Only a name that leaves the granted root and comes back can do this. The stored spelling of
    // the climbed segment cannot be learnt without listing /Users/me, which is not granted.
    expect(await (await diskWith({ caseInsensitive: true })).vfs.resolve(DEMO, '..\\DEMO\\tutorial1.l68')).toBe(
      '/disk/Users/me/DEMO/tutorial1.L68',
    );
    expect(await (await diskWith({ caseInsensitive: false })).vfs.resolve(DEMO, '..\\DEMO\\tutorial1.l68')).toBeNull();
  });

  it('a segment named from a folder that may not be listed keeps the spelling as given (W1.md 15.1)', async () => {
    // The granted folder named from the folder above it, in another letter case: /Users/me may not
    // be listed, so the stored spelling "demo" cannot be learnt. Where the disk ignores case the
    // path is found and comes back as given; a caller that compares it with a stored spelling must
    // fold case (features/files/store.ts renameEntry, W1.md 15.1, request W1-case-only-rename).
    expect(await (await diskWith({ caseInsensitive: true })).vfs.resolve('/disk/Users/me', 'DEMO')).toBe(
      '/disk/Users/me/DEMO',
    );
    expect(await (await diskWith({ caseInsensitive: false })).vfs.resolve('/disk/Users/me', 'DEMO')).toBeNull();
  });

  // Review of the repair of D1, probe P6 (errata W1.md entry 16.1): only a backend's FsError is a
  // refusal to list. A programming error in a backend must not be taken for one and walked past.
  it.each([
    ['a TypeError', () => new TypeError('boom')],
    ['a plain Error without a code', () => new Error('boom')],
    ['a value that is not an Error', () => 'boom'],
  ])('a list() that throws %s gives null and asks nothing more', async (_what, thrown) => {
    class Faulty extends GrantedDisk {
      override async list(rel: string): Promise<DirEntry[]> {
        if (rel === 'Users/me/demo/Sub') {
          this.calls.push(`list ${rel}`);
          throw thrown();
        }
        return super.list(rel);
      }
    }
    for (const caseInsensitive of [false, true]) {
      const disk = new Faulty(['Users/me/demo'], { caseInsensitive });
      await disk.writeFile('Users/me/demo/Sub/Data.TXT', text('d'));
      const vfs = createVfs();
      vfs.mount(disk);
      disk.calls.length = 0;
      expect(await vfs.resolve(DEMO, 'Sub\\Data.TXT')).toBeNull();
      expect(await vfs.resolve(DEMO, 'sub\\data.txt')).toBeNull();
      expect(disk.calls.filter((call) => call.startsWith('stat'))).toEqual([]);
      // The folders the backend refuses with an FsError (those above the granted root) are still
      // walked past, as D1 needs.
      expect(await vfs.resolve('/disk/Users/me', 'demo\\Sub')).toBe(`${DEMO}/Sub`);
    }
  });

  it('asks for the listings on the way and, where the last one is refused, a stat of that path; reads nothing', async () => {
    const { vfs, disk } = await diskWith();
    expect(await vfs.resolve(DEMO, 'sub\\data.txt')).toBe(`${DEMO}/Sub/Data.TXT`);
    expect(disk.calls).toEqual([
      'list ',
      'list Users',
      'list Users/me',
      'list Users/me/demo',
      'list Users/me/demo/Sub',
    ]);
    disk.calls.length = 0;
    expect(await vfs.resolve('/disk/Users/me', 'demo')).toBe(DEMO);
    expect(disk.calls).toEqual(['list ', 'list Users', 'list Users/me', 'stat Users/me/demo']);
    disk.calls.length = 0;
    expect(await vfs.resolve(DEMO, '..\\other\\secret.txt')).toBeNull();
    expect(disk.calls).toEqual([
      'list ',
      'list Users',
      'list Users/me',
      'list Users/me/other',
      'stat Users/me/other/secret.txt',
    ]);
    expect(disk.calls.some((call) => call.startsWith('readFile'))).toBe(false);
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
      { path: '/memory/demo/sub/b.txt', kind: 'write', origin: 'local', appended: { at: 0, data: text('b') } },
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
    // The unmount itself is reported (gate I2); what the backend reports afterwards is not.
    expect(seen).toEqual([{ path: '/memory', kind: 'remove', origin: 'local' }]);
  });

  // Gate I2 (errata FS2.md C1): a store mounted while the application runs (File > Open > Open
  // folder...) must reach the Files panel and the dialogs without a write of its own.
  it('reports mount and unmount as a write and a remove of the mount root', () => {
    const vfs = createVfs();
    const all: VfsChange[] = [];
    const folder: VfsChange[] = [];
    const other: VfsChange[] = [];
    vfs.subscribe('/', (c) => all.push(c));
    vfs.subscribe('/folder', (c) => folder.push(c));
    vfs.subscribe('/memory', (c) => other.push(c));
    const backend = new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'coursework' });
    vfs.mount(backend);
    expect(all).toEqual([{ path: '/folder', kind: 'write', origin: 'local' }]); // synchronously
    vfs.unmount('folder');
    vfs.unmount('folder'); // not mounted: nothing
    vfs.mount(backend);
    expect(all).toEqual([
      { path: '/folder', kind: 'write', origin: 'local' },
      { path: '/folder', kind: 'remove', origin: 'local' },
      { path: '/folder', kind: 'write', origin: 'local' },
    ]);
    expect(folder).toEqual(all);
    expect(other).toEqual([]);
  });

  // docs/requests/SH6-append-change.md (errata W1.md entry 16.2): a view that holds a copy of a
  // growing log must not have to read the whole file again at every flush.
  it('an append says where it appended and what; every other change does not', async () => {
    const { vfs } = await vfsWith({ 'log.txt': 'one\r\n' });
    const seen: VfsChange[] = [];
    vfs.subscribe('/memory', (c) => seen.push(c));
    const bytes = text('two\r\n');
    const first = vfs.appendFile('/memory/log.txt', bytes);
    const second = vfs.appendFile('/memory/log.txt', text('3')); // queued behind the first
    bytes.fill(0); // the caller reuses its buffer: the change keeps what was appended
    await Promise.all([first, second]);
    await vfs.appendFile('/memory/new.txt', text('n')); // a file the append creates
    await vfs.writeFile('/memory/log.txt', text('x'));
    await vfs.mkdirp('/memory/dir');
    await vfs.remove('/memory/new.txt');
    expect(seen).toEqual([
      { path: '/memory/log.txt', kind: 'write', origin: 'local', appended: { at: 5, data: text('two\r\n') } },
      { path: '/memory/log.txt', kind: 'write', origin: 'local', appended: { at: 10, data: text('3') } },
      { path: '/memory/new.txt', kind: 'write', origin: 'local', appended: { at: 0, data: text('n') } },
      { path: '/memory/log.txt', kind: 'write', origin: 'local' },
      { path: '/memory/dir', kind: 'write', origin: 'local' },
      { path: '/memory/new.txt', kind: 'remove', origin: 'local' },
    ]);
    // Applying each `appended` to a copy of the old bytes gives the file as stored.
    let copy = text('one\r\n');
    for (const change of seen.slice(0, 2)) {
      expect(copy.length).toBe(change.appended?.at);
      copy = Uint8Array.from([...copy, ...(change.appended?.data ?? [])]);
    }
    expect(str(copy)).toBe('one\r\ntwo\r\n3');
    expect(str(await vfs.readFile('/memory/log.txt'))).toBe('x'); // rewritten afterwards
  });

  it('an append stores the bytes as they were at the call', async () => {
    const { vfs } = await vfsWith({});
    const bytes = text('abc');
    const done = vfs.appendFile('/memory/a.txt', bytes);
    bytes.fill(0x2d);
    await done;
    expect(str(await vfs.readFile('/memory/a.txt'))).toBe('abc');
  });

  it('an append whose size before cannot be learnt still appends, and is reported as a plain write', async () => {
    class NoStat extends MemoryBackend {
      override async stat(): Promise<FileStat | null> {
        throw fsError('io', 'stat refused');
      }
    }
    const backend = new NoStat();
    await backend.writeFile('log.txt', text('a'));
    const vfs = createVfs();
    vfs.mount(backend);
    const seen: VfsChange[] = [];
    vfs.subscribe('/', (c) => seen.push(c));
    await vfs.appendFile('/memory/log.txt', text('b'));
    expect(str(await backend.readFile('log.txt'))).toBe('ab');
    expect(seen).toEqual([{ path: '/memory/log.txt', kind: 'write', origin: 'local' }]);
  });

  it('a failed append reports nothing', async () => {
    const { vfs, backend } = await vfsWith({ 'ro.txt': 'x' });
    backend.setReadOnly('ro.txt');
    const seen: VfsChange[] = [];
    vfs.subscribe('/memory', (c) => seen.push(c));
    await expect(vfs.appendFile('/memory/ro.txt', text('y'))).rejects.toMatchObject({ code: 'read-only' });
    expect(seen).toEqual([]);
  });

  it('a mount that is refused reports nothing', () => {
    const vfs = createVfs();
    const seen: VfsChange[] = [];
    vfs.mount(new MemoryBackend());
    vfs.subscribe('/', (c) => seen.push(c));
    expect(() => vfs.mount(new MemoryBackend())).toThrow(/already mounted/);
    expect(() => vfs.mount(new MemoryBackend({ mount: 'a/b', kind: 'memory', label: 'x' }))).toThrow(TypeError);
    expect(seen).toEqual([]);
  });
});

// The review of f17e78a: a stat before every append is a round trip to the main process on the
// desktop app's disk, and the execution log appends at every flush (errata W1.md entry 17).
describe('appendFile takes the size before from what the Vfs knows', () => {
  /** A MemoryBackend that counts its stats and can hold an append until the test lets it go. */
  class Counting extends MemoryBackend {
    stats = 0;
    hold: Promise<void> | null = null;
    override async stat(rel: string): Promise<FileStat | null> {
      this.stats++;
      return super.stat(rel);
    }
    override async appendFile(rel: string, data: Bytes): Promise<void> {
      if (this.hold) await this.hold;
      return super.appendFile(rel, data);
    }
  }

  async function counting(files: Record<string, string> = {}) {
    const backend = new Counting();
    for (const [rel, content] of Object.entries(files)) await backend.writeFile(rel, text(content));
    const vfs = createVfs();
    vfs.mount(backend);
    const seen: VfsChange[] = [];
    vfs.subscribe('/', (c) => seen.push(c));
    backend.stats = 0;
    return { vfs, backend, seen };
  }

  /** Every `appended` of `seen` for `path`, applied in turn to `start`, gives the file; returns the offsets. */
  async function replay(vfs: ReturnType<typeof createVfs>, seen: VfsChange[], path: string, start: string) {
    let copy: Bytes = text(start);
    const offsets: (number | null)[] = [];
    for (const change of seen.filter((c) => c.path === path && c.origin === 'local')) {
      if (!change.appended) {
        offsets.push(null);
        copy = await vfs.readFile(path as `/${string}`); // a listener that cannot apply it reads the file
        continue;
      }
      offsets.push(change.appended.at);
      expect(change.appended.at, 'the copy is exactly as long as the file was').toBe(copy.length);
      copy = Uint8Array.from([...copy, ...change.appended.data]);
    }
    return { copy, offsets };
  }

  it('a run of a thousand appends makes one stat at most, and every offset is exact', async () => {
    const { vfs, backend, seen } = await counting({ 'log.txt': 'head\r\n' });
    const appends: Promise<void>[] = [];
    for (let i = 0; i < 1000; i++)
      appends.push(vfs.appendFile('/memory/log.txt', text(`${i % 10}`.repeat(1 + (i % 7)))));
    await Promise.all(appends);
    expect(backend.stats).toBe(1);
    const { copy, offsets } = await replay(vfs, seen, '/memory/log.txt', 'head\r\n');
    expect(offsets).toHaveLength(1000);
    expect(offsets.every((at) => at !== null)).toBe(true);
    expect(str(copy)).toBe(str(await backend.readFile('log.txt')));
  });

  it('after a write of the file, its appends make no stat at all (the execution log)', async () => {
    const { vfs, backend, seen } = await counting();
    await vfs.writeFile('/memory/exec.txt', text('first flush\r\n'));
    for (let i = 0; i < 100; i++) await vfs.appendFile('/memory/exec.txt', text(`line ${i}\r\n`));
    expect(backend.stats).toBe(0);
    expect(seen.at(-1)?.appended?.at).toBe((await backend.readFile('exec.txt')).length - 'line 99\r\n'.length);
  });

  it('another window changes the file between two appends: the size is asked again, the offset exact', async () => {
    const { vfs, backend, seen } = await counting({ 'log.txt': 'a' });
    await vfs.appendFile('/memory/log.txt', text('b')); // asks: 1
    await vfs.appendFile('/memory/log.txt', text('c')); // knows
    await backend.externalWrite('log.txt', text('rewritten by someone else'));
    await vfs.appendFile('/memory/log.txt', text('d')); // asks again: 2
    await vfs.appendFile('/memory/log.txt', text('e')); // and from now on always: 3
    expect(backend.stats).toBe(3);
    const local = seen.filter((c) => c.origin === 'local').map((c) => c.appended?.at);
    expect(local).toEqual([1, 2, 25, 26]);
    expect(str(await vfs.readFile('/memory/log.txt'))).toBe('rewritten by someone elsede');
  });

  // Gate I3 round 2 review: two windows over one store, whose change reports arrive late (as a
  // BroadcastChannel's do). Until another window's report arrives this Vfs cannot know of its
  // change: `at` is what this window knew, and a listener must confirm the size after the append
  // (contracts/fs.ts VfsChange.appended; errata W1.md entry 17), as CachedSyncFiles.applyAppend does.
  it("another window's change whose report arrives late: `at` is what this window knew; the size after the append tells", async () => {
    const { vfs, backend, seen } = await counting();
    await vfs.appendFile('/memory/log.txt', text('abc')); // a new file: asks, at 0
    await backend.writeFile('log.txt', text('')); // another window empties it; its report is on the way
    await vfs.appendFile('/memory/log.txt', text('d')); // this window still knows 3: no stat
    expect(backend.stats).toBe(1);
    const late = seen.filter((c) => c.origin === 'local').at(-1);
    expect(late?.appended?.at).toBe(3); // stale: the file was 0 bytes long just before
    // The rule of the contract: apply only when the copy is `at` bytes long AND the file is now
    // `at + data.length` long. Here the stat after the append says 1, not 4: the listener reads the file.
    const after = await vfs.stat('/memory/log.txt');
    expect(after?.size).toBe(1);
    expect(after?.size).not.toBe((late?.appended?.at ?? 0) + (late?.appended?.data.length ?? 0));
    // The report arrives: from now on this path's size is asked before every append, and is exact.
    backend.emitExternal({ rel: 'log.txt', kind: 'write' });
    await vfs.appendFile('/memory/log.txt', text('e'));
    expect(seen.filter((c) => c.origin === 'local').at(-1)?.appended?.at).toBe(1);
    expect(str(await vfs.readFile('/memory/log.txt'))).toBe('de');
  });

  it('a change reported while an append is in progress leaves `appended` out', async () => {
    const { vfs, backend, seen } = await counting({ 'log.txt': 'a' });
    await vfs.appendFile('/memory/log.txt', text('b'));
    let release = () => {};
    backend.hold = new Promise<void>((resolve) => (release = resolve));
    const append = vfs.appendFile('/memory/log.txt', text('c'));
    await new Promise((resolve) => setTimeout(resolve, 0)); // the append waits in the backend
    await backend.externalWrite('log.txt', text('xyz'));
    backend.hold = null;
    release();
    await append;
    const last = seen.filter((c) => c.origin === 'local').at(-1);
    expect(last).toEqual({ path: '/memory/log.txt', kind: 'write', origin: 'local' });
    expect(str(await vfs.readFile('/memory/log.txt'))).toBe('xyzc');
  });

  it('a writer the backend does not report: without onExternalChange the size is asked before every append', async () => {
    const inner = new MemoryBackend({ mount: 'plain', kind: 'memory', label: 'Plain' });
    let stats = 0;
    const plain: FileSystemBackend = {
      mount: 'plain',
      kind: 'memory',
      label: 'Plain',
      stat: (rel) => (stats++, inner.stat(rel)),
      readFile: (rel) => inner.readFile(rel),
      writeFile: (rel, data) => inner.writeFile(rel, data),
      appendFile: (rel, data) => inner.appendFile(rel, data),
      remove: (rel) => inner.remove(rel),
      list: (rel) => inner.list(rel),
      mkdirp: (rel) => inner.mkdirp(rel),
    };
    const vfs = createVfs();
    vfs.mount(plain);
    const seen: VfsChange[] = [];
    vfs.subscribe('/plain', (c) => seen.push(c));
    await vfs.writeFile('/plain/log.txt', text('ab'));
    await vfs.appendFile('/plain/log.txt', text('c'));
    await inner.appendFile('log.txt', text('XYZ')); // nobody is told
    await vfs.appendFile('/plain/log.txt', text('d'));
    expect(stats).toBe(2);
    expect(seen.map((c) => c.appended?.at)).toEqual([undefined, 2, 6]);
  });

  it('a remove, of the file or a folder above it, a write of another spelling and a failure drop the size', async () => {
    const { vfs, backend, seen } = await counting({ 'dir/log.txt': 'a' });
    await vfs.appendFile('/memory/dir/log.txt', text('b')); // asks: 1
    await vfs.remove('/memory/dir');
    await vfs.appendFile('/memory/dir/log.txt', text('c')); // asks: 2 (the file is new: 0)
    await vfs.remove('/memory/dir/log.txt');
    await vfs.appendFile('/memory/dir/log.txt', text('d')); // asks: 3
    await vfs.writeFile('/memory/dir/LOG.txt', text('other spelling'));
    await vfs.appendFile('/memory/dir/log.txt', text('e')); // asks: 4
    backend.setReadOnly('dir/log.txt');
    await expect(vfs.appendFile('/memory/dir/log.txt', text('f'))).rejects.toMatchObject({ code: 'read-only' }); // knew the size: no stat
    backend.setReadOnly('dir/log.txt', false);
    await vfs.appendFile('/memory/dir/log.txt', text('g')); // the failure dropped the size: asks, 5
    await vfs.mkdirp('/memory/dir'); // creates no file: the size stays known
    await vfs.appendFile('/memory/dir/log.txt', text('h'));
    expect(backend.stats).toBe(5);
    const offsets = seen
      .filter((c) => c.path === '/memory/dir/log.txt' && c.kind === 'write')
      .map((c) => c.appended?.at);
    expect(offsets).toEqual([1, 0, 0, 1, 2, 3]);
  });

  it('an unmount forgets the sizes of the mount', async () => {
    const { vfs, backend } = await counting({ 'log.txt': 'a' });
    await vfs.appendFile('/memory/log.txt', text('b'));
    vfs.unmount('memory');
    await backend.writeFile('log.txt', text('changed while unmounted'));
    vfs.mount(backend);
    const seen: VfsChange[] = [];
    vfs.subscribe('/memory/log.txt', (c) => seen.push(c));
    await vfs.appendFile('/memory/log.txt', text('!'));
    expect(seen[0]?.appended?.at).toBe('changed while unmounted'.length);
  });

  it('keeps the sizes of at most 64 files', async () => {
    const { vfs, backend } = await counting();
    for (let i = 0; i < 100; i++) await vfs.writeFile(`/memory/f${i}.txt`, text('x'));
    for (let i = 99; i >= 0; i--) await vfs.appendFile(`/memory/f${i}.txt`, text('y'));
    expect(backend.stats).toBe(36); // the first 36 were dropped, the last 64 are known
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
