// The command tables equal the parity matrix (W3 acceptance, ARCHITECTURE.md 9.1: "menus and
// toolbars equal the tables (snapshot generated from the tables and checked against 1.3 by hand
// once)").
//
// The EXPECTED texts below were typed from sections 1.3.1, 1.3.2, 1.3.4, 1.3.5, 1.3.8 and 1.5 of
// docs/ARCHITECTURE.md and from editor-ui §2-§3 and sim-ui §3.1-§3.2 (captions, order,
// separators). The test renders the tables in the same form and compares. A line reads
//
//   <caption> [kind] | <chords on Windows and Linux> | <chords on macOS>
//
// with the chords in the platform's spelling, the shown one first, and "(desktop only)" after a
// chord that the platform's browsers reserve. A caption alone means: no key on either platform.

import { describe, expect, it } from 'vitest';
import type { Mode } from '../../contracts';
import { formatChord } from '../chords';
import { COMMAND_IDS, isCommandId, type KnownCommandId } from '../ids';
import { menuTables } from '../menus';
import { COMMAND_SPECS, chordsOn, isDesktopOnly } from '../specs';
import {
  ALSO_IGNORED_AFTER_TASK_24,
  DESKTOP_ONLY_ON_WINDOWS_AND_LINUX,
  GUARDED_CHORDS,
  KEYS,
  NOT_SHOWN_IN_MENUS,
  OUTPUT_PANEL_COMMANDS,
  SUPPRESSED_BY_TASK_24,
  TEXT_EDITING_COMMANDS,
} from './keys';
import { OUTPUT_SIZES } from './sim-menu';
import { TOOLBARS } from './toolbars';
import type { MenuNode } from './types';

function chords(id: KnownCommandId, os: 'windows' | 'mac'): string {
  const keys = COMMAND_SPECS[id].keys;
  const list = os === 'mac' ? keys.mac : keys.win;
  return list.length === 0
    ? '-'
    : list.map((chord) => formatChord(chord, os) + (isDesktopOnly(id, chord, os) ? ' (desktop only)' : '')).join(', ');
}

function renderNode(node: MenuNode, indent: string): string[] {
  switch (node.type) {
    case 'separator':
      return [`${indent}---`];
    case 'documents':
      return [`${indent}<documents>`];
    case 'submenu':
      return [`${indent}${node.caption} >`, ...node.items.flatMap((item) => renderNode(item, `${indent}  `))];
    case 'command': {
      const spec = COMMAND_SPECS[node.id];
      const kind = spec.kind === 'action' ? '' : ` [${spec.kind}]`;
      const caption = `${indent}${node.caption ?? spec.caption}${kind}`;
      const win = NOT_SHOWN_IN_MENUS.includes(node.id) ? '-' : chords(node.id, 'windows');
      const mac = NOT_SHOWN_IN_MENUS.includes(node.id) ? '-' : chords(node.id, 'mac');
      return [win === '-' && mac === '-' ? caption : `${caption} | ${win} | ${mac}`];
    }
  }
}

function renderMenus(mode: Mode): string {
  return menuTables(mode)
    .flatMap((menu) => [menu.caption, ...menu.items.flatMap((item) => renderNode(item, '  '))])
    .join('\n');
}

function renderToolbar(mode: Mode): string {
  return TOOLBARS[mode]
    .map((node) => {
      if (node.type === 'separator') return '|';
      if (node.type === 'logging') return 'LOGGING';
      const spec = COMMAND_SPECS[node.id];
      return `${spec.hint ?? '?'} <${spec.icon ?? '?'}>`;
    })
    .join('\n');
}

const trim = (text: string) => text.replace(/^\n/, '').replace(/\n\s*$/, '');

