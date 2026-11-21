// Unit tests of the File System Access backends under Node, on the in-memory stand-in of the API
// (features/files-fsaccess/fake-handles.ts). The same contract suite runs on real directory handles
// of Chromium in features/files-fsaccess/check-fsaccess.mjs.

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Bytes, FileSystemBackend, Platform } from '../contracts';
import { FakeDisk, FakePermission } from '../features/files-fsaccess/fake-handles';
import { BACKEND_CONTRACT_CASES } from './backend-contract';
import {
  FOLDER_KEY,
  FSACCESS_MESSAGES,
  FolderBackend,
  IndexedDbHandleStore,
  LINK_KEY_PREFIX,
  LinkedBackend,
  MemoryHandleStore,
  createStartupBackends,
  fsAccessSupported,
  hasPermission,
  storedFolder,
  type FsaFileHandle,
  type LinkRecord,
} from './fsaccess-backend';
import { MemoryBackend } from './memory-backend';
import { CachedSyncFiles } from './sync/cached';
import { createVfs, isFsError } from './vfs';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (bytes: Uint8Array | null): string | null => (bytes ? String.fromCharCode(...bytes) : null);

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error('expected a rejection');
}

function linked(disk = new FakeDisk(), handles = new MemoryHandleStore(), copies?: FileSystemBackend) {
  let n = 0;
  const backend = new LinkedBackend({
    copies: copies ?? new MemoryBackend({ mount: 'copies', kind: 'memory', label: 'copies' }),
    handles,
    newId: () => `id${++n}`,
  });
  return { backend, disk, handles };
}

describe('FolderBackend: the backend contract on a directory handle', () => {
  for (const c of BACKEND_CONTRACT_CASES) {
    it(c.name, async () => {
      await c.run(new FolderBackend(new FakeDisk().root('work')));
    });
  }
});

describe('LinkedBackend: the backend contract (outside linked files it is its copy store)', () => {
  for (const c of BACKEND_CONTRACT_CASES) {
    it(c.name, async () => {
      await c.run(linked().backend);
    });
  }
});

