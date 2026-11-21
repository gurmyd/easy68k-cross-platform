// Locations, import, export, rename (3.8.1, 3.8.5, 5.9). Export and import are checked by building
// the .zip and reading it back; check-files.mjs also hands the .zip to the system's archive tool.

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bytes, Vfs } from '../../contracts';
import { BrowserBackend } from '../../fs/browser-backend';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
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