const EDITOR_MENUS = trim(`
&File
  &New X68 Source File
  &Open File... | Ctrl+O | Cmd+O, Ctrl+O
  ---
  &Save | Ctrl+S | Cmd+S, Ctrl+S
  Save &As... | - | Shift+Cmd+S
  ---
  &Print | Ctrl+P | Cmd+P, Ctrl+P
  Printer Setup...
  ---
  C&lose File | - | Cmd+W (desktop only)
  ---
  E&xit | - | Cmd+Q (desktop only)
  ---
  Earlier &Versions...
  Tras&h...
&Edit
  &Undo | Ctrl+Z | Cmd+Z, Ctrl+Z
  &Redo | Ctrl+Alt+Z | Shift+Cmd+Z, Ctrl+Option+Z
  ---
  Cu&t | Ctrl+X | Cmd+X, Ctrl+X
  &Copy | Ctrl+C | Cmd+C, Ctrl+C
  &Paste | Ctrl+V, Shift+Insert | Cmd+V, Ctrl+V
  Select &All | Ctrl+A | Cmd+A, Ctrl+A
  ---
  C&omment Selection | Ctrl+Alt+C | Cmd+/, Ctrl+Option+C
  Unco&mment Selection | Ctrl+Alt+U | Shift+Cmd+/, Ctrl+Option+U
  ---
  &Find... | Ctrl+F | Cmd+F, Ctrl+F
  Find &Next | F3 | F3, Cmd+G
  Find And &Replace... | Ctrl+R | Ctrl+R, Cmd+R (desktop only)
&Project
  &Assemble Source... | F9 | F9, Cmd+B
&Options
  &Assembler Options...
  ---
  &Editor Options... | - | Cmd+, (desktop only)
  ---
  Import/Export Settings...
  ---
  Port Ad&ditions...
&Window
  &Arrange
  &Cascade
  Tile &Horizontally
  &Tile Vertically
  &Minimize All
  <documents>
  ---
  Mo&ve Panel To...
  Split Editor &Right
  Split Editor &Down
  Close &Split
  ---
  Loc&k Layout [check]
  R&eset Layout
&Help
  Hel&p
  ---
  &About
  ---
  Examples...
  Differences from EASy68K
`);

const SIM_MENUS = trim(`
&File
  &Open... | Ctrl+O | Cmd+O, Ctrl+O
  Open &Data...
  ---
  &Close
  ---
  &Printer Setup...
  ---
  E&xit | - | Cmd+Q (desktop only)
&Search
  &Find... | Ctrl+F | Cmd+F, Ctrl+F
  ---
  &Go to PC | Ctrl+G | Cmd+G, Ctrl+G
&Run
  &Run | F9 | F9
  ---
  Run To &Cursor | Ctrl+F9, Shift+F9 | Ctrl+F9, Shift+F9
  &Auto Trace | F10 | F10
  &Step Over | F8 | F8
  &Trace Into | F7 | F7
  &Pause | F6 | F6
  ---
  R&ewind Program | Ctrl+F2, Shift+F2 | Shift+F2, Ctrl+F2
  Re&load Program | Ctrl+F3, Shift+F3 | Shift+F3, Ctrl+F3
  ---
  L&og Start | Ctrl+F4 (desktop only), Shift+F4 | Shift+F4, Ctrl+F4
  Lo&g Stop | Ctrl+F5, Shift+F5 | Shift+F5, Ctrl+F5
&View
  &Output Window
  &Memory
  &Stack
  &Hardware
  &Break Points
  &EASyBIN
  ---
  &Log
  ---
  Mo&ve Panel To...
  Loc&k Layout [check]
  Reset La&yout
&Options
  Source Window Font...
  Output Window Font...
  Printer Font...
  ---
  &Log Output...
  ---
  &Enable Exceptions [check]
  ---
  &Auto Trace Options...
  ---
  &Fullscreen Options...
  ---
  Enable &Bit Field Instructions [check]
  ---
  Output Window &Size >
    640x480 [radio]
    800x600 [radio]
    1024x768 [radio]
    1280x800 [radio]
    1280x1024 [radio]
    1440x900 [radio]
    1680x1050 [radio]
    1920x1080 [radio]
    1920x1200 [radio]
  Output Window Text &Wrap [check]
  ---
  Import/Export Settings...
  Execution Speed...
  ---
  Port Ad&ditions...
&Help
  &Sim68K Help
  &About Sim68K
  ---
  Examples...
  Differences from EASy68K
`);

const EASYBIN_MENUS = trim(`
&File
  &New
  ---
  &Open S-Record... | Ctrl+O | Cmd+O, Ctrl+O
  Open &Binary... | Ctrl+B | Cmd+B, Ctrl+B
  ---
  Save S-&Record... | Ctrl+R | Ctrl+R
  &Save Binary... | Ctrl+S | Cmd+S, Ctrl+S
  ---
  E&xit
&Help
  &EASyBIN Help
  &About EASyBIN
  ---
  Examples...
  Differences from EASy68K
`);

