// The File System Access additions in a whole application under Node, with FS1's real file dialog
// service and the stand-ins of fake-handles.ts for the browser's pickers and handles.

import { describe, expect, it } from 'vitest';
import type { Bytes, DialogInstance, DocumentService, DocumentState, MessageBoxRequest, VPath } from '../../contracts';
import {
  FOLDER_KEY,
  LinkedBackend,
  MemoryHandleStore,
  type FsaDirectoryHandle,
  type FsaFileHandle,
} from '../../fs/fsaccess-backend';
import { MemoryBackend } from '../../fs/memory-backend';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import type { FileDialogService } from '../files/dialogs';
import { createFileDialogs, feature as filesFeature } from '../files/index';
import { FsAccess, type FsAccessEnv } from './controller';
import { FakeDisk, FakePermission } from './fake-handles';
import { feature, fsAccessAvailable } from './index';
import type { DirectoryPickerOptions, OpenFilePickerOptions } from './pickers';
import { DROPPED_FOLDER_QUESTION, FSACCESS_TEXTS, OPEN_CONTAINING_FOLDER } from './texts';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (bytes: Uint8Array | null): string | null => (bytes ? String.fromCharCode(...bytes) : null);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Answers the dialogs that appear, one after another, with the given results. */
function answer(application: TestApplication, results: unknown[]): DialogInstance[] {
  const seen: DialogInstance[] = [];
  const stop = application.ctx.store.subscribe(() => {
    for (const dialog of application.ctx.store.getState().dialogs.stack) {
      if (seen.includes(dialog)) continue;
      seen.push(dialog);
      const result = results.shift();
      queueMicrotask(() => application.dialogs.close(dialog.key, result));
      if (results.length === 0) stop();
    }
  });
  return seen;
}

/** A document service that lists the given documents and records close and open. */
function fakeDocuments(docs: Partial<DocumentState>[]) {
  const log: string[] = [];
  const list = docs.map((d, i) => ({ id: `d${i}`, name: 'x', modified: false, path: null, ...d }) as DocumentState);
  const service = {
    list: () => list,
    close: async (id: string) => {
      log.push(`close ${id}`);
      return true;
    },
    open: async (path: VPath) => {
      log.push(`open ${path}`);
      return null;
    },
  } as unknown as DocumentService;
  return { service, log };
}

interface Setup {
  application: TestApplication;
  access: FsAccess;
  disk: FakeDisk;
  handles: MemoryHandleStore;
  folderPicks: (FsaDirectoryHandle | Error)[];
  filePicks: (FsaFileHandle[] | Error)[];
  dirOptions: DirectoryPickerOptions[];
  fileOptions: OpenFilePickerOptions[];
  toasts: { text: string; action?: { label: string; run(): void } }[];
  stop: () => void;
}

function setup(options: { documents?: DocumentService; handles?: MemoryHandleStore; start?: boolean } = {}): Setup {
  const application = createTestApplication({
    features: [filesFeature],
    services: {
      createFileDialogs,
      ...(options.documents ? { createDocumentService: () => options.documents as DocumentService } : {}),
    },
  });
  const disk = new FakeDisk();
  const handles = options.handles ?? new MemoryHandleStore();
  const folderPicks: (FsaDirectoryHandle | Error)[] = [];
  const filePicks: (FsaFileHandle[] | Error)[] = [];
  const dirOptions: DirectoryPickerOptions[] = [];
  const fileOptions: OpenFilePickerOptions[] = [];
  const cancel = () => new DOMException('The user aborted a request.', 'AbortError');
  const env: FsAccessEnv = {
    async showDirectoryPicker(o) {
      dirOptions.push(o);
      const next = folderPicks.shift() ?? cancel();
      if (next instanceof Error) throw next;
      return next;
    },
    async showOpenFilePicker(o) {
      fileOptions.push(o);
      const next = filePicks.shift() ?? cancel();
      if (next instanceof Error) throw next;
      return next;
    },
    handles: async () => handles,
    createLinked: async (h) =>
      new LinkedBackend({
        copies: new MemoryBackend({ mount: 'copies', kind: 'memory', label: 'copies' }),
        handles: h,
      }),
  };
  const toasts: Setup['toasts'] = [];
  const realToast = application.ctx.dialogs.toast.bind(application.ctx.dialogs);
  application.ctx.dialogs.toast = (t, action, o) => {
    toasts.push({ text: t, ...(action ? { action } : {}) });
    realToast(t, action, o);
  };
  const access = new FsAccess(application.ctx, env);
  const stop = options.start === false ? () => {} : access.start();
  return { application, access, disk, handles, folderPicks, filePicks, dirOptions, fileOptions, toasts, stop };
}

const registry = (s: Setup) => (s.application.ctx.fileDialogs as FileDialogService).registry;

