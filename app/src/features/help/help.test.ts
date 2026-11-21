import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { panelVisible } from '../../state/panels';
import { createFakePlatform, createTestApplication } from '../../state/testing';
import { checkForUpdate } from './AboutDialog';
import { HelpController, helpControllerOf, type FetchLike } from './controller';
import { feature } from './index';
import { wordContextFrom, type ElementLike, type NodeLike, type SelectionLike } from './editor-context';

const HELP = new URL('../../../public/help/', import.meta.url);
const hhc = readFileSync(new URL('contents.hhc', HELP), 'utf8');

const fetchHhc: FetchLike = async (url) => {
  expect(url).toMatch(/help\/contents\.hhc$/);
  return { ok: true, status: 200, text: async () => hhc };
};

describe('the help feature in an application', { timeout: 60_000 }, () => {
  it('registers the eight commands, the help panel and the two About dialogs', () => {
    expect(Object.keys(feature.commands ?? {}).sort()).toEqual(
      [
        'app.help.differences',
        'app.help.examples',
        'ed.help.about',
        'ed.help.context',
        'ed.help.help',
        'sim.help.about',
        'sim.help.context',
        'sim.help.help',
      ].sort(),
    );
    expect(feature.panels?.map((panel) => panel.id)).toEqual(['help']);
    expect(Object.keys(feature.dialogs ?? {}).sort()).toEqual(['about.editor', 'about.sim']);
    const app = createTestApplication({ features: [feature] });
    expect(app.panels.find('editor', 'help')?.title).toBe('Help');
    expect(app.panels.find('simulator', 'help')).toBeDefined(); // the drawer serves every mode
    expect(app.panels.find('easybin', 'help')).toBeDefined();
  });

  it('Help > Help shows the introduction with the contents; the panel appears', async () => {
    const app = createTestApplication({ features: [feature] });
    expect(panelVisible(app.ctx, 'help')).toBe(false);
    await app.ctx.commands.run('ed.help.help');
    expect(panelVisible(app.ctx, 'help')).toBe(true);
    const state = helpControllerOf(app.ctx).getState();
    expect(state.current).toEqual({ page: 'main.htm', fragment: '' });
    expect(state.contentsOpen).toBe(true);
  });

  it('Sim68K Help opens the simulator help, not the introduction (note 10)', async () => {
    const app = createTestApplication({ features: [feature] });
    await app.ctx.commands.run('sim.help.help');
    expect(helpControllerOf(app.ctx).getState().current.page).toBe('SIMHELP/BasicOperation.htm');
    expect(helpControllerOf(app.ctx).getState().contentsOpen).toBe(false);
    await app.ctx.commands.run('sim.help.context'); // no focus in a panel: the main window's page
    expect(helpControllerOf(app.ctx).getState().current.page).toBe('SIMHELP/BasicOperation.htm');
  });

  it('Differences from EASy68K opens the generated page', async () => {
    const app = createTestApplication({ features: [feature] });
    await app.ctx.commands.run('app.help.differences');
    expect(helpControllerOf(app.ctx).getState().current.page).toBe('Port/differences.htm');
    expect(panelVisible(app.ctx, 'help')).toBe(true);
  });

  it('uses the desktop help window when the platform has one', async () => {
    const shown: string[] = [];
    const platform = createFakePlatform({ kind: 'desktop', showHelp: (page) => (shown.push(page), true) });
    const app = createTestApplication({ features: [feature], platform });
    await app.ctx.commands.run('ed.help.help');
    await app.ctx.commands.run('app.help.differences');
    expect(shown).toEqual(['main.htm', 'Port/differences.htm']);
    expect(panelVisible(app.ctx, 'help')).toBe(false);
  });

  it('F1 in the editor: ed.help.context is enabled only while the editor has the focus', () => {
    const app = createTestApplication({ features: [feature] });
    // No DOM under Node: nothing has the focus, so the key goes on to ed.help.help.
    expect(app.ctx.commands.isEnabled('ed.help.context')).toBe(false);
    expect(app.ctx.commands.isEnabled('ed.help.help')).toBe(true);
  });

  it('opens the two About dialogs', async () => {
    for (const [command, id] of [
      ['ed.help.about', 'about.editor'],
      ['sim.help.about', 'about.sim'],
    ] as const) {
      const app = createTestApplication({ features: [feature] });
      void app.ctx.commands.run(command);
      await Promise.resolve();
      expect(app.ctx.store.getState().dialogs.stack.map((dialog) => dialog.id)).toEqual([id]);
    }
  });
});

