// No command of the Files panel makes a folder named .git or writes below one (ARCHITECTURE-PLUS
// P1.1 rule 2; verify round 2 of N5; errata N5 entry 15): every way a name can become .git, in any
// letter case: Rename, New Folder, Move, Copy, Import, a dropped folder, and Undo of each that has
// one; and an opened folder that is itself a repository's .git folder. Each case reads the write log
// of the Vfs (every writeFile, mkdirp and remove) and finds nothing below .git.

import { describe, expect, it } from 'vitest';
import type { DialogInstance, MessageBoxRequest, Vfs, VPath } from '../../contracts';
import { writeZip } from '../../fs/zip';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { importInto, newFolder, renamePath } from './actions';
import { deleteItems, type UndoEntry } from './bulk';
import { handleDrop, type DropDeps, type DroppedItem } from './drop';
import type { DroppedFolderProvider } from './providers';
import { gitRefusalFor, gitStoreName, writesBelowGit } from './git-guard';
import { createFileDialogs, feature } from './index';
import { moveTargets, transferItems } from './move';
import { renameChecked } from './store';
import { GIT_DROP_TOAST, GIT_NOT_IMPORTED, gitNameRefused, gitPathRefused, gitStoreRefused } from './texts';
import { ascii, filesTestDeps, memoryStores, scriptedDialogs, scriptedHistory, text } from './testing';

const GIT_SPELLINGS = ['.git', '.GIT', '.Git'];

/** Records every write, folder and removal of the Vfs, as the fake handle's write log does. */
function logWrites(vfs: Vfs): string[] {
  const log: string[] = [];
  const writeFile = vfs.writeFile.bind(vfs);
  const mkdirp = vfs.mkdirp.bind(vfs);
  const remove = vfs.remove.bind(vfs);
  vfs.writeFile = async (path, data) => {
    log.push(`write ${path}`);
    return writeFile(path, data);
  };
  vfs.mkdirp = async (path) => {
    log.push(`mkdir ${path}`);
    return mkdirp(path);
  };
  vfs.remove = async (path) => {
    log.push(`remove ${path}`);
    return remove(path);
  };
  return log;
}

/** The entries of the log that name a path below (or at) a folder named .git, any letter case. */
const belowGit = (log: readonly string[]) => log.filter((line) => /\/\.git(\/|$)/i.test(line));

async function seed(vfs: Vfs, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('/')) await vfs.mkdirp(path.slice(0, -1));
    else await vfs.writeFile(path, ascii(content));
  }
}

/** Gives the opened folder (/folder) the root handle of a folder named `name`, as FS2's has. */
function openedFolderNamed(vfs: Vfs, name: string): void {
  const backend = vfs.backends().find((b) => b.mount === 'folder');
  Object.assign(backend as object, { rootHandle: { kind: 'directory', name } });
}

/** An application whose name dialog answers `names` in turn and whose message boxes say OK. */
function application(names: (string | null)[]): { app: TestApplication; shown: MessageBoxRequest[] } {
  const app = createTestApplication({ features: [feature], services: { createFileDialogs } });
  const shown: MessageBoxRequest[] = [];
  app.ctx.dialogs.messageBox = async (request) => {
    shown.push(request);
    return request.buttons.includes('OK') ? 'OK' : (request.buttons[request.buttons.length - 1] as string);
  };
  const answered = new Set<DialogInstance>();
  const stop = app.ctx.store.subscribe(() => {
    for (const dialog of app.ctx.store.getState().dialogs.stack) {
      if (answered.has(dialog)) continue;
      answered.add(dialog);
      const result = names.length > 0 ? names.shift() : null;
      queueMicrotask(() => app.dialogs.close(dialog.key, result));
      if (names.length === 0) stop();
    }
  });
  return { app, shown };
}

