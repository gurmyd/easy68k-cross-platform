// Resolving the tables against the running application (commands/menus.ts) and the native menu
// of the desktop app (commands/native-menu.ts).

import { describe, expect, it } from 'vitest';
import type { AppState, CommandId, DocumentState, NativeMenuItem } from '../contracts';
import { defaultSettings } from '../core/settings/defaults';
import { initialAppState } from '../state/store';
import type { Os } from './chords';
import { COMMAND_IDS } from './ids';
import {
  displayChord,
  resolveMenus,
  resolveToolbar,
  shortcutText,
  type ResolveEnv,
  type ResolvedItem,
  type ResolvedNode,
  blockedByHalt,
} from './menus';
import { buildNativeMenu } from './native-menu';
import { HALTED_HINT } from './tables/toolbars';

function env(
  options: {
    os?: Os;
    desktop?: boolean;
    state?: AppState;
    enabled?: (id: CommandId) => boolean;
    checked?: (id: CommandId, arg?: unknown) => boolean;
  } = {},
): ResolveEnv {
  return {
    os: options.os ?? 'windows',
    desktop: options.desktop ?? false,
    state: options.state ?? initialAppState(defaultSettings()),
    commands: { isEnabled: options.enabled ?? (() => false), isChecked: options.checked ?? (() => false) },
  };
}

const document = (id: string, name: string): DocumentState => ({
  id,
  path: null,
  name,
  kind: 'source',
  hasName: false,
  tabType: 1,
  tabSize: 4,
  fontName: 'Courier New',
  fontSize: 10,
  insertMode: true,
  modified: false,
  revision: 0,
});

function items(nodes: readonly ResolvedNode[]): ResolvedItem[] {
  return nodes.flatMap((node) => (node.type === 'item' ? [node] : node.type === 'submenu' ? items(node.items) : []));
}

