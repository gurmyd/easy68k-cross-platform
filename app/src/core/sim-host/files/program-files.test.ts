// ProgramFiles over in-memory views, without the engine: the stream model of 3.8.4 call by call.
// program-files.engine.test.ts runs the same rules through real 68000 programs.

import { describe, expect, it } from 'vitest';
import {
  FileMode,
  type Bytes,
  type ControllerRequest,
  type FileSystemBackend,
  type Scheduler,
  type SyncFiles,
  type VPath,
} from '../../../contracts';
import { MemoryBackend } from '../../../fs/memory-backend';
import { CachedSyncFiles } from '../../../fs/sync/cached';
import { MemorySyncFiles } from '../../../fs/sync/memory';
import { createVfs } from '../../../fs/vfs';
import { fromBase64, parseJournal, toBase64, applyEntryBytes } from './journal';
import { ProgramFiles, STDIO_BUFFER, deviceOf, programPathOf } from './program-files';

const text = (s: string): Bytes => Uint8Array.from(s, (c) => c.charCodeAt(0));
const str = (b: Bytes | null | undefined): string | null => (b ? String.fromCharCode(...b) : null);

interface Harness {
  files: ProgramFiles;
  view: MemorySyncFiles;
  posted: ControllerRequest[];
  messages: string[];
  journal: { text: string | null };
  dialogAnswer: { value: VPath | null };
}

async function harness(initial: Record<VPath, string> = {}, reach: VPath[] = ['/memory']): Promise<Harness> {
  const view = new MemorySyncFiles({
    files: Object.fromEntries(Object.entries(initial).map(([path, content]) => [path, text(content)])),
    reach,
  });
  const posted: ControllerRequest[] = [];
  const messages: string[] = [];
  const journal = { text: null as string | null };
  const dialogAnswer = { value: null as VPath | null };
  const files = new ProgramFiles({
    viewFor: () => view,
    message: (m) => messages.push(m),
    showFileDialog: async () => dialogAnswer.value,
    post: (request) => posted.push(request),
    journal: { write: (t) => (journal.text = t), read: () => journal.text },
  });
  await files.setCurrentDir(reach[0] === '/memory' ? '/memory/demo' : (reach[0] as VPath));
  return { files, view, posted, messages, journal, dialogAnswer };
}

const name = (s: string) => text(s);