describe('the texts (errata N5 entry 15)', () => {
  it('are exact', () => {
    expect(gitNameRefused('.Git')).toBe(
      'The name ".Git" cannot be used in the Files panel: a folder named .git holds a Git repository\'s own files, and the Files panel does not show it or write into it. Choose another name.',
    );
    expect(gitPathRefused('.git')).toBe(
      '".git" belongs to a Git repository: the Files panel does not write, move, copy or delete anything named .git or inside a folder named .git. Use your own tools.',
    );
    expect(gitStoreRefused('.git')).toBe(
      'The folder ".git" is the .git folder of a Git repository. The Files panel changes nothing in it.',
    );
    expect(GIT_NOT_IMPORTED).toBe('a folder named .git is not imported into the Files panel');
    expect(GIT_DROP_TOAST).toBe(
      "A folder named .git is not opened: the Files panel writes nothing into a Git repository's .git folder. Drop the folder that holds it.",
    );
  });

  it('gitRefusalFor names the .git segment, or the opened folder that is one', () => {
    const { vfs } = memoryStores();
    expect(gitRefusalFor(vfs, ['/browser/a.X68', '/folder/x'])).toBeNull();
    expect(gitRefusalFor(vfs, ['/browser/repo/.GIT/HEAD'])).toBe(gitPathRefused('.GIT'));
    expect(writesBelowGit(vfs, '/folder/x')).toBe(false);
    openedFolderNamed(vfs, '.Git');
    expect(gitStoreName(vfs, '/folder/x')).toBe('.Git');
    expect(gitStoreName(vfs, '/browser/x')).toBeNull();
    expect(writesBelowGit(vfs, '/folder')).toBe(true);
    expect(gitRefusalFor(vfs, ['/browser/a.X68', '/folder/x'])).toBe(gitStoreRefused('.Git'));
  });
});

describe('Rename to .git (P1.1 rule 2)', { timeout: 60_000 }, () => {
  it('a folder renamed to .git, .GIT or .Git is refused each time and asked again; nothing is written', async () => {
    const { app, shown } = application([...GIT_SPELLINGS, null]);
    const { ctx } = app;
    await seed(ctx.vfs, { '/browser/lab/main.X68': 'MAIN' });
    const log = logWrites(ctx.vfs);
    expect(await renamePath(ctx, '/browser/lab')).toBeNull();
    expect(shown.map((r) => [r.title, r.icon, r.text])).toEqual(
      GIT_SPELLINGS.map((name) => ['Rename', 'warning', gitNameRefused(name)]),
    );
    expect(log).toEqual([]);
    expect(text(await ctx.vfs.readFile('/browser/lab/main.X68'))).toBe('MAIN');
    app.dispose();
  });

  it('renameChecked (Rename and Undo Rename) refuses it too, in the opened folder as in My Programs', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/folder/lab/p.X68': 'P', '/browser/demo/q.X68': 'Q' });
    const log = logWrites(vfs);
    await expect(renameChecked(vfs, '/folder/lab', '.git')).rejects.toThrow(gitNameRefused('.git'));
    await expect(renameChecked(vfs, '/folder/lab', '.Git')).rejects.toThrow(gitNameRefused('.Git'));
    await expect(renameChecked(vfs, '/browser/demo', '.GIT')).rejects.toThrow(gitNameRefused('.GIT'));
    expect(log).toEqual([]);
  });

  it('a file is not renamed to .git either (the history takes a path named .git for a Git one)', async () => {
    const { app, shown } = application(['.git', null]);
    const { ctx } = app;
    await seed(ctx.vfs, { '/browser/a/pointer.txt': 'gitdir: x' });
    const log = logWrites(ctx.vfs);
    expect(await renamePath(ctx, '/browser/a/pointer.txt')).toBeNull();
    expect(shown.map((r) => r.text)).toEqual([gitNameRefused('.git')]);
    await expect(renameChecked(ctx.vfs, '/browser/a/pointer.txt', '.GIT')).rejects.toThrow(gitNameRefused('.GIT'));
    expect(log).toEqual([]);
    app.dispose();
  });

  it('Undo of a rename never renames back to .git', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/lab/p.X68': 'P' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const log = logWrites(vfs);
    // An entry no Rename can push now (Rename refuses .git), as an older window's stack might hold.
    deps.undo.push({
      kind: 'rename',
      pairs: [['/browser/.GIT', '/browser/lab']],
      folders: [],
      created: [],
      replaced: [],
    });
    expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual([]);
    expect(deps.dialogs.texts()).toEqual([gitPathRefused('.GIT')]);
    expect(belowGit(log)).toEqual([]);
    expect(text(await vfs.readFile('/browser/lab/p.X68'))).toBe('P');
  });
});

describe('New Folder named .git (P1.1 rule 2)', { timeout: 60_000 }, () => {
  it('.git, .GIT and .Git are refused and asked again; a valid name then works', async () => {
    const { app, shown } = application([...GIT_SPELLINGS, 'lab']);
    const { ctx } = app;
    const log = logWrites(ctx.vfs);
    expect(await newFolder(ctx, '/browser')).toBe('/browser/lab');
    expect(shown.map((r) => [r.title, r.icon, r.text])).toEqual(
      GIT_SPELLINGS.map((name) => ['New Folder', 'warning', gitNameRefused(name)]),
    );
    expect(belowGit(log)).toEqual([]);
    expect(log).toEqual(['mkdir /browser/lab']);
    app.dispose();
  });
});