describe('feature "files-fsaccess"', { timeout: 60_000 }, () => {
  it('registers "Open folder..." and "From this computer..." and mounts /linked', async () => {
    const s = setup();
    await tick();
    const folder = registry(s).get('folder');
    const upload = registry(s).get('upload');
    expect(folder?.label).toBe('Open folder...');
    expect(typeof folder?.open).toBe('function');
    expect(typeof folder?.save).toBe('function');
    expect(typeof (folder as { openDroppedFolder?: unknown }).openDroppedFolder).toBe('function');
    expect(upload?.label).toBe('From this computer...');
    expect(typeof upload?.save).toBe('undefined');
    expect(s.application.ctx.vfs.backends().map((b) => b.mount)).toContain('linked');
    s.stop();
    expect(registry(s).get('folder')).toBeUndefined();
    s.application.dispose();
  });

  it('"Open folder..." mounts the chosen folder at /folder, remembers it, and leaves the dialog open', async () => {
    const s = setup();
    s.disk.writeExternally('home/work/prog.X68', ascii('ORG $1000'));
    s.folderPicks.push(s.disk.root('home/work'));
    const result = await registry(s).get('folder')?.open?.({ title: 'Open File', filters: [], multiple: false });
    expect(result).toBeNull();
    const { vfs } = s.application.ctx;
    expect(text(await vfs.readFile('/folder/prog.X68'))).toBe('ORG $1000');
    expect(vfs.backends().find((b) => b.mount === 'folder')?.label).toBe('Folder: work');
    expect(s.dirOptions[0]).toMatchObject({ id: 'easy68k-folder', mode: 'readwrite' });
    expect((await s.handles.get<{ name: string }>(FOLDER_KEY))?.name).toBe('work');
    // Saving through the Vfs writes the real folder.
    await vfs.writeFile('/folder/prog.L68', ascii('listing'));
    expect(text(s.disk.read('home/work/prog.L68'))).toBe('listing');
    s.application.dispose();
  });

  it('a newly mounted folder is announced as a change of /folder (the Files panel then lists it)', async () => {
    const s = setup();
    const changes: string[] = [];
    s.application.ctx.vfs.subscribe('/', (change) => changes.push(`${change.kind} ${change.path}`));
    s.folderPicks.push(s.disk.root('work'));
    expect(await s.access.openFolder()).toBe(true);
    expect(changes).toContain('write /folder');
    s.application.dispose();
  });

  it('a cancelled picker opens nothing; a failing one says why', async () => {
    const s = setup();
    expect(await s.access.openFolder()).toBe(false);
    expect(s.application.ctx.vfs.backends().some((b) => b.mount === 'folder')).toBe(false);
    s.folderPicks.push(new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError'));
    await expect(s.access.openFolder()).rejects.toThrow(/could not show its file chooser/);
    s.application.dispose();
  });

  it('a folder the browser does not allow is not mounted, and the student is told', async () => {
    const s = setup();
    const permission = new FakePermission();
    permission.state = 'prompt';
    permission.answer = 'denied';
    s.folderPicks.push(s.disk.root('home/work', permission));
    const seen = answer(s.application, ['OK']);
    expect(await s.access.openFolder()).toBe(false);
    expect((seen[0]?.props as MessageBoxRequest).text).toBe(FSACCESS_TEXTS.notAllowed('work'));
    expect(s.application.ctx.vfs.backends().some((b) => b.mount === 'folder')).toBe(false);
    s.application.dispose();
  });

  it('the folder of last time is mounted at start while the browser still grants access', async () => {
    const handles = new MemoryHandleStore();
    const disk = new FakeDisk();
    await handles.put(FOLDER_KEY, { handle: disk.root('home/work'), name: 'work' });
    const s = setup({ handles });
    await tick();
    await tick();
    expect(s.application.ctx.vfs.backends().some((b) => b.mount === 'folder')).toBe(true);
    expect(s.toasts).toEqual([]);
    s.application.dispose();
  });

  it('after a reload the browser asks again: a toast offers the folder, its button asks in the click', async () => {
    const handles = new MemoryHandleStore();
    const disk = new FakeDisk();
    disk.writeExternally('home/work/prog.X68', ascii('x'));
    const permission = new FakePermission();
    permission.state = 'prompt';
    await handles.put(FOLDER_KEY, { handle: disk.root('home/work', permission), name: 'work' });
    const s = setup({ handles });
    for (let i = 0; i < 5; i++) await tick();
    expect(s.application.ctx.vfs.backends().some((b) => b.mount === 'folder')).toBe(false);
    expect(permission.requests).toEqual([]); // nothing asked without a click
    const toast = s.toasts.find((t) => t.text === FSACCESS_TEXTS.reopen('work'));
    expect(toast?.action?.label).toBe('Open folder');
    expect(await s.access.reopenOffered()).toBe(true);
    expect(permission.requests).toEqual(['readwrite']);
    expect(text(await s.application.ctx.vfs.readFile('/folder/prog.X68'))).toBe('x');
    s.application.dispose();
  });

  it('another folder is not opened while a document or the program of the open one is in use', async () => {
    const documents = fakeDocuments([{ path: '/folder/prog.X68' }]);
    const s = setup({ documents: documents.service });
    s.folderPicks.push(s.disk.root('a'), s.disk.root('b'));
    expect(await s.access.openFolder()).toBe(true);
    const seen = answer(s.application, ['OK']);
    expect(await s.access.openFolder()).toBe(false);
    expect((seen[0]?.props as MessageBoxRequest).text).toBe(FSACCESS_TEXTS.inUse('a', '1 document'));
    expect(s.application.ctx.vfs.backends().find((b) => b.mount === 'folder')?.label).toBe('Folder: a');
    s.application.dispose();
  });

  it('another folder replaces the open one when nothing of it is in use; the same folder again changes nothing', async () => {
    const s = setup();
    const a = s.disk.root('a');
    s.folderPicks.push(a, s.disk.root('a'), s.disk.root('b'));
    expect(await s.access.openFolder()).toBe(true);
    const first = s.application.ctx.vfs.backends().find((b) => b.mount === 'folder');
    expect(await s.access.openFolder()).toBe(true);
    expect(s.application.ctx.vfs.backends().find((b) => b.mount === 'folder')).toBe(first);
    expect(await s.access.openFolder()).toBe(true);
    expect(s.application.ctx.vfs.backends().find((b) => b.mount === 'folder')?.label).toBe('Folder: b');
    expect(s.dirOptions[1]?.startIn).toBe(a); // the picker starts in the open folder
    s.application.dispose();
  });

  it('a dropped folder: "Open this folder?" - Yes mounts it, No leaves it; a file is not taken', async () => {
    const s = setup();
    const folder = registry(s).get('folder') as unknown as { openDroppedFolder(h: unknown): Promise<boolean> };
    const seen = answer(s.application, ['No']);
    expect(await folder.openDroppedFolder(s.disk.root('drop'))).toBe(true);
    expect((seen[0]?.props as MessageBoxRequest).text).toBe(DROPPED_FOLDER_QUESTION);
    expect((seen[0]?.props as MessageBoxRequest).title).toBe('drop');
    expect(s.application.ctx.vfs.backends().some((b) => b.mount === 'folder')).toBe(false);
    answer(s.application, ['Yes']);
    expect(await folder.openDroppedFolder(s.disk.root('drop'))).toBe(true);
    expect(s.application.ctx.vfs.backends().some((b) => b.mount === 'folder')).toBe(true);
    expect(await folder.openDroppedFolder(s.disk.file('x.txt'))).toBe(false);
    expect(await folder.openDroppedFolder(null)).toBe(false);
    s.application.dispose();
  });

  it('"From this computer..." links the picked files, with the banner and its button', async () => {
    const s = setup();
    s.disk.writeExternally('home/me/prog.X68', ascii('ORG $1000\r\n'));
    s.filePicks.push([s.disk.file('home/me/prog.X68')]);
    const paths = await registry(s)
      .get('upload')
      ?.open?.({
        title: 'Open File',
        filters: [{ label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] }],
        multiple: false,
      });
    expect(paths).toHaveLength(1);
    const path = (paths as VPath[])[0] as VPath;
    expect(path).toMatch(/^\/linked\/[0-9a-f]{8}\/prog\.X68$/);
    expect(s.fileOptions[0]).toEqual({
      id: 'easy68k-file',
      multiple: false,
      types: [{ description: 'EASy68K Source [.X68]', accept: { 'text/plain': ['.X68'] } }],
    });
    const { vfs } = s.application.ctx;
    expect(text(await vfs.readFile(path))).toBe('ORG $1000\r\n');
    await vfs.writeFile(path, ascii('saved\r\n'));
    expect(text(s.disk.read('home/me/prog.X68'))).toBe('saved\r\n');
    const banner = s.toasts.find((t) => t.text === FSACCESS_TEXTS.linked('prog.X68'));
    expect(banner?.action?.label).toBe(OPEN_CONTAINING_FOLDER);
    expect(await registry(s).get('upload')?.open?.({ title: 'Open File', filters: [], multiple: false })).toBeNull();
    s.application.dispose();
  });

  it('FileDialogs.linkFileHandle (the launch queue, 5.7) links a handed file through this provider, with the banner', async () => {
    const s = setup();
    await tick();
    s.disk.writeExternally('home/me/launched.X68', ascii('ORG $1000\r\n'));
    const dialogs = s.application.ctx.fileDialogs;
    const path = await dialogs.linkFileHandle?.(s.disk.file('home/me/launched.X68') as unknown as FileSystemFileHandle);
    expect(path).toMatch(/^\/linked\/[0-9a-f]{8}\/launched\.X68$/);
    const { vfs } = s.application.ctx;
    expect(text(await vfs.readFile(path as VPath))).toBe('ORG $1000\r\n');
    await vfs.writeFile(path as VPath, ascii('saved\r\n'));
    expect(text(s.disk.read('home/me/launched.X68'))).toBe('saved\r\n');
    expect(s.toasts.find((t) => t.text === FSACCESS_TEXTS.linked('launched.X68'))?.action?.label).toBe(
      OPEN_CONTAINING_FOLDER,
    );
    // What is not a file handle is declined.
    expect(await s.access.linkFileHandle(s.disk.root('home/me'))).toBeNull();
    expect(await s.access.linkFileHandle(null)).toBeNull();
    s.application.dispose();
  });

  it('several picked files are linked when the request allows several, else only the first', async () => {
    const s = setup();
    s.disk.writeExternally('h/a.X68', ascii('a'));
    s.disk.writeExternally('h/b.X68', ascii('b'));
    s.filePicks.push(
      [s.disk.file('h/a.X68'), s.disk.file('h/b.X68')],
      [s.disk.file('h/a.X68'), s.disk.file('h/b.X68')],
    );
    expect(await s.access.linkFiles({ title: 'Open', filters: [], multiple: true })).toHaveLength(2);
    expect(await s.access.linkFiles({ title: 'Open', filters: [], multiple: false })).toHaveLength(1);
    s.application.dispose();
  });

  it('"Open the containing folder..." opens the folder and reopens the unmodified document from it', async () => {
    const documents = fakeDocuments([]);
    const s = setup({ documents: documents.service });
    s.disk.writeExternally('home/course/lab1/prog.X68', ascii('x'));
    const file = s.disk.file('home/course/lab1/prog.X68');
    s.filePicks.push([file]);
    const [path] = (await s.access.linkFiles({ title: 'Open', filters: [], multiple: false })) as VPath[];
    (documents.service.list() as DocumentState[]).push(
      { id: 'd1', path: path as VPath, name: 'prog.X68', modified: false } as DocumentState,
      { id: 'd2', path: '/browser/other.X68', name: 'other.X68', modified: false } as DocumentState,
    );
    s.folderPicks.push(s.disk.root('home/course'));
    expect(await s.access.openContainingFolder(path as VPath, file)).toBe(true);
    expect(s.dirOptions[0]?.startIn).toBe(file);
    expect(documents.log).toEqual(['close d1', 'open /folder/lab1/prog.X68']);
    expect(s.toasts.at(-1)?.text).toBe(FSACCESS_TEXTS.moved('prog.X68', 'course'));
    s.application.dispose();
  });

  it('"Open the containing folder..." with a folder that does not hold the file says so', async () => {
    const s = setup();
    s.disk.writeExternally('home/me/prog.X68', ascii('x'));
    const file = s.disk.file('home/me/prog.X68');
    s.folderPicks.push(s.disk.root('elsewhere'));
    expect(await s.access.openContainingFolder('/linked/x/prog.X68', file)).toBe(true);
    expect(s.toasts.at(-1)?.text).toBe(FSACCESS_TEXTS.notContaining('prog.X68', 'elsewhere'));
    s.application.dispose();
  });
});

