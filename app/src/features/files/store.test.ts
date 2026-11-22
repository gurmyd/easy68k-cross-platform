// Locations, import, export, rename (3.8.1, 3.8.5, 5.9). Export and import are checked by building
// the .zip and reading it back; check-files.mjs also hands the .zip to the system's archive tool.

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bytes, Vfs } from '../../contracts';
import { BrowserBackend } from '../../fs/browser-backend';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs, fsError } from '../../fs/vfs';
import { readZip } from '../../fs/zip';
import {
  buildExport,
  chooseStartDir,
  displayPath,
  importOne,
  itemsFromZip,
  listTree,
  locations,
  planImport,
  renameEntry,
  runImport,
  sortEntries,
  storedSpelling,
} from './store';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (bytes: Bytes): string => String.fromCharCode(...bytes);
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();

const stores: BrowserBackend[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

async function browserVfs(): Promise<Vfs> {
  const backend = await BrowserBackend.open({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, channel: null });
  stores.push(backend);
  const vfs = createVfs();
  vfs.mount(backend);
  return vfs;
}

/** Every file of a store with its bytes, and every folder. */
async function contents(vfs: Vfs, root = '/browser'): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const item of await listTree(vfs, root)) {
    out[item.rel + (item.kind === 'dir' ? '/' : '')] =
      item.kind === 'dir' ? '' : [...(await vfs.readFile(`${root}/${item.rel}`))].join(',');
  }
  return out;
}

async function fill(vfs: Vfs): Promise<void> {
  await vfs.writeFile('/browser/demo/prog.X68', ascii('\tORG\t$1000\r\n'));
  await vfs.writeFile('/browser/demo/prog.L68', ascii('listing'));
  await vfs.writeFile('/browser/demo/inc/macros.X68', ascii('MACRO'));
  await vfs.writeFile('/browser/Übung 1/Prüfung.X68', ascii('x'));
  await vfs.writeFile(
    '/browser/all.bin',
    Uint8Array.from({ length: 4096 }, (_, i) => i & 0xff),
  );
  await vfs.appendFile('/browser/demo/prog_RunLog.txt', ascii('one'));
  await vfs.appendFile('/browser/demo/prog_RunLog.txt', ascii('two'));
  const backend = vfs.backends()[0] as BrowserBackend;
  await backend.mkdirp('empty/inner');
}

describe('locations', { timeout: 60_000 }, () => {
  it('lists the browser store first, an opened folder, not linked files or test memory', () => {
    const vfs = createVfs();
    vfs.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: demo' }));
    vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' }));
    vfs.mount(new MemoryBackend({ mount: 'linked', kind: 'browser', label: 'Linked' }));
    vfs.mount(new MemoryBackend());
    expect(locations(vfs).map((l) => [l.root, l.label])).toEqual([
      ['/browser', 'My Programs'],
      ['/folder', 'Folder: demo'],
    ]);
    expect(displayPath(vfs, '/browser/demo/prog.X68')).toBe('My Programs/demo/prog.X68');
    expect(displayPath(vfs, '/browser')).toBe('My Programs');
  });

  it('shows a linked file by its name under the linked label, never as /linked/<id>/ (gate I2 review)', () => {
    const vfs = createVfs();
    vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' }));
    vfs.mount(new MemoryBackend({ mount: 'linked', kind: 'browser', label: 'Linked files' }));
    expect(displayPath(vfs, '/linked/21d878e9/prog.X68')).toBe('Linked files/prog.X68');
    expect(displayPath(vfs, '/linked/21d878e9')).toBe('Linked files');
    expect(displayPath(vfs, '/linked')).toBe('Linked files');
    for (const path of ['/linked/21d878e9/prog.X68', '/linked/21d878e9', '/linked'] as const) {
      expect(displayPath(vfs, path)).not.toContain('/linked');
      expect(displayPath(vfs, path)).not.toContain('21d878e9');
    }
    // Without a linked backend mounted, the label is the one FS2 gives it.
    const bare = createVfs();
    expect(displayPath(bare, '/linked/0a1b2c3d/lab.X68')).toBe('Linked files/lab.X68');
  });

  it('chooses the first existing folder as start, else the browser store', async () => {
    const vfs = await browserVfs();
    await vfs.writeFile('/browser/demo/a.txt', ascii(''));
    expect(await chooseStartDir(vfs, ['/browser/missing', '/browser/demo'])).toBe('/browser/demo');
    expect(await chooseStartDir(vfs, [null, '/browser/demo/a.txt', '/nowhere/x'])).toBe('/browser');
  });

  it('sorts folders first, then names without regard to case', () => {
    expect(
      sortEntries([
        { name: 'b.X68', kind: 'file' },
        { name: 'Z', kind: 'dir' },
        { name: 'A.X68', kind: 'file' },
        { name: 'a', kind: 'dir' },
      ]).map((e) => e.name),
    ).toEqual(['a', 'Z', 'A.X68', 'b.X68']);
  });
});