describe('Move and Copy never write below .git (P1.1 rule 2)', { timeout: 60_000 }, () => {
  it('a .git folder given as an item (the tree never lists one) is refused, for a move and a copy', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/repo/.Git/HEAD': 'ref', '/browser/t/': '', '/browser/a.X68': 'A' });
    for (const mode of ['move', 'copy'] as const) {
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
      const log = logWrites(vfs);
      const outcome = await transferItems(deps, ['/browser/a.X68', '/browser/repo/.Git'], '/browser/t', mode);
      expect(outcome.done).toBe(false);
      expect(deps.dialogs.shown.map((r) => [r.title, r.text])).toEqual([
        [mode === 'move' ? 'Move' : 'Copy', gitPathRefused('.Git')],
      ]);
      expect(log).toEqual([]);
    }
    expect(text(await vfs.readFile('/browser/repo/.Git/HEAD'))).toBe('ref');
    expect(text(await vfs.readFile('/browser/a.X68'))).toBe('A');
  });

  it('a target below .git is refused with the text, and nothing is written', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/repo/.git/refs/': '', '/browser/a.X68': 'A' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const log = logWrites(vfs);
    expect((await transferItems(deps, ['/browser/a.X68'], '/browser/repo/.git/refs')).done).toBe(false);
    expect((await transferItems(deps, ['/browser/a.X68'], '/browser/repo/.GIT')).done).toBe(false);
    expect(deps.dialogs.texts()).toEqual([gitPathRefused('.git'), gitPathRefused('.GIT')]);
    expect(log).toEqual([]);
  });

  it('an opened folder that is a .git folder: nothing is moved into it or copied out of it, and Move To does not list it', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/folder/HEAD': 'ref', '/folder/refs/main': 'x', '/browser/a.X68': 'A' });
    openedFolderNamed(vfs, '.git');
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const log = logWrites(vfs);
    expect((await transferItems(deps, ['/browser/a.X68'], '/folder')).done).toBe(false);
    expect((await transferItems(deps, ['/folder/refs'], '/browser')).done).toBe(false);
    expect((await transferItems(deps, ['/folder/HEAD'], '/folder/refs')).done).toBe(false);
    expect(deps.dialogs.texts()).toEqual([gitStoreRefused('.git'), gitStoreRefused('.git'), gitStoreRefused('.git')]);
    expect(log).toEqual([]);
    expect((await moveTargets(deps, ['/browser/a.X68'])).map((t) => t.path)).toEqual(['/browser']);
  });

  it('Undo of a move or a copy never writes or removes below .git', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/t/p.X68': 'P', '/browser/r/.git/c.X68': 'C' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const log = logWrites(vfs);
    deps.undo.push({
      kind: 'move',
      pairs: [['/browser/.git/p.X68', '/browser/t/p.X68']],
      folders: [],
      created: [],
      replaced: [],
    });
    expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual([]);
    deps.undo.push({ kind: 'copy', copies: ['/browser/r/.git/c.X68'], created: [], replaced: [] });
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(deps.dialogs.texts()).toEqual([gitPathRefused('.git'), gitPathRefused('.git')]);
    expect(belowGit(log)).toEqual([]);
    expect(text(await vfs.readFile('/browser/t/p.X68'))).toBe('P');
    expect(text(await vfs.readFile('/browser/r/.git/c.X68'))).toBe('C');
  });
});

describe('Delete, Rename, New Folder and Import in an opened folder that is a .git folder', { timeout: 60_000 }, () => {
  it('are refused with the text, and nothing is written or removed', async () => {
    const { app, shown } = application(['x']);
    const { ctx } = app;
    const vfs = ctx.vfs;
    const { MemoryBackend } = await import('../../fs/memory-backend');
    vfs.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: .GIT' }));
    await seed(vfs, { '/folder/HEAD': 'ref', '/folder/refs/main': 'x' });
    openedFolderNamed(vfs, '.GIT');
    const log = logWrites(vfs);
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    expect((await deleteItems(deps, ['/folder/HEAD'])).deleted).toEqual([]);
    expect(await renamePath(ctx, '/folder/refs')).toBeNull();
    expect(await newFolder(ctx, '/folder')).toBeNull();
    expect(await importInto(ctx, '/folder', [{ rel: 'a.X68', read: async () => ascii('A'), size: 1 }])).toBeNull();
    expect(deps.dialogs.shown.map((r) => [r.title, r.text])).toEqual([['Delete', gitStoreRefused('.GIT')]]);
    expect(shown.map((r) => [r.title, r.text])).toEqual([
      ['Rename', gitStoreRefused('.GIT')],
      ['New Folder', gitStoreRefused('.GIT')],
      ['Import', gitStoreRefused('.GIT')],
    ]);
    expect(log).toEqual([]);
    app.dispose();
  });
});