// editor-ui §3: 13 buttons, 6 separators, in this order; the Files button is the port's (1.5).
const EDITOR_TOOLBAR = trim(`
Files <folder>
|
New X68 Source File <file-new>
|
Open File <file-open>
Save File <file-save>
Print <print>
|
Find <find>
|
Cut <cut>
Copy <copy>
Paste <paste>
|
Undo <undo>
Redo <redo>
|
Comment Selection <comment>
Uncomment Selection <uncomment>
|
Assemble Source <assemble>
`);

// sim-ui §3.2.
const SIM_TOOLBAR = trim(`
Open <file-open>
|
Run <run>
|
Run To Cursor <run-to-cursor>
Auto Trace <auto-trace>
Step Over <step-over>
Trace Into <trace-into>
Pause <pause>
|
Rewind Program <rewind>
|
Reload Program <reload>
|
Log Start <log-start>
Log Stop <log-stop>
LOGGING
`);

describe('menus equal section 1.3', () => {
  it('Editor (1.3.1; editor-ui §2)', () => {
    expect(renderMenus('editor')).toBe(EDITOR_MENUS);
  });
  it('Simulator (1.3.4; sim-ui §3.1)', () => {
    expect(renderMenus('simulator')).toBe(SIM_MENUS);
  });
  it('EASyBIN (1.3.8; the original form)', () => {
    expect(renderMenus('easybin')).toBe(EASYBIN_MENUS);
  });
  it('the nine output sizes of sim-ui §3.1, in order', () => {
    expect(OUTPUT_SIZES.map(({ width, height }) => `${width}x${height}`)).toEqual([
      '640x480',
      '800x600',
      '1024x768',
      '1280x800',
      '1280x1024',
      '1440x900',
      '1680x1050',
      '1920x1080',
      '1920x1200',
    ]);
  });
});

/** The commands the stage of additions puts into the menus (ARCHITECTURE-PLUS P3.6). */
const PLUS_COMMANDS: ReadonlySet<string> = new Set([
  'app.layout.move',
  'app.layout.lock',
  'app.layout.reset',
  'ed.window.splitRight',
  'ed.window.splitDown',
  'ed.window.unsplit',
  'ed.file.history',
  'app.files.trash',
  'app.additions.options',
]);

/** The number of nodes of each menu before the stage of additions (the tables of 1.0). */
const ORIGINAL_NODES: Record<string, number> = {
  'editor.file': 12,
  'editor.edit': 14,
  'editor.project': 1,
  'editor.options': 5,
  'editor.window': 6,
  'editor.help': 6,
  'simulator.file': 8,
  'simulator.search': 3,
  'simulator.run': 13,
  'simulator.view': 8,
  'simulator.options': 19,
  'simulator.help': 5,
  'easybin.file': 9,
  'easybin.help': 5,
};

describe('the stage of additions keeps the original menus (ARCHITECTURE-PLUS P1.1 rule 3, P3.1.4)', () => {
  it('the original items and the document list keep their indexes; additions follow below a separator', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      for (const menu of menuTables(mode)) {
        const original = ORIGINAL_NODES[menu.id];
        expect(original, menu.id).toBeDefined();
        const before = menu.items.slice(0, original);
        const added = menu.items.slice(original);
        // Nothing of the stage before the end of the original items.
        expect(
          before.filter((node) => node.type === 'command' && PLUS_COMMANDS.has(node.id)),
          menu.id,
        ).toEqual([]);
        if (added.length === 0) continue;
        // After them: a separator, then only additions and separators.
        expect(added[0], menu.id).toEqual({ type: 'separator' });
        for (const node of added) {
          expect(node.type === 'separator' || (node.type === 'command' && PLUS_COMMANDS.has(node.id)), menu.id).toBe(
            true,
          );
        }
      }
    }
    const windowMenu = menuTables('editor').find((menu) => menu.id === 'editor.window')?.items ?? [];
    expect(windowMenu.findIndex((node) => node.type === 'documents')).toBe(5);
    expect(windowMenu.slice(0, 5).map((node) => (node.type === 'command' ? node.id : node.type))).toEqual([
      'ed.window.arrange',
      'ed.window.cascade',
      'ed.window.tileH',
      'ed.window.tileV',
      'ed.window.minimizeAll',
    ]);
  });

  it('every command of the stage is in a menu and has no key (P1.3)', () => {
    const inMenus = new Set<string>();
    const collect = (nodes: readonly MenuNode[]) => {
      for (const node of nodes) {
        if (node.type === 'command') inMenus.add(node.id);
        if (node.type === 'submenu') collect(node.items);
      }
    };
    for (const mode of ['editor', 'simulator', 'easybin'] as const)
      for (const menu of menuTables(mode)) collect(menu.items);
    for (const id of PLUS_COMMANDS) {
      expect(inMenus.has(id), id).toBe(true);
      expect(id in KEYS, id).toBe(false);
      expect(COMMAND_SPECS[id as KnownCommandId].keys, id).toEqual({ win: [], mac: [] });
    }
  });
});