describe('FolderBackend', () => {
  it('is mounted at /folder, kind fsaccess, labelled with the folder name, and reports no change events', () => {
    const backend = new FolderBackend(new FakeDisk().root('home/me/coursework'));
    expect(backend.mount).toBe('folder');
    expect(backend.kind).toBe('fsaccess');
    expect(backend.label).toBe('Folder: coursework');
    expect((backend as FileSystemBackend).onExternalChange).toBeUndefined();
  });

  it('reaches nothing outside the folder', async () => {
    const disk = new FakeDisk();
    disk.writeExternally('home/secret.txt', ascii('secret'));
    const backend = new FolderBackend(disk.root('home/work'));
    for (const rel of ['..', '../secret.txt', 'a/../../secret.txt', './x', '/secret.txt', 'a\\..\\x', 'a//b', 'x/']) {
      expect((await rejection(backend.readFile(rel))).code, rel).toBe('invalid-path');
      expect((await rejection(backend.writeFile(rel, ascii('x')))).code, rel).toBe('invalid-path');
      await expect(backend.stat(rel)).rejects.toMatchObject({ code: 'invalid-path' });
    }
    expect((await rejection(backend.remove(''))).code).toBe('invalid-path');
    expect(text(disk.read('home/secret.txt'))).toBe('secret');
    // Through the Vfs, '..' stops at the mount root.
    const vfs = createVfs();
    vfs.mount(backend);
    expect(await vfs.resolve('/folder', '..\\..\\secret.txt')).toBeNull();
  });

  it('sees at once what another program changed, added and removed (nothing is cached)', async () => {
    const disk = new FakeDisk();
    const backend = new FolderBackend(disk.root('work'));
    await backend.writeFile('prog.X68', ascii('one'));
    const before = await backend.stat('prog.X68');
    disk.writeExternally('work/prog.X68', ascii('two!'));
    disk.writeExternally('work/sub/new.txt', ascii('new'));
    const after = await backend.stat('prog.X68');
    expect(after?.size).toBe(4);
    expect(after!.mtime).toBeGreaterThan(before!.mtime);
    expect(text(await backend.readFile('prog.X68'))).toBe('two!');
    expect((await backend.list('')).map((e) => `${e.name}:${e.kind}`).sort()).toEqual(['prog.X68:file', 'sub:dir']);
    expect(text(await backend.readFile('sub/new.txt'))).toBe('new');
    disk.removeExternally('work/prog.X68');
    expect(await backend.stat('prog.X68')).toBeNull();
  });

  it('a same-size change by another program changes the modification time', async () => {
    const disk = new FakeDisk();
    const backend = new FolderBackend(disk.root('work'));
    await backend.writeFile('data.txt', ascii('aaaa'));
    const before = await backend.stat('data.txt');
    disk.writeExternally('work/data.txt', ascii('bbbb'));
    const after = await backend.stat('data.txt');
    expect(after?.size).toBe(before?.size);
    expect(after?.mtime).not.toBe(before?.mtime);
  });

  it('an acknowledged write is in the file, written as a whole', async () => {
    const disk = new FakeDisk();
    const backend = new FolderBackend(disk.root('work'));
    const data = Uint8Array.from({ length: 3000 }, (_, i) => i & 0xff);
    await backend.writeFile('out/data.bin', data);
    expect(disk.read('work/out/data.bin')).toEqual(data);
    expect(disk.closes).toBe(1);
    await backend.appendFile('out/data.bin', ascii('+'));
    expect(disk.read('work/out/data.bin')?.length).toBe(3001);
  });

  it('overlapping appends and writes to one file are done one after the other, so no data is lost', async () => {
    const disk = new FakeDisk();
    const backend = new FolderBackend(disk.root('work'));
    await backend.writeFile('log.txt', ascii(''));
    // Called directly, without the Vfs (which serialises on its own). A writable stream starts from
    // a copy of the file, so without the backend's own ordering only the last append would survive.
    await Promise.all([1, 2, 3, 4, 5].map((n) => backend.appendFile('log.txt', ascii(`[${n}]`))));
    expect(text(disk.read('work/log.txt'))).toBe('[1][2][3][4][5]');
    await Promise.all([backend.writeFile('log.txt', ascii('new')), backend.appendFile('log.txt', ascii('+'))]);
    expect(text(disk.read('work/log.txt'))).toBe('new+');
    // A failed write does not stop the ones queued after it: both run and fail on their own.
    disk.removeExternally('work/log.txt');
    disk.writeExternally('work/log.txt/inner.txt', ascii('a folder now'));
    const failed = backend.appendFile('log.txt', ascii('no'));
    const next = backend.appendFile('log.txt', ascii('no'));
    expect((await rejection(failed)).code).toBe('is-directory');
    expect((await rejection(next)).code).toBe('is-directory');
    disk.removeExternally('work/log.txt');
    await backend.appendFile('log.txt', ascii('!'));
    expect(text(disk.read('work/log.txt'))).toBe('!');
  });

  it('hides Chromium swap files from listings', async () => {
    const disk = new FakeDisk();
    disk.writeExternally('work/prog.X68', ascii('x'));
    disk.writeExternally('work/prog.X68.crswap', ascii('partial'));
    const backend = new FolderBackend(disk.root('work'));
    expect((await backend.list('')).map((e) => e.name)).toEqual(['prog.X68']);
  });

  it('withdrawn permission rejects with code io and a message that says what to do', async () => {
    const permission = new FakePermission();
    const disk = new FakeDisk();
    const backend = new FolderBackend(disk.root('work', permission));
    await backend.writeFile('a.txt', ascii('a'));
    permission.state = 'prompt';
    const error = await rejection(backend.writeFile('a.txt', ascii('b')));
    expect(error.code).toBe('io');
    expect(error.message).toBe(FSACCESS_MESSAGES.notAllowed('work'));
    expect((await rejection(backend.readFile('a.txt'))).code).toBe('io');
    expect(text(disk.read('work/a.txt'))).toBe('a');
  });

  it('a name the folder cannot hold is invalid-path', async () => {
    const backend = new FolderBackend(new FakeDisk().root('work'));
    // The stand-in refuses what Chromium refuses; segments are checked before it is asked.
    expect((await rejection(backend.writeFile('a/./b', ascii('x')))).code).toBe('invalid-path');
  });

  it('revalidation by listing and comparing size and time finds a changed and an added file (3.8.4)', async () => {
    // The rule SH6's CachedSyncFiles.revalidate() follows for /folder, here as a small reference.
    const disk = new FakeDisk();
    const backend = new FolderBackend(disk.root('work'));
    await backend.writeFile('a.txt', ascii('aaaa'));
    await backend.writeFile('sub/b.txt', ascii('b'));
    const fingerprint = async () => {
      const out = new Map<string, string>();
      const walk = async (rel: string) => {
        for (const entry of await backend.list(rel)) {
          const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
          if (entry.kind === 'dir') await walk(path);
          else {
            const stat = await backend.stat(path);
            out.set(path, `${stat?.size}/${stat?.mtime}`);
          }
        }
      };
      await walk('');
      return out;
    };
    const before = await fingerprint();
    disk.writeExternally('work/a.txt', ascii('AAAA'));
    disk.writeExternally('work/sub/c.txt', ascii('c'));
    const after = await fingerprint();
    const changed = [...after]
      .filter(([path, print]) => before.has(path) && before.get(path) !== print)
      .map(([p]) => p);
    const added = [...after.keys()].filter((path) => !before.has(path));
    expect(changed).toEqual(['a.txt']);
    expect(added).toEqual(['sub/c.txt']);
  });

  it("SH6's real CachedSyncFiles on /folder: revalidate() sees changed, added and removed files", async () => {
    const disk = new FakeDisk();
    const vfs = createVfs();
    vfs.mount(new FolderBackend(disk.root('work')));
    await vfs.writeFile('/folder/a.txt', ascii('aaaa'));
    await vfs.writeFile('/folder/gone.txt', ascii('g'));
    await vfs.writeFile('/folder/sub/b.txt', ascii('b'));
    const view = new CachedSyncFiles({
      vfs,
      scheduler: { onFrame: () => () => {}, setTimer: () => () => {} },
      message: () => {},
    });
    await view.prepare('/folder');
    const read = (path: string) => {
      const stat = view.stat(path);
      return stat ? text(view.read(path, 0, stat.size)) : null;
    };
    expect(read('/folder/a.txt')).toBe('aaaa');
    // Another program changes a file (same size), adds one and removes one; the backend sends no
    // events, so the view knows only after revalidate().
    disk.writeExternally('work/a.txt', ascii('AAAA'));
    disk.writeExternally('work/sub/c.txt', ascii('c'));
    disk.removeExternally('work/gone.txt');
    expect(read('/folder/a.txt')).toBe('aaaa');
    await view.revalidate();
    expect(read('/folder/a.txt')).toBe('AAAA');
    expect(read('/folder/sub/c.txt')).toBe('c');
    expect(view.stat('/folder/gone.txt')).toBeNull();
    expect(view.resolve('/folder', 'SUB\\C.TXT')).toBe('/folder/sub/c.txt');
    view.dispose();
  });
});