describe('HelpController', () => {
  const make = () => new HelpController('http://h/app/', fetchHhc);

  it('keeps a history for Back and Forward and drops the forward part on a new page', () => {
    const controller = make();
    controller.show('options.htm');
    controller.show('Directives/org.htm#x');
    expect(controller.canGoBack).toBe(true);
    expect(controller.canGoForward).toBe(false);
    controller.back();
    expect(controller.getState().current.page).toBe('options.htm');
    expect(controller.canGoForward).toBe(true);
    controller.show('errors.htm');
    expect(controller.canGoForward).toBe(false);
    expect(controller.getState().history.map((entry) => entry.page)).toEqual(['main.htm', 'options.htm', 'errors.htm']);
    controller.back();
    controller.back();
    controller.back(); // at the start: nothing happens
    expect(controller.getState().current.page).toBe('main.htm');
  });

  it('does not add the same page twice, but loads it again', () => {
    const controller = make();
    controller.show('options.htm');
    const before = controller.getState();
    controller.show('options.htm');
    expect(controller.getState().history).toEqual(before.history);
    expect(controller.getState().navigation).toBe(before.navigation + 1);
  });

  it('reads contents.hhc once and opens the books above the shown page', async () => {
    const controller = make();
    let reads = 0;
    const counting = new HelpController('http://h/app/', async (url) => (reads++, fetchHhc(url)));
    await Promise.all([counting.ensureContents(), counting.ensureContents()]);
    await counting.ensureContents();
    expect(reads).toBe(1);
    expect(counting.getState().contents).not.toBeNull();
    counting.show('Directives/org.htm');
    expect(counting.getState().open.size).toBeGreaterThan(0);
    expect(counting.getState().title).toBe('ORG');
    expect(controller.getState().contents).toBeNull();
  });

  it('reports a contents file that cannot be read, and retries', async () => {
    let fail = true;
    const controller = new HelpController('http://h/app/', async (url) =>
      fail ? { ok: false, status: 404, text: async () => '' } : fetchHhc(url),
    );
    await controller.ensureContents();
    expect(controller.getState().contentsError).toBe('HTTP 404');
    fail = false;
    await controller.ensureContents();
    expect(controller.getState().contents).not.toBeNull();
    expect(controller.getState().contentsError).toBeNull();
  });

  it('takes the title of the loaded page', () => {
    const controller = make();
    controller.noteLoaded({ page: 'main.htm', fragment: '' }, '  Easy68k Introduction ');
    expect(controller.getState().title).toBe('Easy68k Introduction');
    expect(controller.getState().history).toHaveLength(1);
  });

  it('records a page the frame went to by itself (a link the panel could not intercept) as a new page', () => {
    const controller = make();
    controller.show('credits.htm');
    controller.noteLoaded({ page: 'credits.htm', fragment: '' }, 'Credits'); // the page it asked for
    controller.noteLoaded({ page: 'options.htm', fragment: '' }, 'Options'); // nobody asked: the user followed a link
    expect(controller.getState().current.page).toBe('options.htm');
    expect(controller.getState().history.map((entry) => entry.page)).toEqual([
      'main.htm',
      'credits.htm',
      'options.htm',
    ]);
    controller.back();
    expect(controller.getState().current.page).toBe('credits.htm');
  });

  it('ignores a late load of an older page while it waits for the one it asked for', () => {
    const controller = make();
    controller.show('credits.htm');
    controller.noteLoaded({ page: 'credits.htm', fragment: '' }, 'Credits');
    controller.show('options.htm');
    controller.back(); // asks for credits.htm
    controller.noteLoaded({ page: 'options.htm', fragment: '' }, 'Options'); // the old document's late load
    expect(controller.getState().current.page).toBe('credits.htm');
    expect(controller.getState().history.map((entry) => entry.page)).toEqual([
      'main.htm',
      'credits.htm',
      'options.htm',
    ]);
    controller.noteLoaded({ page: 'credits.htm', fragment: '' }, 'Credits');
    expect(controller.getState().title).toBe('Credits');
  });

  it('filters and toggles the tree state', () => {
    const controller = make();
    controller.setFilter('org');
    expect(controller.getState().filter).toBe('org');
    controller.toggleBook('1');
    expect(controller.getState().open.has('1')).toBe(true);
    controller.toggleBook('1');
    expect(controller.getState().open.has('1')).toBe(false);
  });

  it('notifies listeners', () => {
    const controller = make();
    let calls = 0;
    const off = controller.subscribe(() => calls++);
    controller.show('options.htm');
    off();
    controller.show('errors.htm');
    expect(calls).toBe(1);
  });
});