describe('resolveMenus', () => {
  it('shows every command without a handler as disabled (3.12.2)', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      const all = resolveMenus(mode, env()).flatMap((menu) => items(menu.items));
      expect(all.length).toBeGreaterThan(5);
      for (const item of all) expect(item.enabled, item.id).toBe(false);
    }
  });

  it('asks the registry for the enabled and checked state, with the argument', () => {
    const menus = resolveMenus(
      'simulator',
      env({
        enabled: (id) => id === 'sim.options.size' || id === 'sim.run.run',
        checked: (id, arg) => id === 'sim.options.size' && arg === 2,
      }),
    );
    const all = menus.flatMap((menu) => items(menu.items));
    expect(all.filter((item) => item.enabled).map((item) => item.id)).toEqual([
      'sim.run.run',
      ...new Array(9).fill('sim.options.size'),
    ]);
    const sizes = all.filter((item) => item.id === 'sim.options.size');
    expect(sizes.map((item) => item.arg)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sizes.map((item) => item.checked)).toEqual([false, false, true, false, false, false, false, false, false]);
    expect(sizes[2]).toMatchObject({ caption: '1024x768', kind: 'radio' });
  });

  it('shows the shortcut of the platform, the usable one first', () => {
    const shortcuts = (os: Os, desktop: boolean) =>
      Object.fromEntries(
        resolveMenus('simulator', env({ os, desktop }))
          .flatMap((menu) => items(menu.items))
          .filter((item) => item.shortcut !== null)
          .map((item) => [item.id, item.shortcut]),
      );
    expect(shortcuts('windows', false)).toEqual({
      'sim.file.open': 'Ctrl+O',
      'sim.search.find': 'Ctrl+F',
      'sim.search.gotoPC': 'Ctrl+G',
      'sim.run.run': 'F9',
      'sim.run.runToCursor': 'Ctrl+F9',
      'sim.run.autoTrace': 'F10',
      'sim.run.stepOver': 'F8',
      'sim.run.traceInto': 'F7',
      'sim.run.pause': 'F6',
      'sim.run.rewind': 'Ctrl+F2',
      'sim.run.reload': 'Ctrl+F3',
      // Ctrl+F4 closes the tab in a browser: the Shift form is the one that works (1.4 note 25).
      'sim.run.logStart': 'Shift+F4',
      'sim.run.logStop': 'Ctrl+F5',
    });
    expect(shortcuts('windows', true)['sim.run.logStart']).toBe('Ctrl+F4');
    expect(shortcuts('mac', false)).toMatchObject({
      'sim.file.open': 'Cmd+O',
      'sim.run.runToCursor': 'Ctrl+F9',
      'sim.run.rewind': 'Shift+F2',
      'sim.run.reload': 'Shift+F3',
      'sim.run.logStart': 'Shift+F4',
      'sim.run.logStop': 'Shift+F5',
    });
    expect(shortcuts('mac', false)['sim.file.exit']).toBeUndefined();
    expect(shortcuts('mac', true)['sim.file.exit']).toBe('Cmd+Q');
  });

  it('writes macOS shortcuts as section 1.3 does', () => {
    const state = initialAppState(defaultSettings());
    const mac = { os: 'mac' as const, desktop: false, state };
    expect(shortcutText('ed.edit.redo', mac)).toBe('Shift+Cmd+Z');
    expect(shortcutText('ed.edit.comment', mac)).toBe('Cmd+/');
    expect(shortcutText('ed.edit.uncomment', mac)).toBe('Shift+Cmd+/');
    expect(shortcutText('ed.edit.replace', mac)).toBe('Ctrl+R');
    expect(shortcutText('ed.file.saveAs', mac)).toBe('Shift+Cmd+S');
    expect(shortcutText('ed.file.close', mac)).toBeNull();
    expect(shortcutText('ed.file.close', { ...mac, desktop: true })).toBe('Cmd+W');
    expect(shortcutText('sim.output.fullscreen', mac)).toBe('Option+Return');
    expect(shortcutText('sim.output.releaseKeyboard', mac)).toBe('Ctrl+Option+O');
    expect(shortcutText('ed.edit.redo', { ...mac, os: 'windows' })).toBe('Ctrl+Alt+Z');
    // The Help item shows no shortcut, as in the original menu (editor-ui §2.6).
    expect(shortcutText('ed.help.help', mac)).toBeNull();
    expect(displayChord('ed.help.context', mac)).toBe('F1');
  });

  it('shows no shortcut for the eleven commands while task 24 has removed them (sim-ui §3.5)', () => {
    const state = initialAppState(defaultSettings());
    const off: AppState = { ...state, sim: { ...state.sim, keyCommands: false } };
    const shown = resolveMenus('simulator', env({ state: off }))
      .flatMap((menu) => items(menu.items))
      .filter((item) => item.shortcut !== null)
      .map((item) => [item.id, item.shortcut]);
    expect(shown).toEqual([
      ['sim.search.find', 'Ctrl+F'],
      ['sim.search.gotoPC', 'Ctrl+G'],
    ]);
    // The editor's shortcuts are not touched.
    expect(shortcutText('ed.project.assemble', { os: 'windows', desktop: false, state: off })).toBe('F9');
  });

  it('lists the open documents in the Window menu, a mark on the active one', () => {
    const state = initialAppState(defaultSettings());
    const windowMenu = (current: AppState) =>
      resolveMenus('editor', env({ state: current, enabled: (id) => id === 'ed.window.select' })).find(
        (menu) => menu.id === 'editor.window',
      )?.items ?? [];

    // No document: the five commands, then the stage's additions below one separator (ARCHITECTURE-PLUS
    // P3.1.4; the document list's own separator is not drawn twice).
    expect(windowMenu(state).map((node) => node.type)).toEqual([
      ...new Array(5).fill('item'),
      'separator',
      ...new Array(4).fill('item'),
      'separator',
      'item',
      'item',
    ]);

    const documents = [
      document('a', 'prog.X68'),
      document('b', 'R&D notes.X68'),
      ...Array.from({ length: 8 }, (_, i) => document(`x${i}`, `f${i}.X68`)),
    ];
    const open: AppState = { ...state, documents: { items: documents, activeId: 'b' } };
    const nodes = windowMenu(open);
    expect(nodes[5]).toEqual({ type: 'separator' });
    const list = nodes.slice(6, 16) as ResolvedItem[];
    // The stage's additions follow the document list, below a separator (ARCHITECTURE-PLUS P3.1.4).
    expect(nodes[16]).toEqual({ type: 'separator' });
    expect(nodes.slice(17).map((node) => (node.type === 'item' ? node.id : node.type))).toEqual([
      'app.layout.move',
      'ed.window.splitRight',
      'ed.window.splitDown',
      'ed.window.unsplit',
      'separator',
      'app.layout.lock',
      'app.layout.reset',
    ]);
    expect(list.map((item) => item.caption).slice(0, 3)).toEqual(['&1 prog.X68', '&2 R&&D notes.X68', '&3 f0.X68']);
    // Windows gives an access key to the first nine only.
    expect(list[9]?.caption).toBe('10 f7.X68');
    expect(list.map((item) => item.arg)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(list.map((item) => item.checked)).toEqual([false, true, ...new Array(8).fill(false)]);
    expect(list.every((item) => item.id === 'ed.window.select' && item.kind === 'radio' && item.enabled)).toBe(true);
  });

  it('never starts or ends a menu with a separator, and never draws two in a row', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      for (const menu of resolveMenus(mode, env())) {
        const types = menu.items.map((node) => node.type);
        expect(types[0], menu.id).not.toBe('separator');
        expect(types[types.length - 1], menu.id).not.toBe('separator');
        types.forEach((type, index) => {
          if (type === 'separator') expect(types[index + 1], menu.id).not.toBe('separator');
        });
      }
    }
  });
});