describe('export and import', { timeout: 60_000 }, () => {
  it('a whole-store export imports into an empty store with every byte equal', async () => {
    const source = await browserVfs();
    await fill(source);
    const exported = await buildExport(source, '/browser', NOW);
    expect(exported.kind).toBe('zip');
    expect(exported.name).toBe('My Programs.zip');
    expect(exported.files).toBe(6);

    const target = await browserVfs();
    const { items, skipped } = await itemsFromZip(exported.bytes);
    expect(skipped).toEqual([]);
    const plan = await planImport(target, '/browser', items);
    expect(plan.conflicts).toEqual([]);
    const result = await runImport(target, plan, () => true);
    expect(result.skipped).toEqual([]);
    expect(await contents(target)).toEqual(await contents(source));
    expect(text(await target.readFile('/browser/demo/prog_RunLog.txt'))).toBe('onetwo');
  });

  it('a folder exports as "<folder>.zip" holding the folder; a file exports as itself', async () => {
    const vfs = await browserVfs();
    await fill(vfs);
    const folder = await buildExport(vfs, '/browser/demo', NOW);
    expect(folder.name).toBe('demo.zip');
    const { entries } = await readZip(folder.bytes);
    expect(entries.map((e) => e.path)).toEqual([
      'demo/',
      'demo/inc/',
      'demo/inc/macros.X68',
      'demo/prog.L68',
      'demo/prog.X68',
      'demo/prog_RunLog.txt',
    ]);
    const single = await buildExport(vfs, '/browser/demo/prog.X68', NOW);
    expect([single.kind, single.name, text(single.bytes)]).toEqual(['file', 'prog.X68', '\tORG\t$1000\r\n']);
  });

  it('existing files are replaced or kept as the caller decides; unsafe names are refused', async () => {
    const vfs = await browserVfs();
    await vfs.writeFile('/browser/t/a.txt', ascii('old'));
    const items = [
      { rel: 'a.txt', read: async () => ascii('new') },
      { rel: 'b.txt', read: async () => ascii('b') },
      { rel: 'sub/', read: async () => new Uint8Array(0) },
      { rel: 'bad.txt', read: () => Promise.reject(new Error('cannot read')) },
    ];
    const plan = await planImport(vfs, '/browser/t', items);
    expect(plan.conflicts.map((c) => c.rel)).toEqual(['a.txt']);
    const kept = await runImport(vfs, plan, () => false);
    expect(text(await vfs.readFile('/browser/t/a.txt'))).toBe('old');
    expect(kept.skipped.map((s) => `${s.rel}: ${s.reason}`)).toEqual(['a.txt: exists', 'bad.txt: cannot read']);
    expect((await vfs.stat('/browser/t/sub'))?.kind).toBe('dir');
    await runImport(vfs, plan, () => true);
    expect(text(await vfs.readFile('/browser/t/a.txt'))).toBe('new');
  });

  it('importOne reuses an identical copy and asks before replacing a different one', async () => {
    const vfs = await browserVfs();
    const asked: string[] = [];
    const first = await importOne(vfs, '/browser/Imported', 'prog.X68', ascii('v1'), async () => true);
    expect(first).toBe('/browser/Imported/prog.X68');
    expect(await importOne(vfs, '/browser/Imported', 'PROG.x68', ascii('v1'), async (p) => (asked.push(p), true))).toBe(
      first,
    );
    expect(asked).toEqual([]);
    expect(
      await importOne(vfs, '/browser/Imported', 'prog.X68', ascii('v2'), async (p) => (asked.push(p), false)),
    ).toBe(first);
    expect(text(await vfs.readFile(first))).toBe('v1');
    await importOne(vfs, '/browser/Imported', 'prog.X68', ascii('v2'), async (p) => (asked.push(p), true));
    expect(text(await vfs.readFile(first))).toBe('v2');
    expect(asked).toEqual([first, first]);
  });
});