describe('ProgramFiles: names', () => {
  it('opens names in another letter case, with backslashes, "." and ".."', async () => {
    const { files } = await harness({ '/memory/demo/Data.TXT': 'abc', '/memory/demo/sub/in.bin': 'xy' });
    expect(files.fileOpen(name('data.txt'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('.\\DATA.TXT'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('SUB\\IN.BIN'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('sub/../sub\\in.bin'), FileMode.Read)).toBeGreaterThan(0);
    // Windows drops trailing periods and spaces of a name.
    expect(files.fileOpen(name('data.txt. '), FileMode.Read)).toBeGreaterThan(0);
  });

  it('refuses drive letters, characters Windows refuses, and names outside what the view reaches', async () => {
    const { files } = await harness({ '/memory/demo/a.txt': 'a' }, ['/memory/demo']);
    for (const bad of ['C:\\a.txt', 'c:a.txt', 'a?.txt', 'a*.txt', 'a|b', 'x:y', '..\\a.txt', '', '\\a.txt']) {
      expect(files.fileOpen(name(bad), FileMode.Read), bad).toBe(0);
      expect(files.fileOpen(name(bad), FileMode.Create), bad).toBe(0);
    }
  });

  it('a name that ends in a separator opens, creates, reads and removes nothing (Windows 11 and Wine: error 267)', async () => {
    const { files, view } = await harness({ '/memory/demo/data': 'd', '/memory/demo/data.txt': 'e' });
    const ENDING = [
      'data\\',
      'data/',
      'data\\\\',
      'sub\\',
      '.\\',
      'data.txt\\',
      'data.txt/',
      'NUL\\',
      'NUL/',
      'NUL\\\\',
    ];
    for (const n of [...ENDING, 'data \\', 'data.\\', 'NUL.\\', '.\\data\\', 'CON\\', 'COM1\\', 'nul.txt\\']) {
      for (const mode of [FileMode.Create, FileMode.Update, FileMode.Read])
        expect(files.fileOpen(name(n), mode), `${n} mode ${mode}`).toBe(0);
      expect(files.fileRemove(name(n)), n).toBe(false);
      expect(files.read(name(n)), n).toBeNull();
    }
    expect(view.paths().sort()).toEqual(['/memory/demo/data', '/memory/demo/data.txt']);
    // The same names without the separator are unchanged.
    expect(files.fileOpen(name('data'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('.\\data'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('data\\.'), FileMode.Read)).toBeGreaterThan(0);
    // A device path stays the device behind trailing separators (measured the same under Wine).
    for (const n of ['\\\\.\\NUL\\', '\\\\?\\NUL\\', '\\\\.\\NUL/', '\\\\.\\NUL\\\\']) {
      expect(files.fileOpen(name(n), FileMode.Create), n).toBeGreaterThan(0);
      expect(files.fileRemove(name(n)), n).toBe(false);
    }
    expect(files.fileOpen(name('\\\\.\\NUL \\'), FileMode.Create)).toBe(0);
  });

  it('read() of the same name follows the current directory and the mounts given (names are parsed once)', async () => {
    const { files } = await harness({
      '/memory/demo/a.txt': 'demo',
      '/memory/other/a.txt': 'other',
      '/memory/other/b.txt': 'b',
    });
    expect(str(files.read(name('a.txt')))).toBe('demo');
    await files.setCurrentDir('/memory/other');
    expect(str(files.read(name('a.txt')))).toBe('other');
    expect(str(files.read(name('\\memory\\demo\\a.txt')))).toBe('demo');
    files.resetToStartup();
    expect(files.read(name('a.txt'))).toBeNull();
    expect(files.read(name('\\memory\\demo\\a.txt'))).toBeNull(); // the mount is no longer given
  });

  it('without a current directory no relative name resolves', async () => {
    const { files } = await harness({ '/memory/demo/a.txt': 'a' });
    files.resetToStartup();
    expect(files.currentDir).toBeNull();
    expect(files.fileOpen(name('a.txt'), FileMode.Read)).toBe(0);
  });

  it('an absolute name is a path the port hands out: a VPath of a mount in use', async () => {
    const { files } = await harness({ '/memory/demo/a.txt': 'a', '/memory/other/b.txt': 'b' });
    expect(files.fileOpen(name('/memory/other/b.txt'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('\\memory\\other\\B.TXT'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('/browser/demo/a.txt'), FileMode.Read)).toBe(0); // a mount never used
  });

  it('in the desktop app an absolute name is a real path', async () => {
    const { files } = await harness({ '/disk/Users/me/demo/data.txt': 'd' }, ['/disk/Users/me/demo']);
    expect(files.currentDir).toBe('/disk/Users/me/demo');
    expect(programPathOf('/disk/Users/me/demo/data.txt')).toBe('/Users/me/demo/data.txt');
    expect(files.fileOpen(name('/Users/me/demo/data.txt'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('/Users/me/elsewhere/x.txt'), FileMode.Read)).toBe(0); // not granted
  });
});

describe('ProgramFiles: modes and streams', () => {
  it('Update needs a writable file, Read an existing one, Create truncates at once', async () => {
    const { files, view } = await harness({ '/memory/demo/ro.txt': 'ro', '/memory/demo/rw.txt': 'old text' });
    view.setReadOnly('/memory/demo/ro.txt');
    expect(files.fileOpen(name('ro.txt'), FileMode.Update)).toBe(0); // the engine falls back to Read: result 3
    expect(files.fileOpen(name('ro.txt'), FileMode.Read)).toBeGreaterThan(0);
    expect(files.fileOpen(name('ro.txt'), FileMode.Create)).toBe(0);
    expect(files.fileOpen(name('missing.txt'), FileMode.Update)).toBe(0);
    expect(files.fileOpen(name('missing.txt'), FileMode.Read)).toBe(0);
    expect(view.stat('/memory/demo/missing.txt')).toBeNull(); // not created
    expect(files.fileOpen(name('rw.txt'), FileMode.Create)).toBeGreaterThan(0);
    expect(view.stat('/memory/demo/rw.txt')?.size).toBe(0);
    // A stream opened for reading does not write.
    const ro = files.fileOpen(name('ro.txt'), FileMode.Read);
    expect(files.fileWrite(ro, text('x'))).toBe(-1);
  });

  it('handles are positive and never reused; each stream has its own position', async () => {
    const { files } = await harness({ '/memory/demo/a.txt': 'abcdef' });
    const one = files.fileOpen(name('a.txt'), FileMode.Read);
    const two = files.fileOpen(name('a.txt'), FileMode.Read);
    expect(one).toBe(1);
    expect(two).toBe(2);
    expect(str(files.fileRead(one, 2))).toBe('ab');
    expect(str(files.fileRead(two, 3))).toBe('abc');
    expect(str(files.fileRead(one, 2))).toBe('cd');
    expect(files.fileClose(one)).toBe(true);
    expect(files.fileClose(one)).toBe(false);
    expect(files.fileOpen(name('a.txt'), FileMode.Read)).toBe(3);
    expect(files.fileRead(one, 1)).toBeNull();
  });

  it('a read at the end gives an empty array; a seek past the end and a write leave zero bytes', async () => {
    const { files, view } = await harness({ '/memory/demo/a.bin': 'AB' });
    const h = files.fileOpen(name('a.bin'), FileMode.Update);
    expect(str(files.fileRead(h, 10))).toBe('AB');
    expect(files.fileRead(h, 10)).toEqual(new Uint8Array(0));
    expect(files.fileSeek(h, 5, 0)).toBe(5);
    expect(files.fileWrite(h, text('Z'))).toBe(1);
    expect(files.fileClose(h)).toBe(true);
    expect([...(view.get('/memory/demo/a.bin') ?? [])]).toEqual([0x41, 0x42, 0, 0, 0, 0x5a]);
    const g = files.fileOpen(name('a.bin'), FileMode.Read);
    expect(files.fileSeek(g, -1, 0)).toBe(-1);
    expect(files.fileSeek(g, 2, 2)).toBe(8);
    expect(files.fileSeek(g, -3, 1)).toBe(5);
  });
});

describe('ProgramFiles: write buffering', () => {
  it('written bytes are pending until close: another stream reads end of file', async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('out.txt'), FileMode.Create);
    expect(files.fileWrite(w, text('0123456789'))).toBe(10);
    expect(view.stat('/memory/demo/out.txt')?.size).toBe(0);
    expect(files.unsaved).toBe(true);
    const r = files.fileOpen(name('out.txt'), FileMode.Update);
    expect(files.fileRead(r, 10)).toEqual(new Uint8Array(0));
    expect(files.read(name('out.txt'))).toEqual(new Uint8Array(0)); // the sound device sees no more
    expect(files.fileClose(w)).toBe(true);
    expect(str(files.fileRead(r, 10))).toBe('0123456789');
    expect(files.unsaved).toBe(false);
  });

  // The rules measured on the original under Wine (docs/porting/errata/T3.md F2,
  // tests/conformance/windows-confirm/stdio-buffer.X68; the engine test replays the program).
  it(`byte by byte, ${STDIO_BUFFER} bytes become visible when the next byte arrives`, async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('a.bin'), FileMode.Create);
    const visible: [number, number][] = [];
    let last = -1;
    for (let written = 1; written <= 2100; written++) {
      files.fileWrite(w, text('x'));
      const size = view.stat('/memory/demo/a.bin')?.size ?? -1;
      if (size !== last) visible.push([written, size]);
      last = size;
    }
    expect(visible).toEqual([
      [1, 0],
      [513, 512],
      [1025, 1024],
      [1537, 1536],
      [2049, 2048],
    ]);
    files.fileClose(w);
    expect(view.stat('/memory/demo/a.bin')?.size).toBe(2100);
  });

  it(`a write that does not fit and is ${STDIO_BUFFER} bytes or more goes out whole, after what was buffered`, async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('b.bin'), FileMode.Create);
    files.fileWrite(w, new Uint8Array(10).fill(1));
    expect(view.stat('/memory/demo/b.bin')?.size).toBe(0);
    files.fileWrite(w, new Uint8Array(1000).fill(2));
    expect(view.stat('/memory/demo/b.bin')?.size).toBe(1010);
    const c = files.fileOpen(name('c.bin'), FileMode.Create);
    files.fileWrite(c, new Uint8Array(5000).fill(3));
    expect(view.stat('/memory/demo/c.bin')?.size).toBe(5000);
    const g = files.fileOpen(name('g.bin'), FileMode.Create);
    files.fileWrite(g, new Uint8Array(STDIO_BUFFER + 1).fill(5));
    expect(view.stat('/memory/demo/g.bin')?.size).toBe(STDIO_BUFFER + 1);
    const h = files.fileOpen(name('h.bin'), FileMode.Create);
    files.fileWrite(h, new Uint8Array(10).fill(6));
    files.fileWrite(h, new Uint8Array(STDIO_BUFFER).fill(7)); // does not fit after 10: 10 + 512 out
    expect(view.stat('/memory/demo/h.bin')?.size).toBe(10 + STDIO_BUFFER);
    expect([...(view.get('/memory/demo/b.bin') ?? [])].slice(8, 12)).toEqual([1, 1, 2, 2]);
  });

  it(`one write of exactly ${STDIO_BUFFER} bytes on a fresh stream stays in the buffer (T3's a59, measured)`, async () => {
    // tests/conformance/sim/trap15-a/a59-files-buffer-edges.X68 on the official binary: nothing is
    // visible to another stream until another byte comes, the stream seeks or it closes.
    const { files, view } = await harness();
    const d = files.fileOpen(name('d.bin'), FileMode.Create);
    files.fileWrite(d, new Uint8Array(STDIO_BUFFER).fill(4));
    expect(view.stat('/memory/demo/d.bin')?.size).toBe(0);
    files.fileWrite(d, new Uint8Array(1).fill(4));
    expect(view.stat('/memory/demo/d.bin')?.size).toBe(STDIO_BUFFER);
    const e = files.fileOpen(name('e.bin'), FileMode.Create);
    files.fileWrite(e, new Uint8Array(511).fill(1));
    files.fileWrite(e, new Uint8Array(1).fill(2));
    expect(view.stat('/memory/demo/e.bin')?.size).toBe(0);
    files.fileClose(e);
    expect(view.stat('/memory/demo/e.bin')?.size).toBe(STDIO_BUFFER);
    files.fileClose(d);
    expect(view.stat('/memory/demo/d.bin')?.size).toBe(STDIO_BUFFER + 1);
  });

  it('a small write that does not fit into the rest of the buffer pushes the buffer out first', async () => {
    // Measured on the original since gate I2 (T3's a59: 300 + 300 bytes leave 300 visible).
    const { files, view } = await harness();
    const w = files.fileOpen(name('e.bin'), FileMode.Create);
    files.fileWrite(w, new Uint8Array(300).fill(1));
    files.fileWrite(w, new Uint8Array(212).fill(2)); // exactly fills the buffer
    expect(view.stat('/memory/demo/e.bin')?.size).toBe(0);
    files.fileWrite(w, new Uint8Array(1).fill(3));
    expect(view.stat('/memory/demo/e.bin')?.size).toBe(512);
    const f = files.fileOpen(name('f.bin'), FileMode.Create);
    files.fileWrite(f, new Uint8Array(300).fill(1));
    files.fileWrite(f, new Uint8Array(300).fill(2));
    expect(view.stat('/memory/demo/f.bin')?.size).toBe(300);
    files.fileClose(f);
    expect(view.stat('/memory/demo/f.bin')?.size).toBe(600);
  });

  it('a seek and a read through the same stream commit its pending bytes', async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('s.txt'), FileMode.Create);
    files.fileWrite(w, text('hello'));
    expect(files.fileSeek(w, 0, 0)).toBe(0);
    expect(view.stat('/memory/demo/s.txt')?.size).toBe(5);
    expect(str(files.fileRead(w, 20))).toBe('hello');
    files.fileWrite(w, text('!'));
    expect(files.fileRead(w, 1)).toEqual(new Uint8Array(0)); // the read commits first
    expect(str(view.get('/memory/demo/s.txt'))).toBe('hello!');
  });

  it('a reading stream keeps the bytes it buffered; a seek or its own write forgets them', async () => {
    const { files } = await harness({ '/memory/demo/d.bin': 'a'.repeat(100) });
    const r = files.fileOpen(name('d.bin'), FileMode.Update);
    expect(str(files.fileRead(r, 10))).toBe('a'.repeat(10));
    // Another stream changes bytes 50-59 and closes.
    const other = files.fileOpen(name('d.bin'), FileMode.Update);
    files.fileSeek(other, 50, 0);
    files.fileWrite(other, text('B'.repeat(10)));
    files.fileClose(other);
    expect(str(files.fileRead(r, 50))).toBe('a'.repeat(50)); // as the original (T3 F2)
    expect(files.fileSeek(r, 50, 0)).toBe(50);
    expect(str(files.fileRead(r, 10))).toBe('B'.repeat(10));
    files.fileSeek(r, 0, 0);
    files.fileRead(r, 1);
    files.fileWrite(r, text('c')); // at offset 1; the buffer is forgotten
    files.fileSeek(r, 0, 0);
    expect(str(files.fileRead(r, 3))).toBe('aca');
  });

  it('the read buffer is refilled block by block; bytes added after its end are read', async () => {
    const { files } = await harness({ '/memory/demo/big.bin': 'x'.repeat(1300) });
    const r = files.fileOpen(name('big.bin'), FileMode.Update);
    expect(files.fileRead(r, 700)?.length).toBe(700); // filled [0, 512), then [512, 1024), which it keeps
    const w = files.fileOpen(name('big.bin'), FileMode.Update);
    files.fileSeek(w, 1000, 0);
    files.fileWrite(w, text('Y'));
    files.fileSeek(w, 1250, 0);
    files.fileWrite(w, text('Z'));
    files.fileClose(w);
    const rest = str(files.fileRead(r, 1000)) as string;
    expect(rest.length).toBe(600);
    expect(rest.indexOf('Y')).toBe(-1); // offset 1000 was in the buffer
    expect(rest.indexOf('Z')).toBe(1250 - 700); // offset 1250 was not
  });

  it('a stream nobody closes keeps its bytes and its file until exit()', async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('left.txt'), FileMode.Create);
    files.fileWrite(w, text('pending'));
    // A simulator reset: the engine forgets its slots and says nothing. A new run:
    expect(files.fileRemove(name('LEFT.TXT'))).toBe(false); // in use, as on Windows
    const again = files.fileOpen(name('left.txt'), FileMode.Read);
    expect(files.fileRead(again, 10)).toEqual(new Uint8Array(0));
    await files.exit();
    expect(str(view.get('/memory/demo/left.txt'))).toBe('pending');
    expect(files.fileRead(again, 10)).toBeNull(); // exit closed every stream
    expect(files.fileRemove(name('left.txt'))).toBe(true);
    expect(files.fileRemove(name('left.txt'))).toBe(false);
  });

  it('exit() commits the streams in the order they were opened', async () => {
    const { files, view } = await harness({ '/memory/demo/o.txt': '' });
    const first = files.fileOpen(name('o.txt'), FileMode.Update);
    const second = files.fileOpen(name('o.txt'), FileMode.Update);
    files.fileWrite(second, text('BB'));
    files.fileWrite(first, text('AAAA'));
    await files.exit();
    expect(str(view.get('/memory/demo/o.txt'))).toBe('BBAA');
  });

  it('a commit the view refuses fails the close (fclose reports the error)', async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('x.txt'), FileMode.Create);
    files.fileWrite(w, text('data'));
    view.remove('/memory/demo/x.txt'); // gone behind the program's back
    expect(files.fileClose(w)).toBe(false);
  });
});