/* ---- the stage of additions (ARCHITECTURE-PLUS P1.1 rule 3, P3.6) ---- */

/** Where each command of the stage is, by menu id (P3.6). */
const PLUS_PLACES: Record<string, string[]> = {
  'editor.file': ['ed.file.history', 'app.files.trash'],
  'editor.options': ['app.additions.options'],
  'editor.window': [
    'app.layout.move',
    'ed.window.splitRight',
    'ed.window.splitDown',
    'ed.window.unsplit',
    'app.layout.lock',
    'app.layout.reset',
  ],
  'simulator.view': ['app.layout.move', 'app.layout.lock', 'app.layout.reset'],
  'simulator.options': ['app.additions.options'],
};
const PLUS_IDS = new Set(Object.values(PLUS_PLACES).flat());

/**
 * Version 1.1 (ARCHITECTURE-PLUS P9.4, P9.5): the Simulator's View menu ends with a separator and
 * the submenu `Layouts`, after the stage's items. These tests of the stage pass over it; its own
 * tests are below.
 */
const LAYOUTS_CAPTION = 'Layou&ts';
const LAYOUT_IDS = [
  'sim.view.layout.classic',
  'sim.view.layout.wideOutput',
  'sim.view.layout.sideBySide',
  'sim.view.layout.floatingTools',
];
const isLayoutsSubmenu = (node: ResolvedNode) => node.type === 'submenu' && node.caption === LAYOUTS_CAPTION;
/** The menu's items without the addition of version 1.1 (and the separator before it). */
const withoutLayouts = (nodes: ResolvedNode[]): ResolvedNode[] => {
  const at = nodes.findIndex(isLayoutsSubmenu);
  return at < 0 ? nodes : nodes.slice(0, at > 0 && nodes[at - 1]?.type === 'separator' ? at - 1 : at);
};

/**
 * The original captions of every menu, with `&` before the access key and `---` for a separator, as
 * on main before the stage (Windows key map, no document open). The Window menu's document list
 * is checked separately.
 */
const ORIGINAL_CAPTIONS: Record<string, string> = {
  'editor.file':
    '&New X68 Source File|&Open File...|---|&Save|Save &As...|---|&Print|Printer Setup...|---|C&lose File|---|E&xit',
  'editor.edit':
    '&Undo|&Redo|---|Cu&t|&Copy|&Paste|Select &All|---|C&omment Selection|Unco&mment Selection|---|&Find...|Find &Next|Find And &Replace...',
  'editor.project': '&Assemble Source...',
  'editor.options': '&Assembler Options...|---|&Editor Options...|---|Import/Export Settings...',
  'editor.window': '&Arrange|&Cascade|Tile &Horizontally|&Tile Vertically|&Minimize All',
  'editor.help': 'Hel&p|---|&About|---|Examples...|Differences from EASy68K',
  'simulator.file': '&Open...|Open &Data...|---|&Close|---|&Printer Setup...|---|E&xit',
  'simulator.search': '&Find...|---|&Go to PC',
  'simulator.run':
    '&Run|---|Run To &Cursor|&Auto Trace|&Step Over|&Trace Into|&Pause|---|R&ewind Program|Re&load Program|---|L&og Start|Lo&g Stop',
  'simulator.view': '&Output Window|&Memory|&Stack|&Hardware|&Break Points|&EASyBIN|---|&Log',
  'simulator.options':
    'Source Window Font...|Output Window Font...|Printer Font...|---|&Log Output...|---|&Enable Exceptions|---|&Auto Trace Options...|---|&Fullscreen Options...|---|Enable &Bit Field Instructions|---|Output Window &Size >|Output Window Text &Wrap|---|Import/Export Settings...|Execution Speed...|---|Serial &Ports...',
  'simulator.help': '&Sim68K Help|&About Sim68K|---|Examples...|Differences from EASy68K',
  'easybin.file': '&New|---|&Open S-Record...|Open &Binary...|---|Save S-&Record...|&Save Binary...|---|E&xit',
  'easybin.help': '&EASyBIN Help|&About EASyBIN|---|Examples...|Differences from EASy68K',
};