describe('toolbars equal sections 1.3.2 and 1.3.5', () => {
  it('Editor: the 13 original buttons with 6 separators, after the Files button', () => {
    expect(renderToolbar('editor')).toBe(EDITOR_TOOLBAR);
    const original = TOOLBARS.editor.slice(2);
    expect(original.filter((node) => node.type === 'command')).toHaveLength(13);
    expect(original.filter((node) => node.type === 'separator')).toHaveLength(6);
  });
  it('Simulator: 11 buttons and the LOGGING label', () => {
    expect(renderToolbar('simulator')).toBe(SIM_TOOLBAR);
    expect(TOOLBARS.simulator.filter((node) => node.type === 'command')).toHaveLength(11);
  });
  it('EASyBIN has no toolbar', () => {
    expect(TOOLBARS.easybin).toEqual([]);
  });
});

/** The key-only rows of 1.3.2, 1.3.5, 1.3.6 and 1.5, typed from the matrix. */
const KEY_ONLY: Record<string, [win: string, mac: string]> = {
  'ed.help.context': ['F1', 'F1'],
  'ed.help.help': ['F1', 'F1'],
  'ed.edit.toggleInsert': ['Insert', 'Ctrl+Shift+I'],
  'ed.edit.indent': ['Ctrl+Shift+.', 'Ctrl+Shift+.'],
  'ed.edit.outdent': ['Ctrl+Shift+,', 'Ctrl+Shift+,'],
  'sim.help.context': ['F1', 'F1'],
  'sim.panel.next': ['F2, Ctrl+Tab (desktop only)', 'F2, Ctrl+Tab (desktop only)'],
  'sim.output.fullscreen': ['Alt+Enter', 'Option+Return'],
  'sim.output.paste': ['Shift+Insert', 'Cmd+V'],
  'sim.output.releaseKeyboard': ['Ctrl+Alt+O', 'Ctrl+Option+O'],
  'app.mode.next': ['F4', 'F4'],
  'app.window.new': ['-', 'Cmd+N (desktop only)'],
};