describe('ProgramFiles: task 58', () => {
  it('OK moves the current directory and replies with the path; Cancel replies without one', async () => {
    const h = await harness({ '/memory/data/in.txt': 'x' });
    h.dialogAnswer.value = '/memory/data/in.txt';
    h.files.fileDialog(0, text('Pick'), text('*.txt|*.txt'), text(''));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.files.currentDir).toBe('/memory/data');
    expect(h.posted).toHaveLength(1);
    const reply = h.posted[0] as Extract<ControllerRequest, { kind: 'fileDialogReply' }>;
    expect(reply.accepted).toBe(true);
    expect(str(reply.path)).toBe('/memory/data/in.txt');
    expect(h.files.fileOpen(name('in.txt'), FileMode.Read)).toBeGreaterThan(0);
    expect(h.files.fileOpen(reply.path as Bytes, FileMode.Read)).toBeGreaterThan(0);

    h.dialogAnswer.value = null;
    h.files.fileDialog(1, text(''), text(''), text('x.txt'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.posted[1]).toEqual({ kind: 'fileDialogReply', accepted: false, path: null });
    expect(h.files.currentDir).toBe('/memory/data');
  });

  it('passes the program title, filter and name decoded from Windows-1252', async () => {
    const seen: unknown[] = [];
    const files = new ProgramFiles({
      viewFor: () => new MemorySyncFiles(),
      message: () => {},
      showFileDialog: async (...args) => {
        seen.push(args);
        return null;
      },
      post: () => {},
      journal: { write: () => {}, read: () => null },
    });
    files.fileDialog(1, Uint8Array.of(0x43, 0x61, 0x66, 0xe9), text('*.dat|*.dat'), text('save.dat'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([[1, 'Café', '*.dat|*.dat', 'save.dat']]);
  });
});

/* -------------------------------------------------------------------------- journal */

/** A backend whose storage stops taking writes when the page "dies": they never finish. */
function mortal(backend: MemoryBackend): FileSystemBackend & { kill(): void } {
  let dead = false;
  const hang = <T>(): Promise<T> => new Promise<T>(() => {});
  return {
    mount: backend.mount,
    kind: backend.kind,
    label: backend.label,
    stat: (rel) => backend.stat(rel),
    readFile: (rel) => backend.readFile(rel),
    writeFile: (rel, data) => (dead ? hang() : backend.writeFile(rel, data)),
    appendFile: (rel, data) => (dead ? hang() : backend.appendFile(rel, data)),
    remove: (rel) => (dead ? hang() : backend.remove(rel)),
    list: (rel) => backend.list(rel),
    mkdirp: (rel) => backend.mkdirp(rel),
    kill: () => {
      dead = true;
    },
  };
}

const idle: Scheduler = { onFrame: () => () => {}, setTimer: () => () => {} };

function cachedProgramFiles(backend: FileSystemBackend, journal: { text: string | null }) {
  const vfs = createVfs();
  vfs.mount(backend);
  const view = new CachedSyncFiles({ vfs, scheduler: idle, message: () => {} });
  const files = new ProgramFiles({
    viewFor: (): SyncFiles => view,
    message: () => {},
    showFileDialog: async () => null,
    post: () => {},
    journal: { write: (t) => (journal.text = t), read: () => journal.text },
  });
  return { vfs, view, files };
}

describe('ProgramFiles.read in a wait loop (task 70 until the player is free; gate I2)', () => {
  it('neither copies the file nor looks the name up again while nothing changes', async () => {
    const storage = new MemoryBackend();
    await storage.mkdirp('demo');
    await storage.writeFile('demo/roger.wav', new Uint8Array(11_045).fill(7));
    const { vfs, view, files } = cachedProgramFiles(storage, { text: null });
    await files.setCurrentDir('/memory/demo');
    const first = files.read(name('roger.wav'));
    const lookups = view.nameLookups;
    for (let i = 0; i < 10_000; i++) expect(files.read(name('roger.wav'))).toBe(first);
    expect(view.nameLookups).toBe(lookups);
    // A change by others is seen at the next try.
    await vfs.writeFile('/memory/demo/roger.wav', text('new'));
    await view.whenCurrent();
    expect(str(files.read(name('roger.wav')))).toBe('new');
    await vfs.remove('/memory/demo/roger.wav');
    await view.whenCurrent();
    expect(files.read(name('roger.wav'))).toBeNull();
  });
});

describe('ProgramFiles: exitNow() and recoverJournal()', () => {
  it('leaves every byte in storage after an abrupt close', async () => {
    const storage = new MemoryBackend();
    await storage.mkdirp('demo');
    await storage.writeFile('demo/keep.txt', text('0123456789'));
    await storage.writeFile('demo/gone.txt', text('remove me'));
    const journal = { text: null as string | null };
    const first = mortal(storage);
    const a = cachedProgramFiles(first, journal);
    await a.files.setCurrentDir('/memory/demo');

    // Written and settled: in storage already.
    const log = a.files.fileOpen(name('log.bin'), FileMode.Create);
    a.files.fileWrite(log, new Uint8Array(600).fill(0x41));
    await a.view.settled();
    // Then the storage stops answering, and the program goes on.
    first.kill();
    a.files.fileWrite(log, new Uint8Array(50).fill(0x42)); // pending in the stream
    const keep = a.files.fileOpen(name('keep.txt'), FileMode.Update);
    a.files.fileSeek(keep, 4, 0);
    a.files.fileWrite(keep, text('ab'));
    a.files.fileClose(keep); // committed to the view, never reaches storage
    a.files.fileRemove(name('gone.txt'));
    const fresh = a.files.fileOpen(name('new.txt'), FileMode.Create);
    a.files.fileWrite(fresh, text('brand new'));
    expect(a.files.unsaved).toBe(true);

    a.files.exitNow(); // pagehide
    expect(journal.text).not.toBeNull();
    // Nothing of it is in storage.
    expect(str(await storage.readFile('demo/keep.txt'))).toBe('0123456789');
    expect(await storage.stat('demo/new.txt')).toBeNull();

    // The next start, in a new page.
    const b = cachedProgramFiles(storage, journal);
    await b.files.recoverJournal();
    expect(journal.text).toBeNull();
    expect(str(await storage.readFile('demo/keep.txt'))).toBe('0123ab6789');
    expect(await storage.stat('demo/gone.txt')).toBeNull();
    expect(str(await storage.readFile('demo/new.txt'))).toBe('brand new');
    const logBytes = await storage.readFile('demo/log.bin');
    expect(logBytes.length).toBe(650);
    expect(logBytes.slice(0, 600).every((b) => b === 0x41)).toBe(true);
    expect(logBytes.slice(600).every((b) => b === 0x42)).toBe(true);

    // Applying it once more changes nothing.
    journal.text = null;
    await b.files.recoverJournal();
    expect(str(await storage.readFile('demo/keep.txt'))).toBe('0123ab6789');
  });

  it('a page that lives on removes its part once storage has everything', async () => {
    const storage = new MemoryBackend();
    await storage.mkdirp('demo');
    const journal = { text: null as string | null };
    const a = cachedProgramFiles(storage, journal);
    await a.files.setCurrentDir('/memory/demo');
    const h = a.files.fileOpen(name('x.txt'), FileMode.Create);
    a.files.fileWrite(h, text('abc'));
    a.files.exitNow();
    expect(parseJournal(journal.text).parts).not.toEqual({});
    await a.view.settled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(journal.text).toBeNull();
    // The stream is still open: the program goes on.
    expect(a.files.fileWrite(h, text('d'))).toBe(1);
    a.files.fileClose(h);
    await a.view.settled();
    expect(str(await storage.readFile('demo/x.txt'))).toBe('abcd');
  });

  it("two windows' parts are kept apart; a broken journal is ignored", async () => {
    const storage = new MemoryBackend();
    await storage.mkdirp('demo');
    const journal = {
      text: '{"v":1,"parts":{"other":{"time":1,"entries":[{"path":"/memory/demo/o.txt","size":2,"at":0,"data":"T0s="}]}}}',
    };
    const a = cachedProgramFiles(storage, journal);
    await a.files.recoverJournal();
    expect(str(await storage.readFile('demo/o.txt'))).toBe('OK');
    journal.text = 'not json';
    await a.files.recoverJournal();
    expect(journal.text).toBe('not json'); // nothing to apply, nothing written
  });

  it('the journal helpers', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'hello world']) expect(str(fromBase64(toBase64(text(s))))).toBe(s);
    expect(toBase64(text('OK'))).toBe('T0s=');
    expect(str(applyEntryBytes(text('0123456789'), { size: 6, at: 2, data: toBase64(text('xy')) }))).toBe('01xy45');
    expect([...applyEntryBytes(null, { size: 4, at: 3, data: toBase64(text('z')) })]).toEqual([0, 0, 0, 0x7a]);
  });
});

