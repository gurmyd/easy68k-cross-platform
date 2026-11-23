// The Files panel's tree (2.2, 3.8.6): rows, folders, live updates, keys.

import { describe, expect, it } from 'vitest';
import type { Bytes } from '../../contracts';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { FilesTreeModel, scrollToShow } from './tree-model';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));

async function setup() {
  const vfs = createVfs();
  const backend = new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' });
  vfs.mount(backend);
  await vfs.writeFile('/browser/demo/prog.X68', ascii('x'));
  await vfs.writeFile('/browser/demo/sub/inc.X68', ascii('x'));
  await vfs.writeFile('/browser/a.txt', ascii('x'));
  const model = new FilesTreeModel(vfs);
  await model.settled();
  return { vfs, backend, model };
}

const shown = (model: FilesTreeModel) =>
  model
    .rows()
    .map((row) => `${'  '.repeat(row.depth - 1)}${row.kind === 'file' ? '' : row.expanded ? '-' : '+'}${row.name}`);

async function until(condition: () => boolean, what: string): Promise<void> {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('FilesTreeModel', { timeout: 60_000 }, () => {
  it('reveal of a path that does not exist selects no row and does not throw (FilesRevealArg)', async () => {
    const { model } = await setup();
    await expect(model.reveal('/browser/Examples/hello.X68')).resolves.toBeUndefined();
    expect(model.selectedRow()).toBeNull();
    await model.reveal('/browser/demo/sub');
    expect(model.selectedRow()?.path).toBe('/browser/demo/sub');
  });

  it('shows the store expanded, folders first, and opens and closes folders', async () => {
    const { model } = await setup();
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt']);
    await model.expand('/browser/demo');
    expect(shown(model)).toEqual(['-My Programs', '  -demo', '    +sub', '    prog.X68', '  a.txt']);
    model.collapse('/browser/demo');
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt']);
  });

  it('reveal expands the way to a path and selects it', async () => {
    const { model } = await setup();
    await model.reveal('/browser/demo/sub/inc.X68');
    expect(model.selected).toBe('/browser/demo/sub/inc.X68');
    expect(shown(model)).toContain('      inc.X68');
  });

  it('a write and a remove anywhere (this window or another) update the listed folders', async () => {
    const { vfs, backend, model } = await setup();
    await model.expand('/browser/demo');
    await vfs.writeFile('/browser/demo/new.X68', ascii('n'));
    await until(() => shown(model).includes('    new.X68'), 'new file listed');
    await backend.externalWrite('demo/other.X68', ascii('o')); // as another window would
    await until(() => shown(model).includes('    other.X68'), 'external file listed');
    model.select('/browser/demo/sub');
    await vfs.remove('/browser/demo');
    await until(() => !shown(model).some((row) => row.includes('demo')), 'folder gone');
    expect(model.selected).toBe('/browser');
  });

  it('a store mounted later appears; one unmounted disappears', async () => {
    const { vfs, model } = await setup();
    const folder = new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: work' });
    await folder.writeFile('w.X68', ascii('w'));
    vfs.mount(folder);
    await model.refreshAll();
    await model.settled();
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt', '-Folder: work', '  w.X68']);
    vfs.unmount('folder');
    await model.refreshAll();
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt']);
  });

  it('keys follow the tree view pattern', async () => {
    const { model } = await setup();
    expect(model.keyAction('ArrowDown')).toEqual({ kind: 'select', path: '/browser' });
    model.select('/browser');
    expect(model.keyAction('ArrowDown')).toEqual({ kind: 'select', path: '/browser/demo' });
    expect(model.keyAction('ArrowLeft')).toEqual({ kind: 'toggle', path: '/browser' });
    model.select('/browser/demo');
    expect(model.keyAction('ArrowRight')).toEqual({ kind: 'toggle', path: '/browser/demo' });
    expect(model.keyAction('Enter')).toEqual({ kind: 'toggle', path: '/browser/demo' });
    await model.expand('/browser/demo');
    expect(model.keyAction('ArrowRight')).toEqual({ kind: 'select', path: '/browser/demo/sub' });
    model.select('/browser/demo/prog.X68');
    expect(model.keyAction('Enter')).toEqual({ kind: 'open', path: '/browser/demo/prog.X68' });
    expect(model.keyAction(' ')).toEqual({ kind: 'open', path: '/browser/demo/prog.X68' });
    expect(model.keyAction('ArrowLeft')).toEqual({ kind: 'select', path: '/browser/demo' });
    expect(model.keyAction('ArrowRight')).toBeNull();
    expect(model.keyAction('Home')).toEqual({ kind: 'select', path: '/browser' });
    expect(model.keyAction('End')).toEqual({ kind: 'select', path: '/browser/a.txt' });
    expect(model.keyAction('x')).toBeNull();
  });

  // ---- ARCHITECTURE-PLUS P3.2.1, P3.2.5, P3.3.10 (N5) ----

  it('several rows can be selected; a removed item leaves the selection, the others stay', async () => {
    const { vfs, model } = await setup();
    await model.expand('/browser/demo');
    model.select('/browser/demo/sub');
    model.selectRange('/browser/a.txt');
    expect(model.selectedPaths()).toEqual(['/browser/demo/sub', '/browser/demo/prog.X68', '/browser/a.txt']);
    await vfs.remove('/browser/demo/prog.X68');
    await until(() => !shown(model).includes('    prog.X68'), 'file gone');
    expect(model.selectedPaths()).toEqual(['/browser/demo/sub', '/browser/a.txt']);
  });

  it('a .git folder is never listed; the folder or root that holds one says so in its tool-tip', async () => {
    const { vfs, model } = await setup();
    await vfs.writeFile('/browser/.git/HEAD', ascii('ref'));
    await vfs.writeFile('/browser/demo/.GIT/HEAD', ascii('ref'));
    await model.refreshAll();
    await model.expand('/browser/demo');
    expect(shown(model)).toEqual(['-My Programs', '  -demo', '    +sub', '    prog.X68', '  a.txt']);
    const rows = model.rows();
    expect(rows[0]?.tooltip).toBe('My Programs\nGit repository (its .git folder is not shown)');
    expect(rows[1]?.tooltip).toBe('demo\nGit repository (its .git folder is not shown)');
  });

  it('the opened folder: its label, the secondary text and the tool-tip of P3.2.5', async () => {
    const { vfs, model } = await setup();
    vfs.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: Lab' }));
    await model.refreshAll();
    const root = model.rows().find((row) => row.path === '/folder');
    expect(root).toMatchObject({
      name: 'Folder: Lab',
      secondary: 'on this computer',
      tooltip: 'Files here are the files of the folder "Lab" on this computer.',
    });
  });

  it('"Opened from this computer" lists each linked file by its name, only while one is linked', async () => {
    const { vfs, model } = await setup();
    const linked = new MemoryBackend({ mount: 'linked', kind: 'browser', label: 'Linked files' });
    vfs.mount(linked);
    await model.refreshAll();
    await model.settled();
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt']);
    await vfs.writeFile('/linked/ab12/lab1.X68', ascii('x'));
    await vfs.writeFile('/linked/ab12/lab1.L68', ascii('listing'));
    await vfs.writeFile('/linked/ab12/lab1.S68', ascii('S0'));
    await until(() => shown(model).includes('  lab1.X68'), 'linked file listed');
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt', '-Opened from this computer', '  lab1.X68']);
    const row = model.rows().at(-1);
    expect(row).toMatchObject({
      path: '/linked/ab12/lab1.X68',
      secondary: 'edited in place',
      tooltip: 'Saving writes to the file "lab1.X68" on this computer.',
      linked: true,
    });
    await vfs.remove('/linked/ab12');
    await until(() => !shown(model).includes('  lab1.X68'), 'linked file gone');
    expect(shown(model)).toEqual(['-My Programs', '  +demo', '  a.txt']);
  });

  it('the expanded folders of an opened folder are listed again when the window regains the focus', async () => {
    const { vfs, model } = await setup();
    const folder = new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: Lab' });
    vfs.mount(folder);
    await model.refreshAll();
    await model.settled();
    // Git or another program writes there; the backend has no change events (3.8.1).
    await folder.writeFile('from-git.X68', ascii('g'));
    expect(shown(model)).not.toContain('  from-git.X68');
    await model.windowFocused();
    expect(shown(model)).toContain('  from-git.X68');
  });

  it('collapsing a folder moves a selection inside it to the folder', async () => {
    const { model } = await setup();
    await model.expand('/browser/demo');
    model.select('/browser/demo/prog.X68');
    model.collapse('/browser/demo');
    expect(model.selected).toBe('/browser/demo');
  });
});

describe('reveals: a reveal brings the row into view also when it was focused already', () => {
  it('counts every reveal that selected a row, and nothing else', async () => {
    const { model } = await setup();
    expect(model.reveals).toBe(0);
    await model.reveal('/browser/demo/prog.X68');
    expect(model.reveals).toBe(1);
    await model.reveal('/browser/demo/prog.X68');
    expect(model.reveals).toBe(2);
    model.select('/browser/a.txt');
    await model.expand('/browser/demo/sub');
    expect(model.reveals).toBe(2);
  });
});

describe('scrollToShow: the focused row comes into view as scrollIntoView nearest would (errata N5 21)', () => {
  // A tree of 200 x 100 at (10, 50) with a border of 1 and a horizontal scroll bar of 15.
  const tree = { top: 50, left: 10, bottom: 150, right: 210 };
  const client = { clientTop: 1, clientLeft: 1, clientWidth: 198, clientHeight: 83 };
  const row = (top: number, left = 11, height = 22, width = 198) => ({
    top,
    left,
    bottom: top + height,
    right: left + width,
  });

  it('a row wholly in view needs no scroll', () => {
    expect(scrollToShow(tree, client, row(51))).toEqual({ top: 0, left: 0 });
    expect(scrollToShow(tree, client, row(112))).toEqual({ top: 0, left: 0 });
  });
  it('a row above the view aligns its top with the top of the view', () => {
    expect(scrollToShow(tree, client, row(30))).toEqual({ top: -21, left: 0 });
    expect(scrollToShow(tree, client, row(-400))).toEqual({ top: -451, left: 0 });
  });
  it('a row below the view, or behind the scroll bar, aligns its bottom with the bottom of the view', () => {
    // The view ends at 50 + 1 + 83 = 134: a row from 120 to 142 is partly behind the scroll bar.
    expect(scrollToShow(tree, client, row(120))).toEqual({ top: 8, left: 0 });
    expect(scrollToShow(tree, client, row(900))).toEqual({ top: 788, left: 0 });
  });
  it('a row taller than the view that covers it needs no scroll; one partly out aligns the far edge', () => {
    expect(scrollToShow(tree, client, row(40, 11, 200))).toEqual({ top: 0, left: 0 });
    expect(scrollToShow(tree, client, row(60, 11, 200))).toEqual({ top: 9, left: 0 });
  });
  it('a tree scrolled sideways goes back to show the row from its start', () => {
    expect(scrollToShow(tree, client, row(60, -89))).toEqual({ top: 0, left: -100 });
  });
});