describe('renameEntry', { timeout: 60_000 }, () => {
  it('renames a file and a folder with everything in it, and a change of case only', async () => {
    const vfs = await browserVfs();
    await fill(vfs);
    expect(await renameEntry(vfs, '/browser/demo/prog.L68', 'old.L68')).toBe('/browser/demo/old.L68');
    expect(await vfs.stat('/browser/demo/prog.L68')).toBeNull();
    expect(text(await vfs.readFile('/browser/demo/old.L68'))).toBe('listing');
    const before = await contents(vfs, '/browser/demo');
    expect(await renameEntry(vfs, '/browser/demo', 'work')).toBe('/browser/work');
    expect(await vfs.stat('/browser/demo')).toBeNull();
    expect(await contents(vfs, '/browser/work')).toEqual(before);
    expect(await renameEntry(vfs, '/browser/work/prog.X68', 'PROG.X68')).toBe('/browser/work/PROG.X68');
    expect((await vfs.list('/browser/work')).map((e) => e.name)).toContain('PROG.X68');
    expect((await vfs.list('/browser/work')).map((e) => e.name)).not.toContain('prog.X68');
    expect(await renameEntry(vfs, '/browser/work', 'Work')).toBe('/browser/Work');
    expect(await contents(vfs, '/browser/Work')).toEqual(await contents(vfs, '/browser/Work'));
    await expect(renameEntry(vfs, '/browser/Work/PROG.X68', 'old.L68')).rejects.toThrow('already exists');
  });
});

/**
 * The desktop app's /disk on a disk that ignores letter case (macOS, Windows), with one granted root:
 * every path names the stored entry in any spelling, and stat, list and readFile refuse whatever lies
 * outside the granted root, as desktop/src/fs-ipc.ts does. With `guardWrites` the writes are refused
 * there too, as the real main process refuses them.
 */
class CaseInsensitiveGrantedDisk extends MemoryBackend {
  constructor(
    private readonly root: string,
    private readonly guardWrites = false,
  ) {
    super({ mount: 'disk', kind: 'disk', label: 'This Mac' });
  }
  private async real(rel: string): Promise<string> {
    const out: string[] = [];
    let found = true;
    for (const segment of rel === '' ? [] : rel.split('/')) {
      let chosen = segment;
      if (found) {
        const entries = await super.list(out.join('/')).catch(() => null);
        const hit = entries?.find((e) => e.name.toLowerCase() === segment.toLowerCase());
        if (hit) chosen = hit.name;
        else found = false;
      }
      out.push(chosen);
    }
    return out.join('/');
  }
  private async allowed(rel: string, guard = true): Promise<string> {
    const real = await this.real(rel);
    const inside =
      real.toLowerCase() === this.root.toLowerCase() || real.toLowerCase().startsWith(`${this.root.toLowerCase()}/`);
    if (guard && !inside) throw fsError('io', `refused: outside the folders this app may use: /disk/${rel}`);
    return real;
  }
  override async list(rel: string) {
    return super.list(await this.allowed(rel));
  }
  override async stat(rel: string) {
    return super.stat(await this.allowed(rel));
  }
  override async readFile(rel: string) {
    return super.readFile(await this.allowed(rel));
  }
  override async writeFile(rel: string, data: Bytes) {
    return super.writeFile(await this.allowed(rel, this.guardWrites), data);
  }
  override async mkdirp(rel: string) {
    return super.mkdirp(await this.allowed(rel, this.guardWrites));
  }
  override async remove(rel: string) {
    return super.remove(await this.allowed(rel, this.guardWrites));
  }
  /** The tree as stored, outside the grant included. */
  async storedNames(rel: string): Promise<string[]> {
    return (await super.list(rel)).map((e) => e.name).sort();
  }
}

