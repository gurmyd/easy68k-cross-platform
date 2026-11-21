import { describe, expect, it } from 'vitest';
import { SYNC_FILES_CONTRACT_CASES } from '../backend-contract';
import { MemorySyncFiles } from './memory';

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('MemorySyncFiles passes the SyncFiles contract', () => {
  for (const c of SYNC_FILES_CONTRACT_CASES) it(c.name, () => c.run(new MemorySyncFiles(), '/memory/test'));
});

describe('MemorySyncFiles', () => {
  it('starts with the given files and read-only marks', () => {
    const view = new MemorySyncFiles({
      files: { '/memory/demo/data.txt': text('hello'), '/memory/demo/ro.txt': text('ro') },
      readOnly: ['/memory/demo/ro.txt'],
    });
    expect(view.stat('/memory/demo/data.txt')).toEqual({ size: 5, readOnly: false });
    expect(view.stat('/memory/demo/ro.txt')).toEqual({ size: 2, readOnly: true });
    expect(view.write('/memory/demo/ro.txt', 0, text('x'))).toBe(false);
    expect(view.create('/memory/demo/ro.txt')).toBe(false);
    expect(view.remove('/memory/demo/ro.txt')).toBe(false);
    expect(view.paths()).toEqual(['/memory/demo/data.txt', '/memory/demo/ro.txt']);
  });

  it('resolves names case-insensitively against stored files and folders', () => {
    const view = new MemorySyncFiles({ files: { '/memory/Demo/Sub/Data.TXT': text('x') } });
    expect(view.resolve('/memory/Demo', 'sub\\data.txt')).toBe('/memory/Demo/Sub/Data.TXT');
    expect(view.resolve('/memory/Demo', 'SUB\\new.txt')).toBe('/memory/Demo/Sub/new.txt');
    expect(view.resolve('/memory/Demo', 'nosuch\\new.txt')).toBe('/memory/Demo/nosuch/new.txt');
    expect(view.resolve('/memory/Demo', '..\\..\\x')).toBeNull();
    expect(view.resolve('/memory/Demo', 'D:\\x')).toBeNull();
  });

  it('keeps names inside what it may reach', () => {
    const view = new MemorySyncFiles({ reach: ['/memory/granted'] });
    expect(view.resolve('/memory/granted', 'a.txt')).toBe('/memory/granted/a.txt');
    expect(view.resolve('/memory/granted', '..\\other\\a.txt')).toBeNull();
    expect(view.create('/memory/other/a.txt')).toBe(false);
  });

  it('creates files only in folders that exist', async () => {
    const view = new MemorySyncFiles();
    expect(view.create('/memory/nofolder/a.txt')).toBe(false);
    await view.prepare('/memory/newfolder');
    expect(view.create('/memory/newfolder/a.txt')).toBe(true);
    expect(view.create('/memory/newfolder')).toBe(false); // a folder is not a file
  });

  it('test helpers', () => {
    const view = new MemorySyncFiles();
    view.put('/memory/x/y.bin', Uint8Array.of(1, 2));
    expect([...(view.get('/memory/x/y.bin') ?? [])]).toEqual([1, 2]);
    expect(view.get('/memory/none')).toBeUndefined();
    view.setReadOnly('/memory/x/y.bin');
    expect(view.stat('/memory/x/y.bin')?.readOnly).toBe(true);
    expect(view.unsettled).toBe(false);
  });

  it('reads return copies', () => {
    const view = new MemorySyncFiles({ files: { '/memory/a': text('abc') } });
    const read = view.read('/memory/a', 0, 3) as Uint8Array;
    read[0] = 0;
    expect(view.read('/memory/a', 0, 1)).toEqual(text('a'));
    expect(view.read('/memory/a', -1, 1)).toBeNull();
  });
});