describe('Import and a dropped folder named .git (P1.1 rule 2)', { timeout: 60_000 }, () => {
  it('an imported folder named .git (any letter case) is left out and named; a repository inside a folder comes in as today', async () => {
    const { app } = application([]);
    const { ctx } = app;
    const toasts: string[] = [];
    ctx.dialogs.toast = (t) => void toasts.push(t);
    const log = logWrites(ctx.vfs);
    const item = (rel: string, data = rel) => ({ rel, read: async () => ascii(data), size: data.length });
    const result = await importInto(ctx, '/browser', [
      item('.git/'),
      item('.git/HEAD'),
      item('.GIT/config'),
      item('lab3/'),
      item('lab3/.git/HEAD', 'repo'),
      item('lab3/main.X68'),
      item('a.X68'),
    ]);
    expect(result?.written).toEqual(['/browser/lab3/.git/HEAD', '/browser/lab3/main.X68', '/browser/a.X68']);
    expect(log.filter((l) => /^(write|mkdir) \/browser\/\.git/i.test(l))).toEqual([]);
    expect(await ctx.vfs.stat('/browser/.git')).toBeNull();
    expect(await ctx.vfs.stat('/browser/.GIT')).toBeNull();
    expect(toasts).toEqual([
      `Imported 3 files into My Programs. Not imported: .git/: ${GIT_NOT_IMPORTED}; .GIT/: ${GIT_NOT_IMPORTED}`,
    ]);
    app.dispose();
  });

  it('a .zip whose top folder is .git is unpacked without it', async () => {
    const { app } = application([]);
    const { ctx } = app;
    const toasts: string[] = [];
    ctx.dialogs.toast = (t) => void toasts.push(t);
    const zip = writeZip([
      { path: '.Git/', mtime: 0 },
      { path: '.Git/HEAD', data: ascii('ref'), mtime: 0 },
      { path: 'p.X68', data: ascii('P'), mtime: 0 },
    ]);
    const result = await importInto(ctx, '/browser', [{ rel: 'x.zip', read: async () => zip, size: zip.length }]);
    expect(result?.written).toEqual(['/browser/p.X68']);
    expect(await ctx.vfs.stat('/browser/.Git')).toBeNull();
    expect(toasts).toEqual([`Imported 1 file into My Programs. Not imported: .Git/: ${GIT_NOT_IMPORTED}`]);
    app.dispose();
  });

  it('a dropped folder named .git is not offered to the opened-folder provider', async () => {
    const offered: unknown[] = [];
    const toasts: string[] = [];
    const deps: DropDeps = {
      mode: 'editor',
      programLoaded: false,
      messageBox: async () => 'OK',
      toast: (t) => void toasts.push(t),
      importFile: async (name) => `/browser/Imported/${name}` as VPath,
      openDocument: async () => null,
      openProgram: async () => {},
      folderProviders: () => [
        {
          id: 'folder',
          label: 'Open folder...',
          available: () => true,
          openDroppedFolder: async (handle: unknown) => {
            offered.push(handle);
            return true;
          },
        } as unknown as DroppedFolderProvider,
      ],
    };
    const folder = (name: string): DroppedItem => ({
      name,
      isFolder: true,
      read: () => Promise.reject(new Error('folder')),
      handle: Promise.resolve({ kind: 'directory', name }),
    });
    for (const name of GIT_SPELLINGS) {
      const outcome = await handleDrop([folder(name)], deps);
      expect(outcome.folders).toBe('refused');
    }
    expect(offered).toEqual([]);
    expect(toasts).toEqual(GIT_SPELLINGS.map(() => GIT_DROP_TOAST));
    // Any other folder is still offered.
    expect((await handleDrop([folder('lab')], deps)).folders).toBe('taken');
    expect(offered).toEqual([{ kind: 'directory', name: 'lab' }]);
  });
});

describe('the question texts keep No as the default button (P3.2.2, P3.3.4)', () => {
  it('Delete and the cannot-keep question name No', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a.X68': 'A' });
    const dialogs = scriptedDialogs(['Yes', 'No']);
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs, { script: () => 'cannot-keep' }), dialogs });
    await deleteItems(deps, ['/browser/a.X68']);
    expect(dialogs.shown.map((r) => r.defaultButton)).toEqual(['No', 'No']);
    expect(text(await vfs.readFile('/browser/a.X68'))).toBe('A');
  });
});