describe('where the feature is absent', { timeout: 60_000 }, () => {
  it('without the API (Safari, Firefox, Node) it registers nothing and mounts nothing', async () => {
    const application = createTestApplication({ features: [filesFeature, feature], services: { createFileDialogs } });
    await tick();
    const reg = (application.ctx.fileDialogs as FileDialogService).registry;
    expect(reg.get('folder')).toBeUndefined();
    expect(application.ctx.vfs.backends().map((b) => b.mount)).toEqual(['browser']);
    application.dispose();
  });

  it('fsAccessAvailable: web platform with both pickers only; never in the desktop app', () => {
    const pickers = { showDirectoryPicker: () => {}, showOpenFilePicker: () => {} };
    const web = createTestApplication();
    expect(fsAccessAvailable(web.ctx, pickers)).toBe(true);
    expect(fsAccessAvailable(web.ctx, {})).toBe(false);
    const desktop = createTestApplication({ platform: createFakePlatform({ kind: 'desktop' }) });
    expect(fsAccessAvailable(desktop.ctx, pickers)).toBe(false);
    const native = createTestApplication({
      platform: createFakePlatform({
        nativeFileDialogs: { open: async () => null, save: async () => null, chooseFolder: async () => null },
      }),
    });
    expect(fsAccessAvailable(native.ctx, pickers)).toBe(false);
    web.dispose();
    desktop.dispose();
    native.dispose();
  });
});
