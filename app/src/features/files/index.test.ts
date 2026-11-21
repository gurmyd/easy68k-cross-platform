// The Files feature in a whole application under Node: the command, the panel, the dialogs, the
// panel's actions with their questions and messages, and a drop.

import { describe, expect, it } from 'vitest';
import type { Bytes, DialogInstance, MessageBoxRequest, OpenRequest, Platform } from '../../contracts';
import { writeZip } from '../../fs/zip';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import { deletePath, exportPath, importInto, newFolder, renamePath } from './actions';
import { handleDrop } from './drop';
import { DROPPED_FOLDER_TITLE, createFileDialogs, dropDeps, feature } from './index';
import type { FileDialogService } from './dialogs';
import { EDITOR_OPEN_FILTERS } from './filters';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
const text = (bytes: Bytes): string => String.fromCharCode(...bytes);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function app(): TestApplication {
  return createTestApplication({ features: [feature], services: { createFileDialogs } });
}

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

describe('feature "files"', { timeout: 60_000 }, () => {
  it('contributes app.files.toggle, the Files panel of Editor mode and three dialogs', () => {
    const application = app();
    expect(application.panels.find('editor', 'files')?.title).toBe('Files');
    expect([...application.dialogComponents.keys()].sort()).toEqual(['file.open', 'file.save', 'files.name']);
    // Shown by default in a browser (2.2); the toolbar button is checked while it is.
    expect(application.ctx.commands.isChecked('app.files.toggle')).toBe(true);
    void application.ctx.commands.run('app.files.toggle');
    expect(application.ctx.commands.isChecked('app.files.toggle')).toBe(false);
    expect(application.ctx.settings.get().app.layout.panels.files?.visible).toBe(false);
    void application.ctx.commands.run('app.files.toggle');
    expect(application.ctx.commands.isChecked('app.files.toggle')).toBe(true);
    application.dispose();
  });

  it('Import... unpacks a .zip into the selected folder and reports what it did', async () => {
    const application = app();
    const { ctx } = application;
    await ctx.vfs.writeFile('/browser/t/a.X68', ascii('old'));
    const zip = writeZip([
      { path: 'a.X68', data: ascii('new'), mtime: 0 },
      { path: 'inc/', mtime: 0 },
      { path: 'inc/m.X68', data: ascii('m'), mtime: 0 },
    ]);
    const toasts: string[] = [];
    application.dialogs.toasts.subscribe(() =>
      toasts.push(...application.dialogs.toasts.getState().map((t) => t.text)),
    );
    const seen = answer(application, ['No']);
    const result = await importInto(ctx, '/browser/t', [
      { rel: 'pack.zip', read: async () => zip },
      { rel: 'plain.txt', read: async () => ascii('p') },
    ]);
    expect((seen[0]?.props as MessageBoxRequest).text).toBe('"a.X68" already exists in My Programs/t. Replace it?');
    expect(result?.written).toEqual(['/browser/t/inc/m.X68', '/browser/t/plain.txt']);
    expect(text(await ctx.vfs.readFile('/browser/t/a.X68'))).toBe('old');
    expect(toasts.at(-1)).toBe('Imported 2 files into My Programs/t. 1 existing file was kept.');
    application.dispose();
  });

  it('Export... downloads a folder as a .zip', async () => {
    const application = app();
    await application.ctx.vfs.writeFile('/browser/demo/prog.X68', ascii('x'));
    const downloads: string[] = [];
    expect(
      await exportPath(application.ctx, '/browser/demo', (name, bytes) => downloads.push(`${name} ${bytes.length}`)),
    ).toBe(true);
    expect(downloads[0]).toMatch(/^demo\.zip \d+$/);
    application.dispose();
  });

  it('New Folder..., Rename... and Delete ask first and act on the store', async () => {
    const application = app();
    const { ctx } = application;
    await ctx.vfs.writeFile('/browser/demo/prog.X68', ascii('x'));

    answer(application, ['bad|name', 'OK', 'Work']);
    expect(await newFolder(ctx, '/browser')).toBe('/browser/Work');
    expect((await ctx.vfs.stat('/browser/Work'))?.kind).toBe('dir');

    answer(application, ['main.X68']);
    expect(await renamePath(ctx, '/browser/demo/prog.X68')).toBe('/browser/demo/main.X68');

    const seen = answer(application, ['No']);
    expect(await deletePath(ctx, '/browser/demo')).toBe(false);
    expect((seen[0]?.props as MessageBoxRequest).text).toBe('Delete the folder "demo" and everything in it?');
    answer(application, ['Yes']);
    expect(await deletePath(ctx, '/browser/demo')).toBe(true);
    expect(await ctx.vfs.stat('/browser/demo')).toBeNull();
    expect(await deletePath(ctx, '/browser')).toBe(false); // a store itself cannot be deleted
    application.dispose();
  });

  it('a drop in Editor mode copies the files into /browser/Imported and opens them in order', async () => {
    const application = app();
    const opened: string[] = [];
    application.ctx.documents.open = async (path) => {
      opened.push(path);
      return null;
    };
    await handleDrop(
      [
        { name: 'b.X68', isFolder: false, read: async () => ascii('b'), handle: null },
        { name: 'a.X68', isFolder: false, read: async () => ascii('a'), handle: null },
      ],
      dropDeps(application.ctx),
    );
    expect(opened).toEqual(['/browser/Imported/b.X68', '/browser/Imported/a.X68']);
    expect(text(await application.ctx.vfs.readFile('/browser/Imported/a.X68'))).toBe('a');
    await tick();
    application.dispose();
  });

  it("the desktop app: its native dialogs replace the port's, and choose folders (DV2 errata 1; H1)", async () => {
    const calls: string[] = [];
    const platform = createFakePlatform({
      kind: 'desktop',
      nativeFileDialogs: {
        open: async (request) => (calls.push(`open ${request.title}`), ['/disk/C/a.X68']),
        save: async (request) => (calls.push(`save ${request.title}`), '/disk/C/b.X68'),
        chooseFolder: async (title) => (calls.push(`folder ${title}`), '/disk/C/Examples'),
      },
    } as Partial<Platform>);
    const application = createTestApplication({ features: [feature], services: { createFileDialogs }, platform });
    const dialogs = application.ctx.fileDialogs as FileDialogService;
    expect(await dialogs.open({ title: 'Open File', filters: [], multiple: false })).toEqual(['/disk/C/a.X68']);
    expect(await dialogs.save({ title: 'Save As', filters: [], defaultExt: '.X68' })).toBe('/disk/C/b.X68');
    expect(await dialogs.chooseFolder({ title: 'Copy the Examples to' })).toBe('/disk/C/Examples');
    expect(calls).toEqual(['open Open File', 'save Save As', 'folder Copy the Examples to']);
    // No port dialog was opened, and "From this computer..." is not offered there.
    expect(application.ctx.store.getState().dialogs.stack).toEqual([]);
    expect(dialogs.registry.get('upload')).toBeUndefined();
    application.dispose();
  });

  it('the desktop app: a dropped file is opened where it is, a dropped folder starts the Open dialog (DV2 4a)', async () => {
    const requests: OpenRequest[] = [];
    const granted: unknown[] = [];
    const disk = new File(['x'], 'a.X68');
    const folder = new File([], 'work');
    const platform = createFakePlatform({
      kind: 'desktop',
      nativeFileDialogs: {
        open: async (request) => (requests.push(request), ['/disk/C/work/one.X68', '/disk/C/work/two.X68']),
        save: async () => null,
        chooseFolder: async () => null,
      },
      grantDroppedFile: async (file: File) => {
        granted.push(file);
        if (file === disk) return { path: '/disk/C/a.X68', kind: 'file' };
        if (file === folder) return { path: '/disk/C/work', kind: 'dir' };
        return null;
      },
    } as Partial<Platform>);
    const application = createTestApplication({ features: [feature], services: { createFileDialogs }, platform });
    const opened: string[] = [];
    application.ctx.documents.open = async (path) => {
      opened.push(path);
      return null;
    };
    await handleDrop(
      [
        { name: 'a.X68', isFolder: false, read: async () => ascii('x'), handle: null, file: disk },
        { name: 'work', isFolder: true, read: () => Promise.reject(new Error('folder')), handle: null, file: folder },
      ],
      dropDeps(application.ctx),
    );
    expect(granted).toEqual([disk, folder]);
    expect(opened).toEqual(['/disk/C/a.X68', '/disk/C/work/one.X68', '/disk/C/work/two.X68']);
    expect(requests).toEqual([
      { title: DROPPED_FOLDER_TITLE, filters: [...EDITOR_OPEN_FILTERS], multiple: true, startDir: '/disk/C/work' },
    ]);
    expect(await application.ctx.vfs.stat('/browser/Imported')).toBeNull(); // nothing was copied
    application.dispose();
  });

  it('in a browser, chooseFolder uses the Save dialog and creates the folder typed there', async () => {
    const application = app();
    const dialogs = application.ctx.fileDialogs as FileDialogService;
    await application.ctx.vfs.mkdirp('/browser/work');
    const seen = answer(application, ['/browser/work/Examples']);
    expect(await dialogs.chooseFolder({ title: 'Copy the Examples to', startDir: '/browser/work' })).toBe(
      '/browser/work/Examples',
    );
    expect(seen[0]?.id).toBe('file.save');
    expect((seen[0]?.props as { initialName: string }).initialName).toBe('New Folder');
    expect((await application.ctx.vfs.stat('/browser/work/Examples'))?.kind).toBe('dir');
    application.dispose();
  });
});