describe('LinkedBackend', () => {
  async function linkedFile(content = 'ORG $1000\r\n') {
    const setup = linked();
    const permission = new FakePermission();
    setup.disk.writeExternally('home/me/prog.X68', ascii(content));
    const handle = setup.disk.file('home/me/prog.X68', permission);
    const path = await setup.backend.link(handle);
    return { ...setup, permission, handle, path, rel: path.slice('/linked/'.length) };
  }

  it('links a file into /linked/<id>/<name> with a copy beside which outputs go', async () => {
    const { backend, path, rel } = await linkedFile();
    expect(path).toBe('/linked/id1/prog.X68');
    expect(backend.mount).toBe('linked');
    expect(text(await backend.readFile(rel))).toBe('ORG $1000\r\n');
    await backend.writeFile('id1/prog.L68', ascii('listing'));
    expect((await backend.list('id1')).map((e) => e.name).sort()).toEqual(['prog.L68', 'prog.X68']);
  });

  it('linking the same file again keeps its folder', async () => {
    const { backend, disk, path } = await linkedFile();
    const again = await backend.link(disk.file('home/me/prog.X68'));
    expect(again).toBe(path);
    disk.writeExternally('home/me/other.X68', ascii('x'));
    expect(await backend.link(disk.file('home/me/other.X68'))).toBe('/linked/id2/other.X68');
  });

  it("stat reports the real file, and another program's change shows in its time", async () => {
    const { backend, disk, rel } = await linkedFile();
    const before = await backend.stat(rel);
    disk.writeExternally('home/me/prog.X68', ascii('changed elsewhere'));
    const after = await backend.stat(rel);
    expect(after?.size).toBe(17);
    expect(after!.mtime).toBeGreaterThan(before!.mtime);
    expect(text(await backend.readFile(rel))).toBe('changed elsewhere');
  });

  it('Save writes the real file and the copy; the write is in the file when it resolves', async () => {
    const { backend, disk, rel } = await linkedFile();
    await backend.stat(rel);
    await backend.writeFile(rel, ascii('MOVE.B #1,D0\r\n'));
    expect(text(disk.read('home/me/prog.X68'))).toBe('MOVE.B #1,D0\r\n');
    const copies = (backend as unknown as { copies: FileSystemBackend }).copies;
    expect(text(await copies.readFile(rel))).toBe('MOVE.B #1,D0\r\n');
    const node = disk.find('home/me/prog.X68') as { mtime: number };
    expect((await backend.stat(rel))?.mtime).toBe(node.mtime);
  });

  it('never overwrites a change it has not seen: it refuses and leaves the real file alone', async () => {
    const { backend, disk, rel } = await linkedFile();
    disk.writeExternally('home/me/prog.X68', ascii('their version'));
    const error = await rejection(backend.writeFile(rel, ascii('my version')));
    expect(error.code).toBe('io');
    expect(error.message).toBe(FSACCESS_MESSAGES.linkedChanged('prog.X68'));
    expect(text(disk.read('home/me/prog.X68'))).toBe('their version');
    // After stat has shown the change (the documents then ask "Save anyway?"), Save goes through.
    await backend.stat(rel);
    await backend.writeFile(rel, ascii('my version'));
    expect(text(disk.read('home/me/prog.X68'))).toBe('my version');
  });

  it('a real file that is gone is reported, not silently re-created', async () => {
    const { backend, disk, rel } = await linkedFile();
    disk.removeExternally('home/me/prog.X68');
    expect(await backend.stat(rel)).toBeNull();
    const error = await rejection(backend.writeFile(rel, ascii('x')));
    expect(error.message).toBe(FSACCESS_MESSAGES.linkedGone('prog.X68'));
    expect(disk.read('home/me/prog.X68')).toBeNull();
  });

  it('after a reload: the link is found again, the copy serves until access is granted, Save asks for access', async () => {
    const setup = await linkedFile('first\r\n');
    // A new page: a new backend on the same stored records; the browser asks for permission again.
    setup.permission.state = 'prompt';
    setup.permission.activation = false;
    const copies = (setup.backend as unknown as { copies: FileSystemBackend }).copies;
    const reloaded = new LinkedBackend({ copies, handles: setup.handles });
    const stat = await reloaded.stat(setup.rel);
    expect(stat?.size).toBe(7);
    expect(text(await reloaded.readFile(setup.rel))).toBe('first\r\n'); // the copy
    // Without a click the browser cannot ask: Save is refused with a message, nothing is written.
    const refused = await rejection(reloaded.writeFile(setup.rel, ascii('second\r\n')));
    expect(refused.message).toBe(FSACCESS_MESSAGES.notAllowed('prog.X68'));
    expect(text(setup.disk.read('home/me/prog.X68'))).toBe('first\r\n');
    // With a click (Save from a key press), the browser asks and the file is written.
    setup.permission.activation = true;
    await reloaded.writeFile(setup.rel, ascii('second\r\n'));
    expect(setup.permission.requests).toContain('readwrite');
    expect(text(setup.disk.read('home/me/prog.X68'))).toBe('second\r\n');
  });

  it('after a reload, a change made meanwhile by another program is not overwritten', async () => {
    const setup = await linkedFile('first\r\n');
    setup.permission.state = 'prompt';
    setup.disk.writeExternally('home/me/prog.X68', ascii('edited in another editor\r\n'));
    const copies = (setup.backend as unknown as { copies: FileSystemBackend }).copies;
    const reloaded = new LinkedBackend({ copies, handles: setup.handles });
    // stat cannot look at the real file yet, so the documents see no change ...
    const stat = await reloaded.stat(setup.rel);
    expect(stat?.size).toBe(7);
    // ... and the write, once access is granted, finds it and refuses.
    const refused = await rejection(reloaded.writeFile(setup.rel, ascii('mine\r\n')));
    expect(refused.message).toBe(FSACCESS_MESSAGES.linkedChanged('prog.X68'));
    expect(text(setup.disk.read('home/me/prog.X68'))).toBe('edited in another editor\r\n');
  });

  it('a picker grants read access only: the first Save asks for write access', async () => {
    const setup = linked();
    const permission = new FakePermission();
    permission.readOnly = true;
    setup.disk.writeExternally('home/me/prog.X68', ascii('x'));
    const path = await setup.backend.link(setup.disk.file('home/me/prog.X68', permission));
    const rel = path.slice('/linked/'.length);
    await setup.backend.writeFile(rel, ascii('y'));
    expect(permission.requests).toEqual(['readwrite']);
    expect(text(setup.disk.read('home/me/prog.X68'))).toBe('y');
  });

  it('remove takes away the copy and the link, never the real file', async () => {
    const { backend, disk, rel, handles } = await linkedFile();
    await backend.remove(rel);
    expect(await backend.stat(rel)).toBeNull();
    expect(text(disk.read('home/me/prog.X68'))).toBe('ORG $1000\r\n');
    expect(await handles.keys()).toEqual([]);
  });

  it('appendFile to the linked file itself appends to the real file', async () => {
    const { backend, disk, rel } = await linkedFile('ab');
    await backend.appendFile(rel, ascii('cd'));
    expect(text(disk.read('home/me/prog.X68'))).toBe('abcd');
  });

  it('a name in another letter case reaches the linked file', async () => {
    const { backend, disk } = await linkedFile();
    await backend.stat('id1/prog.X68');
    await backend.writeFile('id1/PROG.x68', ascii('case'));
    expect(text(disk.read('home/me/prog.X68'))).toBe('case');
  });

  it('records are kept as plain data (id, name, handle, size, mtime) under link:<id>', async () => {
    const { handles } = await linkedFile();
    const record = await handles.get<LinkRecord>(`${LINK_KEY_PREFIX}id1`);
    expect(Object.keys(record ?? {}).sort()).toEqual(['handle', 'id', 'mtime', 'name', 'size']);
  });
});