const accessKeyOf = (caption: string) => /&([^&])/.exec(caption.replaceAll('&&', ''))?.[1]?.toLowerCase() ?? null;

describe('the stage of additions in the menus (ARCHITECTURE-PLUS P1.1 rule 3, P3.6)', () => {
  const withDocuments = (): AppState => {
    const state = initialAppState(defaultSettings());
    return { ...state, documents: { items: [document('a', 'prog.X68'), document('b', 'lab.X68')], activeId: 'a' } };
  };
  const cases = (['windows', 'mac'] as const).flatMap((os) =>
    [false, true].flatMap((desktop) =>
      [false, true].map((documents) => ({
        os,
        desktop,
        documents,
        label: `${os}, ${desktop ? 'desktop' : 'web'}, ${documents ? 'documents' : 'none'}`,
      })),
    ),
  );

  it.each(cases)(
    'every original caption and access key is unchanged and in its place ($label)',
    ({ os, desktop, documents }) => {
      const state = documents ? withDocuments() : initialAppState(defaultSettings());
      for (const mode of ['editor', 'simulator', 'easybin'] as const) {
        for (const menu of resolveMenus(mode, env({ os, desktop, state }))) {
          const original = withoutLayouts(menu.items).filter(
            (node) =>
              !(node.type === 'item' && PLUS_IDS.has(node.id)) &&
              !(node.type === 'item' && node.id === 'ed.window.select'),
          );
          const text = original
            .map((node) =>
              node.type === 'separator' ? '---' : node.type === 'submenu' ? `${node.caption} >` : node.caption,
            )
            .join('|')
            .replace(/(\|---)+$/, '') // the separators that led to the additions
            .replace(/\|---\|---/g, '|---'); // the document list's separator next to the additions'
          expect(text, menu.id).toBe(ORIGINAL_CAPTIONS[menu.id]);
        }
      }
    },
  );

  it.each(cases)(
    'the additions are at the places of P3.6, after the original items ($label)',
    ({ os, desktop, documents }) => {
      const state = documents ? withDocuments() : initialAppState(defaultSettings());
      for (const mode of ['editor', 'simulator'] as const) {
        for (const menu of resolveMenus(mode, env({ os, desktop, state }))) {
          const ids = withoutLayouts(menu.items).map((node) => (node.type === 'item' ? node.id : node.type));
          const plus = ids.filter((id) => PLUS_IDS.has(id));
          expect(plus, menu.id).toEqual(PLUS_PLACES[menu.id] ?? []);
          if (plus.length === 0) continue;
          const first = ids.indexOf(plus[0] as string);
          // a separator before the first addition, and nothing original after it
          expect(ids[first - 1], menu.id).toBe('separator');
          expect(
            ids.slice(first).every((id) => id === 'separator' || PLUS_IDS.has(id)),
            menu.id,
          ).toBe(true);
          // the Window menu's document list stays directly after Minimize All
          if (menu.id === 'editor.window' && documents) {
            expect(ids.slice(4, 9)).toEqual([
              'ed.window.minimizeAll',
              'separator',
              'ed.window.select',
              'ed.window.select',
              'separator',
            ]);
          }
        }
      }
      expect(
        withoutLayouts(
          resolveMenus('simulator', env({ os, desktop, state })).find((m) => m.id === 'simulator.view')!.items,
        ).at(-1),
      ).toMatchObject({
        id: 'app.layout.reset',
        caption: 'Reset La&yout',
      });
    },
  );

  it('no item added by this stage shares its access key with another item of its menu', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      for (const documents of [false, true]) {
        const state = documents ? withDocuments() : initialAppState(defaultSettings());
        for (const menu of resolveMenus(mode, env({ state }))) {
          const entries = menu.items.flatMap((node) =>
            node.type === 'item'
              ? [{ id: node.id, key: accessKeyOf(node.caption) }]
              : node.type === 'submenu'
                ? [{ id: node.caption, key: accessKeyOf(node.caption) }]
                : [],
          );
          for (const entry of entries) {
            if (!PLUS_IDS.has(entry.id)) continue;
            expect(entry.key, `${menu.id} ${entry.id} has an access key`).not.toBeNull();
            const clashes = entries
              .filter((other) => other !== entry && other.key === entry.key)
              .map((other) => other.id);
            expect(clashes, `${menu.id} ${entry.id} (${entry.key})`).toEqual([]);
          }
        }
      }
    }
  });

  it('the additions have no shortcut on either key map, in a browser or the desktop app', () => {
    for (const os of ['windows', 'linux', 'mac'] as const) {
      for (const desktop of [false, true]) {
        for (const mode of ['editor', 'simulator'] as const) {
          for (const item of resolveMenus(mode, env({ os, desktop })).flatMap((menu) => items(menu.items))) {
            if (PLUS_IDS.has(item.id)) expect(item.shortcut, `${os} ${item.id}`).toBeNull();
          }
        }
      }
    }
  });

  it('the native menu shows them in the same places, without an accelerator', () => {
    const flatten = (menu: NativeMenuItem[]): NativeMenuItem[] =>
      menu.flatMap((item) => [item, ...flatten(item.items ?? [])]);
    for (const os of ['mac', 'windows'] as const) {
      for (const mode of ['editor', 'simulator'] as const) {
        const native = buildNativeMenu(mode, { ...env({ os, desktop: true }), modalOpen: false });
        const plus = flatten(native).filter((item) => item.id !== undefined && PLUS_IDS.has(item.id));
        expect(plus.length, `${os} ${mode}`).toBe(mode === 'editor' ? 9 : 4);
        for (const item of plus) expect(item.accelerator, `${os} ${item.id}`).toBeUndefined();
        const lock = plus.find((item) => item.id === 'app.layout.lock');
        expect(lock?.type).toBe('checkbox');
      }
    }
    const view = buildNativeMenu('simulator', { ...env({ os: 'mac', desktop: true }), modalOpen: false }).find(
      (menu) => menu.label === 'View',
    );
    expect(view?.items?.map((item) => item.label ?? item.type).slice(-7)).toEqual([
      'Log',
      'separator',
      'Move Panel To...',
      'Lock Layout',
      'Reset Layout',
      // version 1.1 (ARCHITECTURE-PLUS P9.4)
      'separator',
      'Layouts',
    ]);
  });

  it("version 1.1: View > Layouts ends the Simulator's View menu, after a separator (P9.4, P9.5)", () => {
    for (const os of ['windows', 'linux', 'mac'] as const) {
      for (const desktop of [false, true]) {
        const view = resolveMenus('simulator', env({ os, desktop })).find((menu) => menu.id === 'simulator.view')!;
        const last = view.items.at(-1);
        expect(view.items.at(-2)).toEqual({ type: 'separator' });
        expect(last?.type === 'submenu' && last.caption).toBe(LAYOUTS_CAPTION);
        const entries = last?.type === 'submenu' ? (last.items as ResolvedItem[]) : [];
        expect(entries.map((item) => [item.id, item.caption, item.shortcut, item.kind])).toEqual([
          ['sim.view.layout.classic', '&Classic', null, 'action'],
          ['sim.view.layout.wideOutput', '&Wide Output', null, 'action'],
          ['sim.view.layout.sideBySide', '&Output and Hardware Side by Side', null, 'action'],
          ['sim.view.layout.floatingTools', '&Floating Tools', null, 'action'],
        ]);
        // No access key collides inside the submenu, nor the submenu's with the View menu's items.
        const keys = entries.map((item) => accessKeyOf(item.caption));
        expect(new Set(keys).size).toBe(4);
        const viewKeys = view.items.flatMap((node) =>
          node.type === 'item'
            ? [accessKeyOf(node.caption)]
            : node.type === 'submenu'
              ? [accessKeyOf(node.caption)]
              : [],
        );
        expect(viewKeys.filter((key) => key === accessKeyOf(LAYOUTS_CAPTION))).toHaveLength(1);
      }
    }
    // The Editor and EASyBIN have no Layouts.
    for (const mode of ['editor', 'easybin'] as const) {
      const all = resolveMenus(mode, env()).flatMap((menu) => items(menu.items));
      expect(all.filter((item) => LAYOUT_IDS.includes(item.id))).toEqual([]);
    }
    // The native menu of the desktop app: the same submenu, no accelerator.
    const native = buildNativeMenu('simulator', { ...env({ os: 'mac', desktop: true }), modalOpen: false });
    const layouts = native.find((menu) => menu.label === 'View')?.items?.at(-1);
    expect(layouts?.label).toBe('Layouts');
    expect(layouts?.items?.map((item) => [item.id, item.accelerator])).toEqual(LAYOUT_IDS.map((id) => [id, undefined]));
  });

  it('every command of the stage is disabled while it has no handler', () => {
    for (const mode of ['editor', 'simulator'] as const) {
      for (const item of resolveMenus(mode, env()).flatMap((menu) => items(menu.items))) {
        if (PLUS_IDS.has(item.id)) expect(item.enabled, item.id).toBe(false);
      }
    }
  });
});

