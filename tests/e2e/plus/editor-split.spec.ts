// The editor split of the Window menu (ARCHITECTURE-PLUS P3.1.4, P3.1.7; P5 N2; P6.3). Owner: N9.
//
// Split Editor Right does what Tile Vertically does from one pane (the active document goes into
// the second pane, the one opened before it stays in the first); with two panes it moves the active
// document to the other pane and gives the panes the command's orientation. Split Editor Down is the
// same one above the other; Close Split does what Cascade does. Each document is in one pane (the
// two-pane model of E2): the two panes show two documents, never the same one twice. Every command
// is chosen in the Window menu, and the test reads what a person sees: where the panes are, the tab
// in front in each, and the text each shows.

import { crlf, expect, test, type App } from '../fixtures';
import { regionBox } from '../fixtures/plus';

const FILES = [
  { name: 'a.X68', data: crlf('* first file', 'A    RTS') },
  { name: 'b.X68', data: crlf('* second file', 'B    RTS') },
  { name: 'c.X68', data: crlf('* third file', 'C    RTS') },
];
const TEXT = Object.fromEntries(FILES.map((file) => [file.name, file.data.replace(/\r\n/g, '\n')]));

/** The tab in front in a pane and the text the pane shows. */
async function shows(app: App, index: number): Promise<{ tab: string | undefined; text: string }> {
  return { tab: (await app.tabs(index)).find((tab) => tab.selected)?.name, text: await app.text(index) };
}

/** Where the second pane is drawn, from the boxes of the two panes. */
async function arrangement(app: App): Promise<'one' | 'side by side' | 'one above the other' | 'other'> {
  if ((await app.pane(1).count()) === 0) return 'one';
  const [first, second] = await Promise.all([app.pane(0).boundingBox(), app.pane(1).boundingBox()]);
  if (!first || !second || first.width === 0 || second.width === 0) return 'other';
  if (second.x >= first.x + first.width - 1 && Math.abs(second.y - first.y) <= 1) return 'side by side';
  if (second.y >= first.y + first.height - 1 && Math.abs(second.x - first.x) <= 1) return 'one above the other';
  return 'other';
}

/** Whether an entry of the Window menu is enabled. */
async function enabled(app: App, caption: string): Promise<boolean> {
  const entry = (await app.menuEntries('Window')).find((item) => item.caption === caption);
  expect(entry, `the Window menu has ${caption}`).toBeDefined();
  return !entry!.disabled;
}

test('Split Editor Right, Split Editor Down and Close Split from the Window menu arrange the editor in two panes and back', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.importFiles(FILES);
  for (const file of FILES) {
    await app.treeItem(file.name).dblclick();
    await expect.poll(async () => (await shows(app, 0)).tab).toBe(file.name);
  }
  expect(await arrangement(app)).toBe('one');
  expect(await enabled(app, 'Split Editor Right'), 'a document is open').toBe(true);
  expect(await enabled(app, 'Split Editor Down')).toBe(true);
  expect(await enabled(app, 'Close Split'), 'one pane: nothing to close').toBe(false);
  const editorBox = await regionBox(app, 'editor');

  await test.step('Split Editor Right: the active document beside the one opened before it', async () => {
    await app.chooseMenu('Window', 'Split Editor Right');
    await expect.poll(() => arrangement(app)).toBe('side by side');
    await expect.poll(() => shows(app, 1)).toEqual({ tab: 'c.X68', text: TEXT['c.X68'] });
    await expect.poll(() => shows(app, 0)).toEqual({ tab: 'b.X68', text: TEXT['b.X68'] });
    expect(await app.tabNames(1)).toEqual(['c.X68']);
    expect(await enabled(app, 'Close Split')).toBe(true);
    // The split is inside the Editor panel: the panel itself stays where it was.
    expect(await regionBox(app, 'editor')).toEqual(editorBox);
  });

  await test.step('Split Editor Down with a.X68 in front: one above the other, a.X68 in the lower pane', async () => {
    await app.tab('a.X68', 0).click();
    await expect.poll(async () => (await shows(app, 0)).tab).toBe('a.X68');
    await app.chooseMenu('Window', 'Split Editor Down');
    await expect.poll(() => arrangement(app)).toBe('one above the other');
    await expect.poll(() => shows(app, 1)).toEqual({ tab: 'a.X68', text: TEXT['a.X68'] });
    await expect.poll(() => shows(app, 0)).toEqual({ tab: 'b.X68', text: TEXT['b.X68'] });
    expect((await app.tabNames(1)).sort()).toEqual(['a.X68', 'c.X68']);
    expect(await app.tabNames(0)).not.toContain('a.X68');
  });

  await test.step('Split Editor Right again: side by side, the active document back in the first pane', async () => {
    await app.chooseMenu('Window', 'Split Editor Right');
    await expect.poll(() => arrangement(app)).toBe('side by side');
    await expect.poll(() => shows(app, 0)).toEqual({ tab: 'a.X68', text: TEXT['a.X68'] });
    await expect.poll(() => shows(app, 1)).toEqual({ tab: 'c.X68', text: TEXT['c.X68'] });
  });

  await test.step('Close Split: one pane again, with every document and the active one in front', async () => {
    await app.chooseMenu('Window', 'Close Split');
    await expect.poll(() => arrangement(app)).toBe('one');
    await expect.poll(() => shows(app, 0)).toEqual({ tab: 'a.X68', text: TEXT['a.X68'] });
    expect((await app.tabNames(0)).filter((name) => name.endsWith('.X68')).sort()).toEqual(['a.X68', 'b.X68', 'c.X68']);
    expect(await enabled(app, 'Close Split')).toBe(false);
    expect(await regionBox(app, 'editor')).toEqual(editorBox);
  });
});