describe('permissions, support and start-up', () => {
  it('hasPermission asks only when told to, and only with a user activation', async () => {
    const permission = new FakePermission();
    const handle = new FakeDisk().root('w', permission);
    permission.state = 'prompt';
    permission.activation = false;
    expect(await hasPermission(handle, 'readwrite', false)).toBe(false);
    expect(permission.requests).toEqual([]);
    expect(await hasPermission(handle, 'readwrite', true)).toBe(false);
    permission.activation = true;
    expect(await hasPermission(handle, 'readwrite', true)).toBe(true);
    expect(await hasPermission({ kind: 'file', name: 'x' } as FsaFileHandle, 'read', false)).toBe(true);
  });

  it('fsAccessSupported needs both pickers', () => {
    expect(fsAccessSupported({})).toBe(false);
    expect(fsAccessSupported({ showDirectoryPicker: () => {} })).toBe(false);
    expect(fsAccessSupported({ showDirectoryPicker: () => {}, showOpenFilePicker: () => {} })).toBe(true);
    expect(fsAccessSupported(globalThis)).toBe(false); // Node
  });

  it('createStartupBackends gives nothing without the API or in the desktop app', async () => {
    expect(await createStartupBackends({ kind: 'web' } as Platform)).toEqual([]);
    expect(await createStartupBackends({ kind: 'desktop' } as Platform)).toEqual([]);
  });

  it('storedFolder ignores what is not a folder record', async () => {
    const handles = new MemoryHandleStore();
    expect(await storedFolder(handles)).toBeNull();
    await handles.put(FOLDER_KEY, { name: 'x' });
    expect(await storedFolder(handles)).toBeNull();
    const handle = new FakeDisk().root('work');
    await handles.put(FOLDER_KEY, { handle, name: 'work' });
    expect((await storedFolder(handles))?.name).toBe('work');
  });

  it('IndexedDbHandleStore keeps values across opens', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbHandleStore.open(factory, 'h');
    await first.put('folder', { name: 'work', size: 1 });
    await first.put('link:ab', { name: 'p.X68' });
    first.close();
    const second = await IndexedDbHandleStore.open(factory, 'h');
    expect(await second.get('folder')).toEqual({ name: 'work', size: 1 });
    expect((await second.keys()).sort()).toEqual(['folder', 'link:ab']);
    await second.delete('folder');
    expect(await second.get('folder')).toBeUndefined();
    second.close();
  });

  it('IndexedDbHandleStore.open rejects when IndexedDB refuses', async () => {
    const refusing = {
      open: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    } as unknown as globalThis.IDBFactory;
    await expect(IndexedDbHandleStore.open(refusing, 'h', 50)).rejects.toThrow(/insecure/);
    const hanging = { open: () => ({}) } as unknown as globalThis.IDBFactory;
    await expect(IndexedDbHandleStore.open(hanging, 'h', 30)).rejects.toThrow(/did not answer/);
  });

  it('errors are FsErrors', async () => {
    const backend = new FolderBackend(new FakeDisk().root('w'));
    const error = await rejection(backend.readFile('missing'));
    expect(isFsError(error, 'not-found')).toBe(true);
  });
});