describe('resolveToolbar', () => {
  it("appends the platform's shortcut to the hint (1.3.2)", () => {
    const labels = (os: Os) =>
      resolveToolbar('editor', env({ os })).flatMap((item) => (item.type === 'button' ? [item.label] : []));
    expect(labels('windows')).toEqual([
      'Files',
      'New X68 Source File',
      'Open File (Ctrl+O)',
      'Save File (Ctrl+S)',
      'Print (Ctrl+P)',
      'Find (Ctrl+F)',
      'Cut (Ctrl+X)',
      'Copy (Ctrl+C)',
      'Paste (Ctrl+V)',
      'Undo (Ctrl+Z)',
      'Redo (Ctrl+Alt+Z)',
      'Comment Selection (Ctrl+Alt+C)',
      'Uncomment Selection (Ctrl+Alt+U)',
      'Assemble Source (F9)',
      // version 1.1 (ARCHITECTURE-PLUS P9.3): the addition at the end, after a separator
      'Arrange Panels',
    ]);
    expect(labels('mac')).toEqual([
      'Files',
      'New X68 Source File',
      'Open File (Cmd+O)',
      'Save File (Cmd+S)',
      'Print (Cmd+P)',
      'Find (Cmd+F)',
      'Cut (Cmd+X)',
      'Copy (Cmd+C)',
      'Paste (Cmd+V)',
      'Undo (Cmd+Z)',
      'Redo (Shift+Cmd+Z)',
      'Comment Selection (Cmd+/)',
      'Uncomment Selection (Shift+Cmd+/)',
      'Assemble Source (F9)',
      'Arrange Panels',
    ]);
  });

  it("gives the simulator toolbar its hints, with the platform's keys", () => {
    const labels = (os: Os) =>
      resolveToolbar('simulator', env({ os })).flatMap((item) => (item.type === 'button' ? [item.label] : []));
    expect(labels('windows')).toEqual([
      'Open (Ctrl+O)',
      'Run (F9)',
      'Run To Cursor (Ctrl+F9)',
      'Auto Trace (F10)',
      'Step Over (F8)',
      'Trace Into (F7)',
      'Pause (F6)',
      'Rewind Program (Ctrl+F2)',
      'Reload Program (Ctrl+F3)',
      'Log Start (Shift+F4)',
      'Log Stop (Ctrl+F5)',
      // version 1.1 (ARCHITECTURE-PLUS P9.3)
      'Arrange Panels',
    ]);
    expect(labels('mac').slice(7)).toEqual([
      'Rewind Program (Shift+F2)',
      'Reload Program (Shift+F3)',
      'Log Start (Shift+F4)',
      'Log Stop (Shift+F5)',
      'Arrange Panels',
    ]);
  });

  it('disables buttons without a handler and reports toggles as pressed or not', () => {
    const toolbar = resolveToolbar('editor', env({ enabled: (id) => id === 'app.files.toggle', checked: () => true }));
    const buttons = toolbar.flatMap((item) => (item.type === 'button' ? [item] : []));
    expect(buttons.filter((button) => button.enabled).map((button) => button.id)).toEqual(['app.files.toggle']);
    expect(buttons.find((button) => button.id === 'app.files.toggle')?.pressed).toBe(true);
    expect(buttons.find((button) => button.id === 'ed.file.save')?.pressed).toBeNull();
  });

  it('shows the LOGGING label only while a log file is open', () => {
    const state = initialAppState(defaultSettings());
    const label = (current: AppState) =>
      resolveToolbar('simulator', env({ state: current })).find((item) => item.type === 'logging');
    expect(label(state)).toEqual({ type: 'logging', visible: false });
    expect(label({ ...state, sim: { ...state.sim, logging: true } })).toEqual({ type: 'logging', visible: true });
  });

  it('explains the disabled run commands after a halt (1.4 note 22)', () => {
    const state = initialAppState(defaultSettings());
    const halted: AppState = { ...state, sim: { ...state.sim, halted: true, phase: 'idle', menuState: 1 } };
    const enabled = (id: CommandId) =>
      ['sim.file.open', 'sim.run.pause', 'sim.run.rewind', 'sim.run.reload'].includes(id);
    const reasons = Object.fromEntries(
      resolveToolbar('simulator', env({ state: halted, enabled })).flatMap((item) =>
        item.type === 'button' && item.disabledReason !== null ? [[item.id, item.disabledReason]] : [],
      ),
    );
    expect(reasons).toEqual({
      'sim.run.run': HALTED_HINT,
      'sim.run.runToCursor': HALTED_HINT,
      'sim.run.autoTrace': HALTED_HINT,
      'sim.run.stepOver': HALTED_HINT,
      'sim.run.traceInto': HALTED_HINT,
    });
    expect(HALTED_HINT).toBe('Program halted. Rewind or Reload to run it again.');
    // Not halted: the buttons are disabled without that text.
    expect(
      resolveToolbar('simulator', env({ state })).every(
        (item) => item.type !== 'button' || item.disabledReason === null,
      ),
    ).toBe(true);
  });

  // Integration scenario of gate I1 round 2 (docs/integration/wave1.md): the engine's halt flag
  // stays set after Rewind or Open until the next run, so it is still set while that run goes on.
  it('does not say "halted" while the next program runs or waits, nor once the commands are free', () => {
    const state = initialAppState(defaultSettings());
    const enabled = (id: CommandId) => ['sim.file.open', 'sim.run.pause'].includes(id);
    const reasonsIn = (sim: Partial<AppState['sim']>) =>
      resolveToolbar(
        'simulator',
        env({ state: { ...state, sim: { ...state.sim, halted: true, ...sim } }, enabled }),
      ).flatMap((item) => (item.type === 'button' && item.disabledReason !== null ? [item.id] : []));
    for (const phase of ['running', 'waitInput', 'waitDelay', 'waitHost', 'waitAlert', 'loading'] as const) {
      expect(reasonsIn({ phase, menuState: 1 }), phase).toEqual([]);
      expect(reasonsIn({ phase, menuState: 0 }), phase).toEqual([]);
    }
    expect(reasonsIn({ phase: 'idle', menuState: 0 })).toEqual([]);
    expect(reasonsIn({ phase: 'idle', menuState: 1 })).toContain('sim.run.run');
    expect(blockedByHalt({ ...state, sim: { ...state.sim, halted: false, phase: 'idle', menuState: 1 } })).toBe(false);
  });
});