// Windows device names (errata SH6.md entry 14), as Windows 11 10.0.26300 reads them: measured with
// GetFullPathNameW, RtlIsDosDeviceName_U and CreateFileA (build/SH6-devices/devnames.ps1 of that
// round), and the official SIM68K.exe for NUL (trap15-a/a58, a61).
describe('ProgramFiles: Windows devices', () => {
  const NUL_NAMES = ['NUL', 'nul', 'nUl', 'NUL ', 'NUL.', 'NUL..', 'NUL:', 'NUL :', 'NUL::', 'NUL. .'];
  const NUL_PATHS = ['.\\NUL', './nul', '..\\NUL', 'sub\\NUL', 'sub/..\\NUL', '\\NUL', '/NUL', 'C:\\NUL', 'C:NUL'];
  const NUL_DEVICE_PATHS = ['\\\\.\\NUL', '\\\\?\\nul'];
  const OTHERS = ['CON', 'con', 'CON:', 'con ', 'PRN', 'prn.', 'AUX', 'aux ', 'COM1', 'com9', 'COM1 .', 'LPT1', 'lpt9'];
  const OTHERS_HIGH = ['COM\u00b9', 'LPT\u00b2', 'COM\u00b3', 'CONIN$', 'CONOUT$'];
  const ORDINARY = ['NUL.txt', 'nul.dat.x', 'NUL .txt', 'NULL', 'NUL1', ' NUL', 'NUL\\.', 'NUL:x', 'con.txt', '.\\CON'];
  const ORDINARY_TOO = ['sub\\COM1', 'COM1.txt', 'LPT1.log', 'COM0', 'LPT0', 'COM10', 'CLOCK$', 'aux.c', '\\CON'];

  it('deviceOf follows what Windows 11 measured', () => {
    for (const n of [...NUL_NAMES, ...NUL_PATHS, ...NUL_DEVICE_PATHS]) expect(deviceOf(n), n).toBe('nul');
    for (const n of [...OTHERS, ...OTHERS_HIGH]) expect(deviceOf(n), n).toBe('other');
    for (const n of [...ORDINARY, ...ORDINARY_TOO]) expect(deviceOf(n), n).toBeNull();
    // A folder part that cannot exist: the open fails as for any bad name.
    expect(deviceOf('a<b\\NUL')).toBeNull();
  });

  it('NUL opens in every mode, swallows writes, reads at end of file, seeks, closes; nothing is created', async () => {
    const { files, view } = await harness({ '/memory/demo/a.txt': 'a' });
    for (const n of [...NUL_NAMES, ...NUL_PATHS, ...NUL_DEVICE_PATHS]) {
      for (const mode of [FileMode.Create, FileMode.Update, FileMode.Read]) {
        const handle = files.fileOpen(name(n), mode);
        expect(handle, `${n} mode ${mode}`).toBeGreaterThan(0);
        expect(files.fileWrite(handle, text('abc')), n).toBe(mode === FileMode.Read ? -1 : 3);
        expect(files.fileSeek(handle, 0, 0)).toBe(0);
        expect(files.fileRead(handle, 3)).toEqual(new Uint8Array(0));
        expect(files.fileSeek(handle, 5, 0)).toBe(5);
        expect(files.fileRead(handle, 3)).toEqual(new Uint8Array(0));
        expect(files.fileSeek(handle, -1, 0)).toBe(-1);
        expect(files.fileClose(handle)).toBe(true);
        expect(files.fileClose(handle)).toBe(false);
      }
      expect(files.fileRemove(name(n)), n).toBe(false);
      expect(files.read(name(n)), n).toBeNull();
    }
    expect(files.unsaved).toBe(false);
    expect(view.paths()).toEqual(['/memory/demo/a.txt']);
  });

  it('handles of NUL come from the same counter and are never reused', async () => {
    const { files } = await harness({ '/memory/demo/a.txt': 'a' });
    const a = files.fileOpen(name('a.txt'), FileMode.Read);
    const n = files.fileOpen(name('NUL'), FileMode.Update);
    const b = files.fileOpen(name('a.txt'), FileMode.Read);
    expect([a, n, b]).toEqual([a, a + 1, a + 2]);
    expect(files.fileClose(n)).toBe(true);
    expect(files.fileOpen(name('nul'), FileMode.Create)).toBe(a + 3);
    expect(str(files.fileRead(b, 5))).toBe('a'); // the real stream is untouched
  });

  it('a file named NUL that exists (a Mac disk) is not reached: the program gets the device', async () => {
    const { files, view } = await harness({ '/disk/Users/me/demo/NUL': 'kept', '/disk/Users/me/demo/sub/nul': 'too' }, [
      '/disk/Users/me/demo',
    ]);
    for (const n of ['NUL', 'nul.', 'sub\\NUL', '/Users/me/demo/NUL']) {
      const handle = files.fileOpen(name(n), FileMode.Create);
      expect(handle, n).toBeGreaterThan(0);
      expect(files.fileRead(handle, 10)).toEqual(new Uint8Array(0));
      expect(files.fileWrite(handle, text('gone'))).toBe(4);
      expect(files.fileClose(handle)).toBe(true);
      expect(files.fileRemove(name(n))).toBe(false);
    }
    await files.exit();
    expect(str(view.get('/disk/Users/me/demo/NUL'))).toBe('kept');
    expect(str(view.get('/disk/Users/me/demo/sub/nul'))).toBe('too');
  });

  it('the other devices do not open (a PC without that port), and no file of their name is made or removed', async () => {
    const { files, view } = await harness({ '/memory/demo/CON': 'old file', '/memory/demo/sub/x': 'x' });
    for (const n of [...OTHERS, ...OTHERS_HIGH]) {
      for (const mode of [FileMode.Create, FileMode.Update, FileMode.Read])
        expect(files.fileOpen(name(n), mode), n).toBe(0);
      expect(files.fileRemove(name(n)), n).toBe(false);
      expect(files.read(name(n)), n).toBeNull();
    }
    expect(view.paths().sort()).toEqual(['/memory/demo/CON', '/memory/demo/sub/x']);
    // Names Windows 11 reads as ordinary files stay ordinary files.
    for (const n of ['NUL.txt', 'con.txt', 'COM1.txt', 'sub\\COM1', 'COM0']) {
      const handle = files.fileOpen(name(n), FileMode.Create);
      expect(handle, n).toBeGreaterThan(0);
      expect(files.fileClose(handle)).toBe(true);
      expect(files.fileRemove(name(n)), n).toBe(true);
    }
  });

  it('the browser store gets nothing either (a cached view over the Vfs)', async () => {
    const storage = new MemoryBackend();
    await storage.mkdirp('demo');
    await storage.writeFile('demo/a.txt', text('a'));
    const { vfs, view, files } = cachedProgramFiles(storage, { text: null });
    await files.setCurrentDir('/memory/demo');
    const handle = files.fileOpen(name('NUL'), FileMode.Create);
    expect(files.fileWrite(handle, text('abc'))).toBe(3);
    expect(files.fileClose(handle)).toBe(true);
    expect(files.fileOpen(name('CON'), FileMode.Create)).toBe(0);
    await files.exit();
    await view.settled();
    expect((await vfs.list('/memory/demo')).map((entry) => entry.name)).toEqual(['a.txt']);
  });
});
