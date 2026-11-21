// Files dropped on the window (3.8.5; editor-ui §1.4; sim-ui §8.4).

import { describe, expect, it } from 'vitest';
import type { Bytes, MessageBoxRequest, VPath } from '../../contracts';
import { DROP_CAUTION_TEXT, DROP_FOLDER_TOAST, handleDrop, type DropDeps, type DroppedItem } from './drop';
import type { DroppedFolderProvider } from './providers';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));

function file(name: string, content = name): DroppedItem {
  return { name, isFolder: false, read: async () => ascii(content), handle: null };
}
function unreadable(name: string): DroppedItem {
  return { name, isFolder: false, read: () => Promise.reject(new Error('gone')), handle: null };
}
function folder(name: string, handle: unknown = null): DroppedItem {
  return {
    name,
    isFolder: true,
    read: () => Promise.reject(new Error('folder')),
    handle: handle ? Promise.resolve(handle) : null,
  };
}

function deps(overrides: Partial<DropDeps> = {}) {
  const log: string[] = [];
  const boxes: MessageBoxRequest[] = [];
  const d: DropDeps = {
    mode: 'editor',
    programLoaded: false,
    messageBox: async (request) => {
      boxes.push(request);
      return 'OK';
    },
    toast: (text) => log.push(`toast ${text}`),
    importFile: async (name, data) => {
      log.push(`import ${name} ${data.length}`);
      return `/browser/Imported/${name}` as VPath;
    },
    openDocument: async (path) => {
      log.push(`open ${path}`);
      return null;
    },
    openProgram: async (path) => {
      log.push(`load ${path}`);
    },
    folderProviders: () => [],
    ...overrides,
  };
  return { d, log, boxes };
}

describe('Editor mode', () => {
  it('opens every dropped file in the order of the drop; unreadable ones are skipped silently', async () => {
    const { d, log, boxes } = deps();
    const outcome = await handleDrop([file('b.X68'), unreadable('gone.X68'), file('a.L68'), file('c.txt')], d);
    expect(log).toEqual([
      'import b.X68 5',
      'open /browser/Imported/b.X68',
      'import a.L68 5',
      'open /browser/Imported/a.L68',
      'import c.txt 5',
      'open /browser/Imported/c.txt',
    ]);
    expect(outcome.skipped).toEqual(['gone.X68']);
    expect(boxes).toEqual([]);
  });

  it('a dropped folder is never opened: without a folder provider a toast says what to do, once', async () => {
    const { d, log } = deps();
    const outcome = await handleDrop([folder('demo'), file('a.X68'), folder('other')], d);
    expect(log).toEqual([`toast ${DROP_FOLDER_TOAST}`, 'import a.X68 5', 'open /browser/Imported/a.X68']);
    expect(DROP_FOLDER_TOAST).toBe('Drop files, not folders. Use Import... for a folder.');
    expect(outcome.folders).toBe('refused');
  });

  it('a provider that takes dropped folders (File System Access) is offered the folder', async () => {
    const offered: unknown[] = [];
    const provider: DroppedFolderProvider = {
      id: 'folder',
      label: 'Open folder...',
      available: () => true,
      openDroppedFolder: async (handle) => {
        offered.push(handle);
        return true;
      },
    };
    const { d, log } = deps({ folderProviders: () => [provider] });
    const outcome = await handleDrop([folder('demo', { kind: 'directory', name: 'demo' })], d);
    expect(offered).toEqual([{ kind: 'directory', name: 'demo' }]);
    expect(log).toEqual([]);
    expect(outcome.folders).toBe('taken');
  });

  it('a folder the provider declines (or without a handle) gets the toast', async () => {
    const provider: DroppedFolderProvider = {
      id: 'folder',
      label: 'Open folder...',
      available: () => true,
      openDroppedFolder: async () => false,
    };
    const { d, log } = deps({ folderProviders: () => [provider] });
    await handleDrop([folder('demo', { kind: 'directory' }), folder('nohandle')], d);
    expect(log).toEqual([`toast ${DROP_FOLDER_TOAST}`]);
  });
});

describe('Simulator mode', () => {
  it('loads only the first file, and only an .S68 (any case)', async () => {
    const { d, log } = deps({ mode: 'simulator' });
    await handleDrop([file('prog.s68'), file('other.S68')], d);
    expect(log).toEqual(['import prog.s68 8', 'load /browser/Imported/prog.s68']);

    const second = deps({ mode: 'simulator' });
    const outcome = await handleDrop([file('prog.X68'), file('prog.S68')], second.d);
    expect(second.log).toEqual([]);
    expect(outcome.skipped).toEqual(['prog.X68']);
  });

  it('asks "The current debug environment will be lost" when a program is loaded; Cancel stops', async () => {
    const { d, log, boxes } = deps({
      mode: 'simulator',
      programLoaded: true,
      messageBox: async (request) => {
        boxes.push(request);
        return 'Cancel';
      },
    });
    await handleDrop([file('prog.S68')], d);
    expect(boxes).toEqual([{ title: 'Caution', text: DROP_CAUTION_TEXT, icon: 'none', buttons: ['OK', 'Cancel'] }]);
    expect(DROP_CAUTION_TEXT).toBe('The current debug environment will be lost, click OK to continue.');
    expect(log).toEqual([]);
  });

  it('the question comes whatever was dropped, as in the original; OK loads', async () => {
    const { d, log, boxes } = deps({ mode: 'simulator', programLoaded: true });
    await handleDrop([file('notes.txt')], d);
    expect(boxes.length).toBe(1);
    expect(log).toEqual([]);
    await handleDrop([file('prog.S68')], d);
    expect(log).toEqual(['import prog.S68 8', 'load /browser/Imported/prog.S68']);
  });

  it('copies a dropped listing with the same base name along; ignores a folder and an unreadable file', async () => {
    const { d, log } = deps({ mode: 'simulator' });
    await handleDrop([file('Prog.S68'), file('x.txt'), file('PROG.l68')], d);
    expect(log).toEqual(['import Prog.S68 8', 'import PROG.l68 8', 'load /browser/Imported/Prog.S68']);
    const other = deps({ mode: 'simulator' });
    await handleDrop([folder('demo.S68')], other.d);
    await handleDrop([unreadable('prog.S68')], other.d);
    expect(other.log).toEqual([]);
  });
});

describe('EASyBIN mode', () => {
  it('does nothing with a drop', async () => {
    const { d, log } = deps({ mode: 'easybin' });
    await handleDrop([file('a.S68')], d);
    expect(log).toEqual([]);
  });
});