describe('the chord table (2.9.2)', () => {
  it('has the key-only rows of the matrix', () => {
    for (const [id, [win, mac]] of Object.entries(KEY_ONLY)) {
      expect([id, chords(id as KnownCommandId, 'windows'), chords(id as KnownCommandId, 'mac')]).toEqual([
        id,
        win,
        mac,
      ]);
    }
  });

  it('binds no command beyond the matrix', () => {
    const inMenus = new Set<string>();
    const collect = (nodes: readonly MenuNode[]) => {
      for (const node of nodes) {
        if (node.type === 'command') inMenus.add(node.id);
        if (node.type === 'submenu') collect(node.items);
      }
    };
    for (const mode of ['editor', 'simulator', 'easybin'] as const)
      for (const menu of menuTables(mode)) collect(menu.items);
    const withKeys = Object.keys(KEYS).filter((id) => !inMenus.has(id));
    // `ed.help.help` is in the Help menu; its F1 is the "F1 on the frame" row of 1.3.2.
    const keyOnly = Object.keys(KEY_ONLY).filter((id) => id !== 'ed.help.help');
    expect(withKeys.sort()).toEqual(keyOnly.sort());
  });

  it('K2: on macOS every Ctrl+letter shortcut works with Cmd (shown first) and with Ctrl, except Ctrl+R', () => {
    for (const id of COMMAND_IDS) {
      const { win, mac } = COMMAND_SPECS[id].keys;
      for (const chord of win) {
        const letter = /^Ctrl\+([A-Z])$/.exec(chord)?.[1];
        if (!letter) continue;
        if (letter === 'R') {
          expect(mac[0], id).toBe('Ctrl+R');
        } else {
          expect(mac.slice(0, 2), id).toEqual([`Cmd+${letter}`, `Ctrl+${letter}`]);
        }
      }
    }
  });

  it('K3: every Ctrl+F<n> has a Shift+F<n> alternative that is not active in the Output panel', () => {
    for (const id of COMMAND_IDS) {
      const keys = COMMAND_SPECS[id].keys;
      for (const chord of keys.win) {
        const fkey = /^Ctrl\+(F\d+)$/.exec(chord)?.[1];
        if (!fkey) continue;
        expect(keys.win, id).toContain(`Shift+${fkey}`);
        expect(keys.mac, id).toContain(`Shift+${fkey}`);
        expect(keys.notInOutput, id).toContain(`Shift+${fkey}`);
      }
    }
  });

  it('K5: F2 and F4 are additions that do not exist in the Output panel', () => {
    expect(COMMAND_SPECS['sim.panel.next'].keys.notInOutput).toEqual(['F2']);
    expect(COMMAND_SPECS['app.mode.next'].keys.notInOutput).toEqual(['F4']);
  });

  it('K6: on macOS a command with an Option chord also has one without, listed first', () => {
    for (const id of COMMAND_IDS) {
      if (OUTPUT_PANEL_COMMANDS.includes(id)) continue; // the I/O window's own keys, as in the original
      const { mac } = COMMAND_SPECS[id].keys;
      if (mac.some((chord) => chord.includes('Alt+'))) expect(mac[0], id).not.toContain('Alt+');
    }
  });

  it('marks as desktop-only exactly the chords browsers reserve (2.9.3)', () => {
    const reserved = new Set<string>();
    for (const id of COMMAND_IDS) for (const chord of COMMAND_SPECS[id].keys.desktopOnly ?? []) reserved.add(chord);
    expect([...reserved].sort()).toEqual(['Cmd+,', 'Cmd+N', 'Cmd+Q', 'Cmd+R', 'Cmd+W', 'Ctrl+F4', 'Ctrl+Tab']);
  });

  it('lists desktopOnly and notInOutput chords only among the chords of the command', () => {
    for (const id of COMMAND_IDS) {
      const keys = COMMAND_SPECS[id].keys;
      const all = [...keys.win, ...keys.mac];
      for (const chord of [...(keys.desktopOnly ?? []), ...(keys.notInOutput ?? [])]) expect(all, id).toContain(chord);
    }
  });

  it('never uses a chord a browser cannot give up (2.9.3) outside the desktop app', () => {
    const everywhere = ['Ctrl+N', 'Ctrl+T', 'Ctrl+W', 'Cmd+N', 'Cmd+T', 'Cmd+W', 'Cmd+Q', 'Ctrl+Tab', 'F11', 'F12'];
    // Ctrl+F4 closes the tab in the browsers of Windows and Linux; Cmd+R reloads the page on macOS.
    const reserved = {
      windows: [...everywhere, 'Ctrl+F4'],
      linux: [...everywhere, 'Ctrl+F4'],
      mac: [...everywhere, 'Cmd+R'],
    };
    for (const os of ['windows', 'linux', 'mac'] as const) {
      for (const id of COMMAND_IDS) {
        for (const chord of chordsOn(id, os, false)) expect(reserved[os], `${os} ${id}`).not.toContain(chord);
        // The desktop app has every chord of the key map.
        const { win, mac } = COMMAND_SPECS[id].keys;
        expect(chordsOn(id, os, true), `${os} ${id}`).toEqual(os === 'mac' ? mac : win);
      }
    }
  });

  it('Ctrl+F4 is desktop-only on Windows and Linux and an ordinary chord of Log Start on macOS', () => {
    // 2.9.3 reserves it for "Windows, Linux browsers"; on macOS it is one of the system's
    // Ctrl+F<n> shortcuts, like the Ctrl+F2, F3 and F5 of the same menu.
    expect(DESKTOP_ONLY_ON_WINDOWS_AND_LINUX).toEqual(['Ctrl+F4']);
    expect(chordsOn('sim.run.logStart', 'windows', false)).toEqual(['Shift+F4']);
    expect(chordsOn('sim.run.logStart', 'linux', false)).toEqual(['Shift+F4']);
    expect(chordsOn('sim.run.logStart', 'windows', true)).toEqual(['Ctrl+F4', 'Shift+F4']);
    expect(chordsOn('sim.run.logStart', 'mac', false)).toEqual(['Shift+F4', 'Ctrl+F4']);
    expect(chordsOn('sim.run.logStart', 'mac', true)).toEqual(['Shift+F4', 'Ctrl+F4']);
    for (const [id, n] of [
      ['sim.run.rewind', 2],
      ['sim.run.reload', 3],
      ['sim.run.logStart', 4],
      ['sim.run.logStop', 5],
    ] as const) {
      expect(chordsOn(id, 'mac', false), id).toEqual([`Shift+F${n}`, `Ctrl+F${n}`]);
    }
    // Every other desktop-only chord is desktop-only on both key maps.
    for (const id of COMMAND_IDS) {
      for (const chord of COMMAND_SPECS[id].keys.desktopOnly ?? []) {
        if (chord === 'Ctrl+F4') continue;
        for (const os of ['windows', 'linux', 'mac'] as const) expect(isDesktopOnly(id, chord, os), chord).toBe(true);
      }
    }
    expect(isDesktopOnly('sim.run.logStart', 'Shift+F4', 'windows')).toBe(false);
  });

  it('flags the eleven commands of sim-ui §3.5 as suppressed by task 24', () => {
    const flagged = COMMAND_IDS.filter((id) => COMMAND_SPECS[id].suppressedByTask24);
    expect(flagged.sort()).toEqual([...SUPPRESSED_BY_TASK_24].sort());
    expect(flagged).toHaveLength(11);
    expect(flagged).not.toContain('sim.search.find');
    expect(flagged).not.toContain('sim.search.gotoPC');
    expect(ALSO_IGNORED_AFTER_TASK_24).toEqual(['sim.help.context', 'sim.panel.next']);
  });

  it('guards the chords of 2.9.3 on both key maps', () => {
    expect(GUARDED_CHORDS.win).toEqual([
      'F5',
      'F6',
      'F7',
      'F10',
      'Ctrl+O',
      'Ctrl+S',
      'Ctrl+P',
      'Ctrl+F',
      'Ctrl+G',
      'Ctrl+R',
    ]);
    for (const chord of GUARDED_CHORDS.win) expect(GUARDED_CHORDS.mac).toContain(chord);
    expect(GUARDED_CHORDS.mac).not.toContain('Cmd+R');
  });
});