// docs/requests/W1-case-only-rename.md: resolve keeps the given spelling of a segment whose folder
// may not be listed, so renameEntry must compare without regard to case.
describe('renameEntry: a change of letter case of a granted root on /disk', { timeout: 60_000 }, () => {
  async function disk(guardWrites: boolean) {
    const backend = new CaseInsensitiveGrantedDisk('Users/me/demo', guardWrites);
    await backend.writeFile('Users/me/demo/prog.X68', ascii('prog'));
    await backend.writeFile('Users/me/demo/Sub/data.txt', ascii('data'));
    const vfs = createVfs();
    vfs.mount(backend);
    return { vfs, backend };
  }

  it('resolve gives the new spelling for the root itself, which is the entry being renamed', async () => {
    const { vfs } = await disk(false);
    expect(await vfs.resolve('/disk/Users/me', 'DEMO')).toBe('/disk/Users/me/DEMO');
  });

  it('is no longer refused as "already exists"', async () => {
    // The staging folder of a case-only rename lies beside the root, outside the grant, and the main
    // process refuses it: the rename fails with that refusal and nothing is lost (errata FS1.md 25).
    for (const guardWrites of [false, true]) {
      const { vfs, backend } = await disk(guardWrites);
      const failure = await renameEntry(vfs, '/disk/Users/me/demo', 'DEMO').then(
        () => 'renamed',
        (error: Error) => error.message,
      );
      expect(failure).not.toContain('already exists');
      expect(failure).toContain('refused: outside the folders this app may use');
      expect(await backend.storedNames('Users/me')).toEqual(['demo']);
      expect(text(await vfs.readFile('/disk/Users/me/demo/prog.X68'))).toBe('prog');
      expect(text(await vfs.readFile('/disk/Users/me/demo/Sub/data.txt'))).toBe('data');
    }
  });

  it('a change of letter case below the granted root works and keeps the files', async () => {
    const { vfs, backend } = await disk(true);
    expect(await renameEntry(vfs, '/disk/Users/me/demo/Sub', 'SUB')).toBe('/disk/Users/me/demo/SUB');
    expect(await backend.storedNames('Users/me/demo')).toEqual(['SUB', 'prog.X68']);
    expect(text(await vfs.readFile('/disk/Users/me/demo/SUB/data.txt'))).toBe('data');
    expect(await renameEntry(vfs, '/disk/Users/me/demo/prog.X68', 'PROG.x68')).toBe('/disk/Users/me/demo/PROG.x68');
    expect(await backend.storedNames('Users/me/demo')).toEqual(['PROG.x68', 'SUB']);
  });

  it('a different name that exists in another spelling is still refused', async () => {
    const { vfs } = await disk(false);
    await expect(renameEntry(vfs, '/disk/Users/me/demo/prog.X68', 'SUB')).rejects.toThrow('"SUB" already exists.');
  });
});