describe('the update check', () => {
  const answer =
    (body: unknown, ok = true) =>
    async () => ({ ok, json: async () => body });

  it('answers with the original’s three texts', async () => {
    expect(await checkForUpdate('0.2.0', answer({ tag_name: 'v0.2.0' }))).toBe('Up to date');
    expect(await checkForUpdate('0.2.0', answer({ tag_name: 'v0.3.0' }))).toBe('Update available');
    expect(await checkForUpdate('unknown', answer({ tag_name: 'nightly' }))).toBe('Update available');
    expect(await checkForUpdate('0.2.0', answer({ tag_name: 'v0.2.0' }, false))).toBe('Network error');
    expect(await checkForUpdate('0.2.0', answer({}))).toBe('Network error');
    expect(
      await checkForUpdate('0.2.0', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe('Network error');
  });

  it('asks the port’s releases', async () => {
    let asked = '';
    await checkForUpdate(
      '1.0.0',
      async (url) => ((asked = url), { ok: true, json: async () => ({ tag_name: 'v1.0.0' }) }),
    );
    expect(asked).toBe('https://api.github.com/repos/gurmyd/easy68k-mac/releases/latest');
  });
});

describe('the editor context adapter', () => {
  const text = (content: string): NodeLike => ({ textContent: content, parentElement: null, nodeType: 3 });
  const line = (content: string): ElementLike => ({
    textContent: content,
    parentElement: null,
    nodeType: 1,
    closest: (selector) => (selector.includes('.cm-line') ? line(content) : null),
  });
  const selection = (parts: Partial<SelectionLike> & { node: NodeLike | null }): SelectionLike => ({
    isCollapsed: true,
    anchorNode: parts.node,
    anchorOffset: 0,
    toString: () => '',
    ...parts,
  });

  it('gives a selection as it is', () => {
    expect(
      wordContextFrom(selection({ node: text('x'), isCollapsed: false, toString: () => 'MOVE.L' }), () => ''),
    ).toEqual({
      selected: 'MOVE.L',
      text: '',
      caret: 0,
    });
  });

  it('gives the caret line between line ends', () => {
    const node: NodeLike = { textContent: '  MOVE.L D0', nodeType: 3, parentElement: line('  MOVE.L D0') };
    expect(
      wordContextFrom(selection({ node, anchorOffset: 4 }), (_, offset) => '  MOVE.L D0'.slice(0, offset)),
    ).toEqual({
      selected: '',
      text: '\n  MOVE.L D0\n',
      caret: 5,
    });
  });

  it('gives nothing outside a line', () => {
    expect(wordContextFrom(selection({ node: null }), () => '')).toBeNull();
    expect(wordContextFrom(selection({ node: text('x') }), () => '')).toBeNull();
  });
});