describe('specifications (3.12.2)', () => {
  it('every id has a specification with the mode of its prefix', () => {
    const prefix = { editor: 'ed.', simulator: 'sim.', easybin: 'bin.', app: 'app.' } as const;
    for (const id of COMMAND_IDS) {
      const spec = COMMAND_SPECS[id];
      expect(spec.id).toBe(id);
      expect(id.startsWith(prefix[spec.mode]), id).toBe(true);
      expect(spec.caption, id).not.toBe('');
    }
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length);
  });

  it('every table entry names a known command', () => {
    const check = (nodes: readonly MenuNode[]) => {
      for (const node of nodes) {
        if (node.type === 'command') expect(isCommandId(node.id), node.id).toBe(true);
        if (node.type === 'submenu') check(node.items);
      }
    };
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      for (const menu of menuTables(mode)) check(menu.items);
      for (const node of TOOLBARS[mode]) if (node.type === 'command') expect(isCommandId(node.id)).toBe(true);
    }
    for (const id of Object.keys(KEYS)) expect(isCommandId(id), id).toBe(true);
    for (const id of TEXT_EDITING_COMMANDS) expect(isCommandId(id)).toBe(true);
  });

  it('a menu shows only commands of its own mode or of every mode', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      const check = (nodes: readonly MenuNode[]) => {
        for (const node of nodes) {
          if (node.type === 'command') expect(['app', mode], node.id).toContain(COMMAND_SPECS[node.id].mode);
          if (node.type === 'submenu') check(node.items);
        }
      };
      for (const menu of menuTables(mode)) check(menu.items);
    }
  });

  it('every toolbar button has a hint and an icon', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      for (const node of TOOLBARS[mode]) {
        if (node.type !== 'command') continue;
        expect(COMMAND_SPECS[node.id].hint, node.id).toBeTruthy();
        expect(COMMAND_SPECS[node.id].icon, node.id).toBeTruthy();
      }
    }
  });

  it('holds every chord in normal form', () => {
    for (const id of COMMAND_IDS) {
      const keys = COMMAND_SPECS[id].keys;
      for (const chord of [...keys.win, ...keys.mac]) {
        expect(chord, id).toMatch(/^(Ctrl\+)?(Alt\+)?(Shift\+)?(Cmd\+)?[^+]+$/);
      }
    }
  });
});
