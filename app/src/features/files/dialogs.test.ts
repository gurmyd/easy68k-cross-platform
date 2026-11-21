// The file dialog service and the decisions of its buttons (3.8.5; editor-ui §6.2, §6.4).

import { describe, expect, it } from 'vitest';
import type { Bytes, MessageBoxRequest, OpenRequest, SaveRequest, VPath } from '../../contracts';
import { createVfs } from '../../fs/vfs';
import { MemoryBackend } from '../../fs/memory-backend';
import { createTestApplication } from '../../state/testing';
import { decideOpen, decideSave, visibleEntries, type OpenDialogProps, type SaveDialogProps } from './dialogs';
import { EDITOR_DEFAULT_EXT, EDITOR_OPEN_FILTERS, EDITOR_SAVE_FILTERS } from './filters';
import { createFileDialogs, feature } from './index';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));

async function storeWith(files: Record<string, string>) {
  const vfs = createVfs();
  const backend = new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' });
  vfs.mount(backend);
  for (const [path, content] of Object.entries(files)) await vfs.writeFile(path, ascii(content));
  return vfs;
}

function boxes(answer: string) {
  const asked: MessageBoxRequest[] = [];
  return {
    asked,
    messageBox: async (request: MessageBoxRequest) => {
      asked.push(request);
      return answer;
    },
  };
}

const saveRequest: SaveRequest = {
  title: 'Save As',
  filters: [...EDITOR_SAVE_FILTERS],
  defaultExt: EDITOR_DEFAULT_EXT,
};

describe('decideSave', () => {
  it('appends .X68 with the first filter and saves a new file without a question', async () => {
    const vfs = await storeWith({ '/browser/demo/other.X68': 'x' });
    const dialogs = boxes('Yes');
    const step = await decideSave(vfs, dialogs, '/browser/demo', 'prog', 0, saveRequest);
    expect(step).toEqual({ kind: 'done', paths: ['/browser/demo/prog.X68'] });
    expect(dialogs.asked).toEqual([]);
  });

  it('takes the name as typed with "Any File"', async () => {
    const vfs = await storeWith({ '/browser/demo/a.txt': '' });
    expect(await decideSave(vfs, boxes('Yes'), '/browser/demo', 'prog', 1, saveRequest)).toEqual({
      kind: 'done',
      paths: ['/browser/demo/prog'],
    });
  });

  it('asks "File exists! OK to overwrite?" (Caution!, Yes / No) for an existing file; Yes saves', async () => {
    const vfs = await storeWith({ '/browser/demo/PROG.X68': 'old' });
    const dialogs = boxes('Yes');
    const step = await decideSave(vfs, dialogs, '/browser/demo', 'prog', 0, saveRequest);
    expect(dialogs.asked).toEqual([
      { title: 'Caution!', text: 'File exists! OK to overwrite?', icon: 'none', buttons: ['Yes', 'No'] },
    ]);
    // The stored spelling of the existing file is kept.
    expect(step).toEqual({ kind: 'done', paths: ['/browser/demo/PROG.X68'] });
  });

  it('No abandons the save; the dialog is not shown again', async () => {
    const vfs = await storeWith({ '/browser/demo/prog.X68': 'old' });
    expect(await decideSave(vfs, boxes('No'), '/browser/demo', 'prog.X68', 0, saveRequest)).toEqual({
      kind: 'abandon',
    });
  });

  it('uses the overwrite question a request brings, or none', async () => {
    const vfs = await storeWith({ '/browser/m.bin': 'x' });
    const dialogs = boxes('Yes');
    const request = {
      ...saveRequest,
      defaultExt: 'bin',
      overwritePrompt: { title: 'Alert', text: 'File exists! OK to replace?' },
    };
    await decideSave(vfs, dialogs, '/browser', 'm', 0, request);
    expect(dialogs.asked[0]).toMatchObject({ title: 'Alert', text: 'File exists! OK to replace?' });
    const silent = boxes('No');
    expect(await decideSave(vfs, silent, '/browser', 'm', 0, { ...request, overwritePrompt: null })).toEqual({
      kind: 'done',
      paths: ['/browser/m.bin'],
    });
    expect(silent.asked).toEqual([]);
  });

  it('enters a typed folder, accepts a path into a sub-folder, refuses bad names', async () => {
    const vfs = await storeWith({ '/browser/demo/sub/x.txt': '' });
    expect(await decideSave(vfs, boxes('Yes'), '/browser/demo', 'SUB', 0, saveRequest)).toEqual({
      kind: 'navigate',
      dir: '/browser/demo/sub',
    });
    expect(await decideSave(vfs, boxes('Yes'), '/browser/demo', 'sub\\new', 0, saveRequest)).toEqual({
      kind: 'done',
      paths: ['/browser/demo/sub/new.X68'],
    });
    expect((await decideSave(vfs, boxes('Yes'), '/browser/demo', 'a|b', 0, saveRequest)).kind).toBe('error');
    expect((await decideSave(vfs, boxes('Yes'), '/browser/demo', 'nowhere\\x', 0, saveRequest)).kind).toBe('error');
    expect((await decideSave(vfs, boxes('Yes'), '/browser/demo', 'C:\\x', 0, saveRequest)).kind).toBe('error');
    expect(await decideSave(vfs, boxes('Yes'), '/browser/demo', '*.ASM', 0, saveRequest)).toEqual({
      kind: 'filter',
      filter: { label: '*.ASM', patterns: ['*.ASM'] },
    });
    expect(await decideSave(vfs, boxes('Yes'), '/browser/demo', '   ', 0, saveRequest)).toEqual({ kind: 'nothing' });
  });
});

