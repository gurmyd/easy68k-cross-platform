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
import { ProgramFiles, STDIO_BUFFER, programPathOf } from './program-files';

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

  it(`after ${STDIO_BUFFER} bytes the whole buffers are committed, the rest stays pending`, async () => {
    const { files, view } = await harness();
    const w = files.fileOpen(name('big.bin'), FileMode.Create);
    files.fileWrite(w, new Uint8Array(300).fill(1));
    expect(view.stat('/memory/demo/big.bin')?.size).toBe(0);
    files.fileWrite(w, new Uint8Array(300).fill(2));
    expect(view.stat('/memory/demo/big.bin')?.size).toBe(512);
    files.fileWrite(w, new Uint8Array(1100).fill(3));
    expect(view.stat('/memory/demo/big.bin')?.size).toBe(1536);
    files.fileClose(w);
    expect(view.stat('/memory/demo/big.bin')?.size).toBe(1700);
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
