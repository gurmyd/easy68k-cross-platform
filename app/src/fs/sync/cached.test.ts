import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SNAPSHOT_LIMITS,
  type Bytes,
  type Scheduler,
  type SnapshotLimits,
  type Vfs,
  type VPath,
} from '../../contracts';
import { SYNC_FILES_CONTRACT_CASES } from '../backend-contract';
import { MemoryBackend } from '../memory-backend';
import { createVfs, fsError } from '../vfs';
import { CachedSyncFiles, WRITE_BEHIND_MS, unavailableMessage } from './cached';

const text = (s: string): Bytes => Uint8Array.from(s, (c) => c.charCodeAt(0));
const str = (b: Bytes | null | undefined): string | null => (b ? String.fromCharCode(...b) : null);

/** Timers that run only when the test says so. */
function manualScheduler(): Scheduler & { runTimers(): number; pending(): number[] } {
  let timers: { due: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    onFrame: () => () => {},
    setTimer(delayMs, fn) {
      const id = next++;
      timers.push({ due: delayMs, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    runTimers() {
      const due = timers;
      timers = [];
      for (const t of due) t.fn();
      return due.length;
    },
    pending: () => timers.map((t) => t.due),
  };
}

interface Setup {
  vfs: Vfs;
  backend: MemoryBackend;
  scheduler: ReturnType<typeof manualScheduler>;
  messages: string[];
  view: CachedSyncFiles;
}

async function setup(files: Record<string, string> = {}, limits?: SnapshotLimits): Promise<Setup> {
  const backend = new MemoryBackend();
  const vfs = createVfs();
  vfs.mount(backend);
  await vfs.mkdirp('/memory/demo');
  for (const [rel, content] of Object.entries(files)) await vfs.writeFile(`/memory/${rel}`, text(content));
  const scheduler = manualScheduler();
  const messages: string[] = [];
  const view = new CachedSyncFiles({
    vfs,
    scheduler,
    message: (m) => messages.push(m),
    ...(limits ? { limits } : {}),
  });
  return { vfs, backend, scheduler, messages, view };
}

const stored = async (vfs: Vfs, path: VPath): Promise<string | null> =>
  (await vfs.stat(path)) ? str(await vfs.readFile(path)) : null;

describe('CachedSyncFiles passes the SyncFiles contract', () => {
  for (const c of SYNC_FILES_CONTRACT_CASES) {
    it(c.name, async () => {
      const { view, vfs } = await setup();
      await vfs.mkdirp('/memory/test');
      await c.run(view, '/memory/test');
      // And storage agrees with the view once it has settled.
      await view.settled();
      for (const entry of await vfs.list('/memory/test')) {
        if (entry.kind !== 'file') continue;
        const path = `/memory/test/${entry.name}`;
        const size = view.stat(path)?.size ?? -1;
        expect(str(await vfs.readFile(path))).toBe(str(view.read(path, 0, size)));
      }
    });
  }
});

describe('CachedSyncFiles: loading and names', () => {
  it('loads the prepared folder and its sub-folders; names follow the Windows rules', async () => {
    const { view } = await setup({ 'demo/Data.TXT': 'hello', 'demo/Sub/inner.bin': 'xy', 'other/far.txt': 'no' });
    await view.prepare('/memory/demo');
    const path = view.resolve('/memory/demo', 'DATA.txt');
    expect(path).toBe('/memory/demo/Data.TXT');
    expect(view.stat(path as VPath)).toEqual({ size: 5, readOnly: false });
    expect(view.resolve('/memory/demo', 'sub\\INNER.BIN')).toBe('/memory/demo/Sub/inner.bin');
    expect(str(view.read('/memory/demo/Sub/inner.bin', 0, 10))).toBe('xy');
    // Outside the prepared folder: not reachable.
    expect(view.resolve('/memory/demo', '..\\other\\far.txt')).toBeNull();
    expect(view.resolve('/memory/demo', 'C:\\x.txt')).toBeNull();
    expect(view.preparedRoots).toEqual(['/memory/demo']);
  });

  it('a name asked for again is answered from memory (a wait loop on task 70), until the names change', async () => {
    const { view, vfs } = await setup({ 'demo/roger.wav': 'RIFF' });
    await view.prepare('/memory/demo');
    const before = view.nameLookups;
    for (let i = 0; i < 1000; i++) expect(view.resolve('/memory/demo', 'ROGER.WAV')).toBe('/memory/demo/roger.wav');
    expect(view.nameLookups - before).toBe(1);
    // A name that does not exist yet keeps its spelling; once another part creates the file in
    // another spelling, the same question gets the stored one.
    expect(view.resolve('/memory/demo', 'NEW.TXT')).toBe('/memory/demo/NEW.TXT');
    await vfs.writeFile('/memory/demo/new.txt', text('n'));
    await view.whenCurrent();
    expect(view.resolve('/memory/demo', 'NEW.TXT')).toBe('/memory/demo/new.txt');
    // Removed by the program and created again in another spelling.
    expect(view.remove('/memory/demo/new.txt')).toBe(true);
    expect(view.resolve('/memory/demo', 'New.Txt')).toBe('/memory/demo/New.Txt');
    expect(view.create('/memory/demo/New.Txt')).toBe(true);
    expect(view.resolve('/memory/demo', 'NEW.TXT')).toBe('/memory/demo/New.Txt');
    // A folder that appears below: its stored spelling is used for the rest of the name.
    expect(view.resolve('/memory/demo', 'SUB\\x.txt')).toBe('/memory/demo/SUB/x.txt');
    await vfs.mkdirp('/memory/demo/sub');
    await vfs.writeFile('/memory/demo/sub/x.txt', text('x'));
    await view.whenCurrent();
    await view.revalidate();
    expect(view.resolve('/memory/demo', 'SUB\\X.TXT')).toBe('/memory/demo/sub/x.txt');
    // Outside every prepared folder until it is prepared.
    await vfs.writeFile('/memory/other/far.txt', text('f'));
    expect(view.resolve('/memory/other', 'far.txt')).toBeNull();
    await view.prepare('/memory/other');
    expect(view.resolve('/memory/other', 'FAR.TXT')).toBe('/memory/other/far.txt');
    view.dispose();
    expect(view.resolve('/memory/other', 'FAR.TXT')).toBeNull();
  });

  it('a second prepare of a covered folder reads nothing again', async () => {
    const { view, vfs } = await setup({ 'demo/a.txt': 'a' });
    await view.prepare('/memory/demo');
    const reads = vi.spyOn(vfs, 'readFile');
    await view.prepare('/memory/demo');
    expect(reads).not.toHaveBeenCalled();
  });

  it('a prepared folder above an earlier one takes it over', async () => {
    const { view } = await setup({ 'demo/sub/a.txt': 'a', 'demo/b.txt': 'b' });
    await view.prepare('/memory/demo/sub');
    await view.prepare('/memory/demo');
    expect(view.preparedRoots).toEqual(['/memory/demo']);
    expect(view.stat('/memory/demo/sub/a.txt')?.size).toBe(1);
    expect(view.stat('/memory/demo/b.txt')?.size).toBe(1);
  });

  it('a missing folder cannot be prepared', async () => {
    const { view } = await setup();
    await expect(view.prepare('/memory/nothing')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('files are created only in folders that exist', async () => {
    const { view, vfs } = await setup();
    await view.prepare('/memory/demo');
    const missing = view.resolve('/memory/demo', 'nofolder\\x.txt') as VPath;
    expect(view.create(missing)).toBe(false);
    await vfs.mkdirp('/memory/demo/nofolder'); // made by someone else: reported, read
    await view.whenCurrent();
    expect(view.create(view.resolve('/memory/demo', 'NoFolder\\x.txt') as VPath)).toBe(true);
    expect(view.stat('/memory/demo/nofolder/x.txt')).toEqual({ size: 0, readOnly: false });
    expect(view.create('/memory/demo')).toBe(false); // a folder is not a file
  });

  it('a read-only file in storage is read-only in the view', async () => {
    const { view, backend } = await setup({ 'demo/ro.txt': 'ro' });
    backend.setReadOnly('demo/ro.txt');
    await view.prepare('/memory/demo');
    expect(view.stat('/memory/demo/ro.txt')).toEqual({ size: 2, readOnly: true });
    expect(view.write('/memory/demo/ro.txt', 0, text('x'))).toBe(false);
    expect(view.create('/memory/demo/ro.txt')).toBe(false);
    expect(view.remove('/memory/demo/ro.txt')).toBe(false);
  });
});

describe('CachedSyncFiles: the limits', () => {
  const small: SnapshotLimits = { maxFiles: 2, maxFileBytes: 4, maxTotalBytes: 6, maxDepth: 1 };

  it('names every file beyond the limits once, and such a file cannot be used', async () => {
    const { view, messages, scheduler } = await setup(
      {
        'demo/a.txt': 'aaa',
        'demo/big.txt': 'bbbbbbbb',
        'demo/c.txt': 'ccc',
        'demo/d.txt': 'd',
        'demo/sub/deep/x.txt': 'x',
      },
      small,
    );
    await view.prepare('/memory/demo');
    expect(messages).toEqual([]); // from a timer: a load empties the message area first
    scheduler.runTimers();
    expect(messages).toEqual([
      unavailableMessage('/memory/demo/big.txt', 'too-large'),
      unavailableMessage('/memory/demo/d.txt', 'too-many'),
      unavailableMessage('/memory/demo/sub/deep', 'too-deep'),
    ]);
    expect(messages[0]).toBe('Not available to the program: /memory/demo/big.txt (too large)');
    const big = view.resolve('/memory/demo', 'BIG.TXT') as VPath;
    expect(view.stat(big)).toBeNull();
    expect(view.create(big)).toBe(false); // would destroy the file in storage
    expect(view.remove(big)).toBe(false);
    expect(view.create(view.resolve('/memory/demo', 'sub\\deep\\y.txt') as VPath)).toBe(false);
    // Named once, also when the folder is prepared again or revalidated.
    await view.revalidate();
    scheduler.runTimers();
    expect(messages).toHaveLength(3);
  });

  // Found by another package's verifier with a differential probe (gate I3 round 3): revalidate()
  // read every new file through reload(), which checked the byte limits only.
  it('revalidate() and the changes others report load no more files than prepare() (maxFiles)', async () => {
    const { view, vfs, backend, messages, scheduler } = await setup();
    for (let i = 0; i < 50; i++) await vfs.writeFile(`/memory/demo/prog${String(i).padStart(2, '0')}.x68`, text('p'));
    for (let i = 0; i < 3000; i++) await vfs.writeFile(`/memory/demo/other/f${String(i).padStart(4, '0')}`, text('o'));
    await view.prepare('/memory/demo');
    const loaded = () => {
      let count = 0;
      for (let i = 0; i < 50; i++) if (view.stat(`/memory/demo/prog${String(i).padStart(2, '0')}.x68`)) count++;
      for (let i = 0; i < 3000; i++) if (view.stat(`/memory/demo/other/f${String(i).padStart(4, '0')}`)) count++;
      return count;
    };
    expect(loaded()).toBe(DEFAULT_SNAPSHOT_LIMITS.maxFiles);
    scheduler.runTimers();
    const named = messages.length;
    expect(named).toBe(50 + 3000 - DEFAULT_SNAPSHOT_LIMITS.maxFiles);
    await view.revalidate();
    expect(loaded()).toBe(DEFAULT_SNAPSHOT_LIMITS.maxFiles);
    // A file added behind the Vfs's back, and one another window adds, are beyond the limit too.
    await backend.writeFile('demo/late.txt', text('l'));
    await backend.externalWrite('demo/other2.txt', text('w'));
    await view.whenCurrent();
    await view.revalidate();
    expect(view.stat('/memory/demo/late.txt')).toBeNull();
    expect(view.stat('/memory/demo/other2.txt')).toBeNull();
    scheduler.runTimers();
    expect(messages.slice(named)).toEqual([
      unavailableMessage('/memory/demo/other2.txt', 'too-many'),
      unavailableMessage('/memory/demo/late.txt', 'too-many'),
    ]);
    // Every file is named once, whatever revalidate() finds again.
    expect(new Set(messages).size).toBe(messages.length);
  }, 60_000);
});

describe('CachedSyncFiles: writing through to storage', () => {
  it('writes a change after the write-behind interval, and at once on settled()', async () => {
    const { view, vfs, scheduler } = await setup();
    await view.prepare('/memory/demo');
    const path = view.resolve('/memory/demo', 'out.txt') as VPath;
    view.create(path);
    view.write(path, 0, text('abc'));
    expect(view.unsettled).toBe(true);
    expect(scheduler.pending()).toEqual([WRITE_BEHIND_MS]);
    expect(await stored(vfs, path)).toBeNull();
    scheduler.runTimers();
    await vi.waitFor(async () => expect(await stored(vfs, path)).toBe('abc'));
    await view.settled();
    expect(view.unsettled).toBe(false);

    view.write(path, 3, text('def'));
    await view.settled(); // does not wait for the timer
    expect(await stored(vfs, path)).toBe('abcdef');
    expect(scheduler.pending()).toEqual([]);
  });

  it('one timer per file while it keeps changing', async () => {
    const { view, scheduler } = await setup();
    await view.prepare('/memory/demo');
    const path = '/memory/demo/log.txt';
    view.create(path);
    for (let i = 0; i < 100; i++) view.write(path, i, text('x'));
    expect(scheduler.pending()).toEqual([WRITE_BEHIND_MS]);
  });

  it('sends an append when only bytes at the end were added', async () => {
    const { view, vfs } = await setup({ 'demo/data.bin': 'start' });
    await view.prepare('/memory/demo');
    const appends = vi.spyOn(vfs, 'appendFile');
    const writes = vi.spyOn(vfs, 'writeFile');
    view.write('/memory/demo/data.bin', 5, text('MORE'));
    await view.settled();
    expect(appends).toHaveBeenCalledTimes(1);
    expect(str(appends.mock.calls[0]?.[1])).toBe('MORE');
    expect(writes).not.toHaveBeenCalled();
    expect(await stored(vfs, '/memory/demo/data.bin')).toBe('startMORE');
    // A change inside the file rewrites it.
    view.write('/memory/demo/data.bin', 0, text('S'));
    await view.settled();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await stored(vfs, '/memory/demo/data.bin')).toBe('StartMORE');
  });

  it('a truncated and rewritten file replaces the stored one', async () => {
    const { view, vfs } = await setup({ 'demo/t.txt': 'a long old text' });
    await view.prepare('/memory/demo');
    view.create('/memory/demo/t.txt');
    view.write('/memory/demo/t.txt', 0, text('new'));
    await view.settled();
    expect(await stored(vfs, '/memory/demo/t.txt')).toBe('new');
  });

  it('a removal reaches storage; remove then create writes the new file', async () => {
    const { view, vfs } = await setup({ 'demo/r.txt': 'old', 'demo/s.txt': 'old' });
    await view.prepare('/memory/demo');
    expect(view.remove('/memory/demo/r.txt')).toBe(true);
    await view.settled();
    expect(await vfs.stat('/memory/demo/r.txt')).toBeNull();

    view.remove('/memory/demo/s.txt');
    view.create('/memory/demo/s.txt');
    view.write('/memory/demo/s.txt', 0, text('new'));
    await view.settled();
    expect(await stored(vfs, '/memory/demo/s.txt')).toBe('new');
  });

  it('a file created and removed before it was written leaves nothing in storage', async () => {
    const { view, vfs } = await setup();
    await view.prepare('/memory/demo');
    view.create('/memory/demo/tmp.txt');
    view.remove('/memory/demo/tmp.txt');
    expect(view.unsettled).toBe(false);
    await view.settled();
    expect(await vfs.stat('/memory/demo/tmp.txt')).toBeNull();
  });

  it('its own writes are not read back', async () => {
    const { view, vfs } = await setup();
    await view.prepare('/memory/demo');
    const reads = vi.spyOn(vfs, 'readFile');
    view.create('/memory/demo/own.txt');
    view.write('/memory/demo/own.txt', 0, text('mine'));
    await view.settled();
    await view.whenCurrent();
    expect(reads).not.toHaveBeenCalled();
  });

  it('a failed write is reported once, kept, and written by the next settled()', async () => {
    const { view, vfs, messages, scheduler } = await setup();
    await view.prepare('/memory/demo');
    let fail = true;
    const real = vfs.writeFile.bind(vfs);
    vi.spyOn(vfs, 'writeFile').mockImplementation((path, data) =>
      fail ? Promise.reject(fsError('io', 'The storage is full')) : real(path, data),
    );
    view.create('/memory/demo/f.txt');
    view.write('/memory/demo/f.txt', 0, text('data'));
    await view.settled();
    await view.settled();
    scheduler.runTimers();
    expect(messages).toEqual(['A file of the program could not be saved: /memory/demo/f.txt (The storage is full)']);
    expect(view.unsettled).toBe(true);
    fail = false;
    await view.settled();
    expect(view.unsettled).toBe(false);
    expect(await stored(vfs, '/memory/demo/f.txt')).toBe('data');
  });
});

describe('CachedSyncFiles: changes made by others', () => {
  it('a save through the Vfs (the editor) replaces the cached bytes', async () => {
    const { view, vfs } = await setup({ 'demo/input.txt': 'one' });
    await view.prepare('/memory/demo');
    await vfs.writeFile('/memory/demo/input.txt', text('two!'));
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/input.txt', 0, 10))).toBe('two!');
    // A new file, also in a new sub-folder.
    await vfs.writeFile('/memory/demo/new/added.txt', text('+'));
    await view.whenCurrent();
    expect(view.resolve('/memory/demo', 'NEW\\ADDED.TXT')).toBe('/memory/demo/new/added.txt');
    expect(str(view.read('/memory/demo/new/added.txt', 0, 10))).toBe('+');
    // A removal.
    await vfs.remove('/memory/demo/input.txt');
    await view.whenCurrent();
    expect(view.stat('/memory/demo/input.txt')).toBeNull();
  });

  // Request SH6-append-change, errata SH6.md entry 13: U4's execution log beside the program.
  it('an append through the Vfs (the log) is added to the copy without reading the file', async () => {
    const { view, vfs } = await setup({ 'demo/run.log': 'line 1\n' });
    await view.prepare('/memory/demo');
    const reads = vi.spyOn(vfs, 'readFile');
    for (let i = 2; i <= 5; i++) {
      await vfs.appendFile('/memory/demo/run.log', text(`line ${i}\n`));
      await view.whenCurrent();
    }
    expect(reads).not.toHaveBeenCalled();
    expect(str(view.read('/memory/demo/run.log', 0, 1000))).toBe('line 1\nline 2\nline 3\nline 4\nline 5\n');
    expect(view.stat('/memory/demo/run.log')).toEqual({ size: 35, readOnly: false });
    // The copy is storage's: nothing is written back, and revalidate() reads nothing either.
    expect(view.unsettled).toBe(false);
    await view.revalidate();
    expect(reads).not.toHaveBeenCalled();
  });

  it('an append the copy cannot follow (missed, or the program changed the copy) reads the file', async () => {
    const { view, vfs } = await setup({ 'demo/run.log': 'abc' });
    await view.prepare('/memory/demo');
    const reads = vi.spyOn(vfs, 'readFile');
    // Two appends that land before the view looks: the second says "at 4", the copy has 3 bytes.
    const first = vfs.appendFile('/memory/demo/run.log', text('d'));
    const second = vfs.appendFile('/memory/demo/run.log', text('e'));
    await Promise.all([first, second]);
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/run.log', 0, 100))).toBe('abcde');
    expect(reads).toHaveBeenCalled();
    reads.mockClear();
    // The program changed its copy: its bytes win, as for any outside change (entry 5).
    view.write('/memory/demo/run.log', 0, text('X'));
    await vfs.appendFile('/memory/demo/run.log', text('f'));
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/run.log', 0, 100))).toBe('Xbcde');
    await view.settled();
    expect(await stored(vfs, '/memory/demo/run.log')).toBe('Xbcde');
  });

  it('a change in another window (the backend reports it) replaces the cached bytes', async () => {
    const { view, backend } = await setup({ 'demo/shared.txt': 'old' });
    await view.prepare('/memory/demo');
    await backend.externalWrite('demo/shared.txt', text('from the other window'));
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/shared.txt', 0, 100))).toBe('from the other window');
    await backend.externalRemove('demo/shared.txt');
    await view.whenCurrent();
    expect(view.stat('/memory/demo/shared.txt')).toBeNull();
  });

  it('a change by the program made while an outside change is read wins', async () => {
    const { view, vfs } = await setup({ 'demo/race.txt': 'old' });
    await view.prepare('/memory/demo');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = vfs.readFile.bind(vfs);
    vi.spyOn(vfs, 'readFile').mockImplementation(async (path) => {
      await gate;
      return real(path);
    });
    await vfs.writeFile('/memory/demo/race.txt', text('outside'));
    view.write('/memory/demo/race.txt', 0, text('PROG'));
    release();
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/race.txt', 0, 10))).toBe('PROG');
  });

  // A hypothesis of another engineer (gate I3 round 3), confirmed: changes that arrive while a
  // refresh runs were coalesced as "the last one", so an append of this window replaced another
  // window's write that was waiting, and the append alone was added to a copy that never saw that
  // write.
  it("another window's change waiting behind a running refresh is not lost to an append that follows", async () => {
    const { view, vfs, backend } = await setup({ 'demo/f.txt': 'abc' });
    await view.prepare('/memory/demo');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = vfs.readFile.bind(vfs);
    const slow = vi.spyOn(vfs, 'readFile').mockImplementationOnce(async (path) => {
      const data = await real(path); // read now, delivered late: the refresh is still running
      await gate;
      return data;
    });
    await backend.externalWrite('demo/f.txt', text('ABC')); // refresh 1 reads 'ABC' and waits
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await backend.externalWrite('demo/f.txt', text('XYZ')); // another window: waits behind refresh 1
    await vfs.appendFile('/memory/demo/f.txt', text('d')); // this window's log appends at 3
    expect(await stored(vfs, '/memory/demo/f.txt')).toBe('XYZd');
    release();
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/f.txt', 0, 100))).toBe('XYZd');
  });

  it('revalidate() finds changes no one reported (the opened folder)', async () => {
    const { view, backend } = await setup({ 'demo/a.txt': 'a', 'demo/gone.txt': 'g' });
    await view.prepare('/memory/demo');
    // Behind the Vfs's back: no change is reported.
    await backend.writeFile('demo/a.txt', text('changed'));
    await backend.writeFile('demo/new.txt', text('new'));
    await backend.remove('demo/gone.txt');
    backend.setReadOnly('demo/new.txt');
    expect(str(view.read('/memory/demo/a.txt', 0, 10))).toBe('a');
    await view.revalidate();
    expect(str(view.read('/memory/demo/a.txt', 0, 10))).toBe('changed');
    expect(view.stat('/memory/demo/new.txt')).toEqual({ size: 3, readOnly: true });
    expect(view.stat('/memory/demo/gone.txt')).toBeNull();
  });

  it('revalidate() keeps what the program changed and has not written yet', async () => {
    const { view, backend, vfs } = await setup({ 'demo/a.txt': 'a' });
    await view.prepare('/memory/demo');
    view.write('/memory/demo/a.txt', 0, text('P'));
    await backend.writeFile('demo/a.txt', text('outside'));
    await view.revalidate();
    expect(str(view.read('/memory/demo/a.txt', 0, 10))).toBe('P');
    await view.settled();
    expect(await stored(vfs, '/memory/demo/a.txt')).toBe('P');
  });

  // Gate I2, SH6's review: the append was computed from the size storage had before the other
  // window's change, so storage ended up with 'WXYZabc'.
  it("an append after another window replaced the file writes the program's version whole", async () => {
    const { view, vfs, backend } = await setup({ 'demo/f.txt': '0123456789' });
    await view.prepare('/memory/demo');
    view.write('/memory/demo/f.txt', 10, text('abc')); // not settled yet
    await backend.externalWrite('demo/f.txt', text('WXYZ'));
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/f.txt', 0, 100))).toBe('0123456789abc');
    await view.settled();
    expect(await stored(vfs, '/memory/demo/f.txt')).toBe('0123456789abc');
  });

  it('the same when revalidate() finds the outside change (the opened folder)', async () => {
    const { view, vfs, backend } = await setup({ 'demo/f.txt': '0123456789' });
    await view.prepare('/memory/demo');
    view.write('/memory/demo/f.txt', 10, text('abc'));
    await backend.writeFile('demo/f.txt', text('WXYZ')); // behind the Vfs's back
    await view.revalidate();
    await view.settled();
    expect(await stored(vfs, '/memory/demo/f.txt')).toBe('0123456789abc');
  });

  it('a file whose write failed can still be removed from storage', async () => {
    const { view, vfs } = await setup({ 'demo/f.txt': 'old' });
    await view.prepare('/memory/demo');
    vi.spyOn(vfs, 'writeFile').mockImplementationOnce(() => Promise.reject(fsError('io', 'full')));
    view.write('/memory/demo/f.txt', 0, text('N'));
    await view.settled();
    expect(view.remove('/memory/demo/f.txt')).toBe(true);
    await view.settled();
    expect(await vfs.stat('/memory/demo/f.txt')).toBeNull();
  });
});

describe('CachedSyncFiles: reading a whole file', () => {
  // The sound device reads the whole file at every try of a wait loop (SH5's note for gate I2).
  it('returns the same copy until the bytes change', async () => {
    const { view, vfs } = await setup({ 'demo/tick.wav': 'RIFF' });
    await view.prepare('/memory/demo');
    const first = view.read('/memory/demo/tick.wav', 0, 4);
    expect(view.read('/memory/demo/tick.wav', 0, 1 << 20)).toBe(first);
    expect(view.read('/memory/demo/tick.wav', 1, 3)).not.toBe(first);
    view.write('/memory/demo/tick.wav', 0, text('r'));
    const second = view.read('/memory/demo/tick.wav', 0, 4);
    expect(str(second)).toBe('rIFF');
    expect(str(first)).toBe('RIFF');
    view.create('/memory/demo/tick.wav');
    expect(view.read('/memory/demo/tick.wav', 0, 4)?.length).toBe(0);
    await view.settled(); // else the program's change would win over the outside one
    await vfs.writeFile('/memory/demo/tick.wav', text('NEW'));
    await view.whenCurrent();
    expect(str(view.read('/memory/demo/tick.wav', 0, 4))).toBe('NEW');
  });
});