describe('decideOpen', () => {
  it('opens the selected file, enters the selected folder', async () => {
    const vfs = await storeWith({ '/browser/demo/prog.X68': 'x' });
    expect(await decideOpen(vfs, '/browser', '', { path: '/browser/demo', kind: 'dir' }, 'Open File')).toEqual({
      kind: 'navigate',
      dir: '/browser/demo',
    });
    expect(
      await decideOpen(vfs, '/browser/demo', '', { path: '/browser/demo/prog.X68', kind: 'file' }, 'Open File'),
    ).toEqual({
      kind: 'done',
      paths: ['/browser/demo/prog.X68'],
    });
    expect(await decideOpen(vfs, '/browser/demo', '', null, 'Open File')).toEqual({ kind: 'nothing' });
  });

  it('a typed name is found without regard to case; a missing one is reported', async () => {
    const vfs = await storeWith({ '/browser/demo/prog.X68': 'x' });
    expect(await decideOpen(vfs, '/browser', 'DEMO\\PROG.x68', null, 'Open File')).toEqual({
      kind: 'done',
      paths: ['/browser/demo/prog.X68'],
    });
    expect(await decideOpen(vfs, '/browser', 'missing.X68', null, 'Open File')).toEqual({
      kind: 'error',
      title: 'Open File',
      text: 'missing.X68\nFile not found.\nCheck the file name and try again.',
    });
  });

  it('a list shows every folder and the files of the filter', () => {
    const entries = [
      { name: 'demo', kind: 'dir' as const },
      { name: 'a.X68', kind: 'file' as const },
      { name: 'b.asm', kind: 'file' as const },
      { name: 'c.L68', kind: 'file' as const },
    ];
    expect(visibleEntries(entries, EDITOR_OPEN_FILTERS[0]).map((e) => e.name)).toEqual(['demo', 'a.X68']);
    expect(visibleEntries(entries, EDITOR_OPEN_FILTERS[1]).map((e) => e.name)).toEqual(['demo', 'b.asm']);
    expect(visibleEntries(entries, EDITOR_OPEN_FILTERS[4]).length).toBe(4);
  });
});

describe('the FileDialogs service', { timeout: 60_000 }, () => {
  const openRequest: OpenRequest = { title: 'Open File', filters: [...EDITOR_OPEN_FILTERS], multiple: false };

  it('opens file.open with the request, starts in the browser store, remembers the folder', async () => {
    const app = createTestApplication({ features: [feature], services: { createFileDialogs } });
    await app.ctx.vfs.writeFile('/browser/demo/prog.X68', ascii('x'));
    const pending = app.ctx.fileDialogs.open(openRequest);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [dialog] = app.ctx.store.getState().dialogs.stack;
    expect(dialog?.id).toBe('file.open');
    expect(dialog?.modal).toBe(true);
    const props = dialog?.props as OpenDialogProps;
    expect(props.request).toBe(openRequest);
    expect(props.startDir).toBe('/browser');
    app.dialogs.close(dialog?.key as number, ['/browser/demo/prog.X68']);
    expect(await pending).toEqual(['/browser/demo/prog.X68']);

    // The next dialog starts where the last one ended.
    const second = app.ctx.fileDialogs.save({
      title: 'Save As',
      filters: [...EDITOR_SAVE_FILTERS],
      defaultExt: '*.X68',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [saveDialog] = app.ctx.store.getState().dialogs.stack;
    expect(saveDialog?.id).toBe('file.save');
    expect((saveDialog?.props as SaveDialogProps).startDir).toBe('/browser/demo');
    app.dialogs.close(saveDialog?.key as number, null);
    expect(await second).toBeNull();
    app.dispose();
  });

  it('a save starts in the folder of the suggested path, with its name', async () => {
    const app = createTestApplication({ features: [feature], services: { createFileDialogs } });
    await app.ctx.vfs.writeFile('/browser/work/prog.X68', ascii('x'));
    const pending = app.ctx.fileDialogs.save({ ...saveRequest, suggested: '/browser/work/prog.X68' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [dialog] = app.ctx.store.getState().dialogs.stack;
    const props = dialog?.props as SaveDialogProps;
    expect([props.startDir, props.initialName]).toEqual(['/browser/work', 'prog.X68']);
    app.dialogs.close(dialog?.key as number, '/browser/work/prog.X68');
    expect(await pending).toBe('/browser/work/prog.X68');
    app.dispose();
  });

  it('an empty result counts as Cancel', async () => {
    const app = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const pending = app.ctx.fileDialogs.open(openRequest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [dialog] = app.ctx.store.getState().dialogs.stack;
    app.dialogs.close(dialog?.key as number, []);
    expect(await pending).toBeNull();
    app.dispose();
  });

  it('a native provider (desktop app) replaces the port dialogs', async () => {
    const app = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const calls: string[] = [];
    const remove = app.ctx.fileDialogs.registerProvider({
      id: 'native',
      label: 'Native',
      available: () => true,
      open: async (request) => {
        calls.push(`open ${request.title}`);
        return ['/disk/Users/me/a.X68' as VPath];
      },
      save: async (request) => {
        calls.push(`save ${request.title}`);
        return '/disk/Users/me/b.X68';
      },
    });
    expect(await app.ctx.fileDialogs.open(openRequest)).toEqual(['/disk/Users/me/a.X68']);
    expect(await app.ctx.fileDialogs.save(saveRequest)).toBe('/disk/Users/me/b.X68');
    expect(calls).toEqual(['open Open File', 'save Save As']);
    expect(app.ctx.store.getState().dialogs.stack).toEqual([]);
    remove();
    void app.ctx.fileDialogs.open(openRequest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.ctx.store.getState().dialogs.stack[0]?.id).toBe('file.open');
    app.dispose();
  });
});