// Review FS1, open defect 1: names that differ only in letter case are the same name (Windows).
describe('names that differ only in letter case', { timeout: 60_000 }, () => {
  async function names(vfs: Vfs, dir: string): Promise<string[]> {
    return (await vfs.list(dir)).map((e) => e.name);
  }

  for (const kind of ['memory', 'browser'] as const) {
    it(`${kind} store: rename refuses a name that exists in another spelling`, async () => {
      const vfs = kind === 'browser' ? await browserVfs() : memoryVfs();
      await vfs.writeFile('/browser/d/prog.x68', ascii('prog'));
      await vfs.writeFile('/browser/d/other.x68', ascii('other'));
      await expect(renameEntry(vfs, '/browser/d/other.x68', 'PROG.X68')).rejects.toThrow('"PROG.X68" already exists.');
      expect((await names(vfs, '/browser/d')).sort()).toEqual(['other.x68', 'prog.x68']);
      expect(text(await vfs.readFile('/browser/d/prog.x68'))).toBe('prog');
      // Folders too: D -> d2 while D2 exists.
      await vfs.writeFile('/browser/D/a.txt', ascii('a'));
      await vfs.writeFile('/browser/D2/b.txt', ascii('b'));
      await expect(renameEntry(vfs, '/browser/D', 'd2')).rejects.toThrow('already exists');
      expect(await names(vfs, '/browser/D2')).toEqual(['b.txt']);
      // A change of letter case of the entry itself is still allowed.
      expect(await renameEntry(vfs, '/browser/d/prog.x68', 'Prog.X68')).toBe('/browser/d/Prog.X68');
      expect((await names(vfs, '/browser/d')).sort()).toEqual(['Prog.X68', 'other.x68']);
    });

    it(`${kind} store: import asks before replacing a file in another spelling and keeps the stored one`, async () => {
      const vfs = kind === 'browser' ? await browserVfs() : memoryVfs();
      await vfs.writeFile('/browser/d/prog.x68', ascii('old'));
      await vfs.writeFile('/browser/d/Inc/macros.x68', ascii('old'));
      const items = [
        { rel: 'Prog.X68', read: async () => ascii('new') },
        { rel: 'INC/MACROS.X68', read: async () => ascii('new') },
        { rel: 'inc/extra.x68', read: async () => ascii('extra') },
        { rel: 'New/a.x68', read: async () => ascii('a') },
        { rel: 'NEW/b.x68', read: async () => ascii('b') },
      ];
      const plan = await planImport(vfs, '/browser/d', items);
      expect(plan.conflicts.map((c) => c.rel)).toEqual(['Prog.X68', 'INC/MACROS.X68']);
      const kept = await runImport(vfs, plan, () => false);
      expect(kept.skipped.map((s) => s.rel)).toEqual(['Prog.X68', 'INC/MACROS.X68']);
      expect(text(await vfs.readFile('/browser/d/prog.x68'))).toBe('old');
      const replaced = await runImport(vfs, plan, () => true);
      expect(replaced.written).toContain('/browser/d/prog.x68');
      expect(replaced.written).toContain('/browser/d/Inc/macros.x68');
      expect(replaced.written).toContain('/browser/d/Inc/extra.x68');
      expect(text(await vfs.readFile('/browser/d/prog.x68'))).toBe('new');
      // One spelling per name: no third spelling of prog, one Inc folder, one New folder.
      expect((await names(vfs, '/browser/d')).sort()).toEqual(['Inc', 'New', 'prog.x68']);
      expect((await names(vfs, '/browser/d/Inc')).sort()).toEqual(['extra.x68', 'macros.x68']);
      expect((await names(vfs, '/browser/d/New')).sort()).toEqual(['a.x68', 'b.x68']);
    });

    // Gate I1 round 1 review: one batch holding two spellings of a new name overwrote the first
    // file silently (conflicts [], both written to A.X68).
    it(`${kind} store: one import batch with two spellings of a new name asks before the second`, async () => {
      const vfs = kind === 'browser' ? await browserVfs() : memoryVfs();
      await vfs.mkdirp('/browser/x');
      const items = [
        { rel: 'A.X68', read: async () => ascii('first') },
        { rel: 'a.x68', read: async () => ascii('second') },
        { rel: 'Sub/b.x68', read: async () => ascii('b1') },
        { rel: 'SUB/B.X68', read: async () => ascii('b2') },
      ];
      const plan = await planImport(vfs, '/browser/x', items);
      expect(plan.conflicts.map((c) => c.rel)).toEqual(['a.x68', 'SUB/B.X68']);
      const asked: string[] = [];
      const kept = await runImport(vfs, plan, (item) => {
        asked.push(item.rel);
        return false;
      });
      expect(asked).toEqual(['a.x68', 'SUB/B.X68']);
      expect(kept.written).toEqual(['/browser/x/A.X68', '/browser/x/Sub/b.x68']);
      expect(kept.skipped.map((s) => s.rel)).toEqual(['a.x68', 'SUB/B.X68']);
      expect(text(await vfs.readFile('/browser/x/A.X68'))).toBe('first');
      expect((await names(vfs, '/browser/x')).sort()).toEqual(['A.X68', 'Sub']);
      // Yes: the second replaces the first in the stored spelling, still one entry per name.
      await vfs.remove('/browser/x/A.X68');
      await vfs.remove('/browser/x/Sub');
      const replaced = await runImport(vfs, plan, () => true);
      expect(replaced.written).toEqual([
        '/browser/x/A.X68',
        '/browser/x/A.X68',
        '/browser/x/Sub/b.x68',
        '/browser/x/Sub/b.x68',
      ]);
      expect(text(await vfs.readFile('/browser/x/A.X68'))).toBe('second');
      expect((await names(vfs, '/browser/x')).sort()).toEqual(['A.X68', 'Sub']);
    });

    it(`${kind} store: runImport asks for a file written earlier in the run even if the plan missed it`, async () => {
      const vfs = kind === 'browser' ? await browserVfs() : memoryVfs();
      const items = [
        { rel: 'P.X68', read: async () => ascii('1') },
        { rel: 'p.x68', read: async () => ascii('2') },
      ];
      const asked: string[] = [];
      const result = await runImport(vfs, { dir: '/browser/y', items, conflicts: [], refused: [] }, (item) => {
        asked.push(item.rel);
        return false;
      });
      expect(asked).toEqual(['p.x68']);
      expect(result.written).toEqual(['/browser/y/P.X68']);
      expect(text(await vfs.readFile('/browser/y/P.X68'))).toBe('1');
    });

    it(`${kind} store: importOne and storedSpelling use the stored spelling of every part`, async () => {
      const vfs = kind === 'browser' ? await browserVfs() : memoryVfs();
      await vfs.writeFile('/browser/imported/Prog.x68', ascii('v1'));
      expect(await storedSpelling(vfs, '/browser/Imported/PROG.X68')).toBe('/browser/imported/Prog.x68');
      expect(await storedSpelling(vfs, '/browser/IMPORTED/new/x.X68')).toBe('/browser/imported/new/x.X68');
      expect(await storedSpelling(vfs, '/browser')).toBe('/browser');
      const path = await importOne(vfs, '/browser/Imported', 'prog.X68', ascii('v2'), async () => true);
      expect(path).toBe('/browser/imported/Prog.x68');
      expect(await names(vfs, '/browser')).toEqual(['imported']);
      expect(await names(vfs, '/browser/imported')).toEqual(['Prog.x68']);
      expect(text(await vfs.readFile(path))).toBe('v2');
    });
  }
});

function memoryVfs(): Vfs {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' }));
  return vfs;
}