describe('buildNativeMenu (7.6)', () => {
  const labels = (menu: NativeMenuItem[]) => menu.map((item) => item.label);
  const flat = (menu: NativeMenuItem[]): NativeMenuItem[] => menu.flatMap((item) => [item, ...flat(item.items ?? [])]);
  const native = (
    mode: 'editor' | 'simulator' | 'easybin',
    options: Parameters<typeof env>[0] & { modalOpen?: boolean } = {},
  ) =>
    buildNativeMenu(mode, { ...env({ os: 'mac', desktop: true, ...options }), modalOpen: options.modalOpen ?? false });

  it("starts with the application menu and keeps the mode's menus in the original order", () => {
    expect(labels(native('editor'))).toEqual(['EASy68K', 'File', 'Edit', 'Project', 'Options', 'Window', 'Help']);
    // The originals of the other two modes have no Edit menu: a standard one comes before Window.
    expect(labels(native('simulator'))).toEqual([
      'EASy68K',
      'File',
      'Search',
      'Run',
      'View',
      'Options',
      'Edit',
      'Window',
      'Help',
    ]);
    expect(labels(native('easybin'))).toEqual(['EASy68K', 'File', 'Edit', 'Window', 'Help']);
  });

  it('has About, Settings, New Window, Services, Hide and Quit in the application menu', () => {
    const app = native('editor')[0]?.items ?? [];
    expect(app.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'About EASy68K',
      'separator',
      'Settings...',
      'separator',
      'New Window',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'Quit EASy68K',
    ]);
    expect(app.find((item) => item.label === 'Quit EASy68K')).toMatchObject({
      id: 'ed.file.exit',
      accelerator: 'Cmd+Q',
    });
    expect(app.find((item) => item.label === 'New Window')).toMatchObject({
      id: 'app.window.new',
      accelerator: 'Cmd+N',
    });
    expect(app.find((item) => item.label === 'Settings...')).toMatchObject({
      id: 'ed.options.editor',
      accelerator: 'Cmd+,',
    });
    const sim = native('simulator')[0]?.items ?? [];
    expect(sim.find((item) => item.label === 'Quit EASy68K')?.id).toBe('sim.file.exit');
    expect(sim.find((item) => item.label === 'About EASy68K')?.id).toBe('sim.help.about');
    expect(sim.some((item) => item.label === 'Settings...')).toBe(false);
  });

  it('makes Cut, Copy, Paste and Select All role items; Undo and Redo stay commands', () => {
    const edit = native('editor').find((menu) => menu.label === 'Edit')?.items ?? [];
    expect(edit.filter((item) => item.role).map((item) => item.role)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
    expect(edit.find((item) => item.id === 'ed.edit.undo')).toMatchObject({ label: 'Undo', accelerator: 'Cmd+Z' });
    expect(edit.find((item) => item.id === 'ed.edit.redo')?.accelerator).toBe('Shift+Cmd+Z');
    const standard = native('simulator').find((menu) => menu.label === 'Edit')?.items ?? [];
    expect(standard.map((item) => item.role ?? item.type)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
  });

  it('strips the access-key markers on macOS and keeps them elsewhere', () => {
    const file = native('editor').find((menu) => menu.label === 'File')?.items ?? [];
    expect(
      file
        .map((item) => item.label)
        .filter(Boolean)
        .slice(0, 4),
    ).toEqual(['New X68 Source File', 'Open File...', 'Save', 'Save As...']);
    const windows = buildNativeMenu('editor', { ...env({ os: 'windows', desktop: true }), modalOpen: false });
    expect(windows.find((menu) => menu.label === '&File')?.items?.[3]?.label).toBe('&Save');
  });

  it('knows every command of the menus, with check and radio items typed', () => {
    const all = flat(native('simulator', { enabled: () => true, checked: (id) => id === 'sim.options.exceptions' }));
    const ids = new Set(all.map((item) => item.id).filter(Boolean));
    for (const id of COMMAND_IDS.filter((id) => id.startsWith('sim.run.') || id.startsWith('sim.view.')))
      expect(ids).toContain(id);
    expect(all.find((item) => item.id === 'sim.options.exceptions')).toMatchObject({
      type: 'checkbox',
      checked: true,
      enabled: true,
    });
    expect(all.filter((item) => item.id === 'sim.options.size').map((item) => [item.type, item.arg])).toHaveLength(9);
    expect(all.find((item) => item.id === 'sim.run.run')?.accelerator).toBe('F9');
  });

  it('disables every command item while a modal dialog is open and during a load; role items stay', () => {
    const state = initialAppState(defaultSettings());
    const commandsOf = (menu: NativeMenuItem[]) => flat(menu).filter((item) => item.id !== undefined);
    const open = commandsOf(native('editor', { enabled: () => true }));
    expect(open.every((item) => item.enabled === true)).toBe(true);
    const modal = native('editor', { enabled: () => true, modalOpen: true });
    expect(commandsOf(modal).every((item) => item.enabled === false)).toBe(true);
    expect(flat(modal).filter((item) => item.role === 'copy')[0]?.enabled).toBeUndefined();
    const loading = native('simulator', {
      enabled: () => true,
      state: { ...state, sim: { ...state.sim, phase: 'loading' } },
    });
    expect(commandsOf(loading).every((item) => item.enabled === false)).toBe(true);
  });

  it('shows no shortcut for the eleven while task 24 has switched key commands off', () => {
    const state = initialAppState(defaultSettings());
    const off = native('simulator', { state: { ...state, sim: { ...state.sim, keyCommands: false } } });
    expect(flat(off).find((item) => item.id === 'sim.run.run')?.accelerator).toBeUndefined();
    expect(flat(off).find((item) => item.id === 'sim.search.find')?.accelerator).toBe('Cmd+F');
  });

  it("joins the system's window items to the Editor's own Window menu", () => {
    const state = initialAppState(defaultSettings());
    const withDocument: AppState = { ...state, documents: { items: [document('a', 'prog.X68')], activeId: 'a' } };
    const windowMenu = native('editor', { state: withDocument }).find((menu) => menu.label === 'Window');
    expect(windowMenu?.role).toBe('window');
    expect(windowMenu?.items?.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'Arrange',
      'Cascade',
      'Tile Horizontally',
      'Tile Vertically',
      'Minimize All',
      'separator',
      '1 prog.X68',
      // the stage of additions (ARCHITECTURE-PLUS P3.6: the same places, no accelerator)
      'separator',
      'Move Panel To...',
      'Split Editor Right',
      'Split Editor Down',
      'Close Split',
      'separator',
      'Lock Layout',
      'Reset Layout',
      'separator',
      'minimize',
      'zoom',
    ]);
    expect(windowMenu?.items?.[6]).toMatchObject({ id: 'ed.window.select', arg: 0, type: 'radio', checked: true });
  });
});
