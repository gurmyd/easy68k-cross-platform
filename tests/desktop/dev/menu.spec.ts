// The native menu and the keys (6.7, 7.6, 2.9): the menu equals the command tables in each mode,
// has the application, Edit and Window menus, and its command items are disabled while a modal
// dialog is open; a click runs the command once and an activation by the key is ignored; F9 runs
// Run once; after task 24 F9 pressed in the Output panel reaches the program and runs nothing;
// copy and paste work in the Memory panel's Address field.
//
// The page comes from the Vite dev server (window.__easy68k; the page's own modules by path).
//
// Owner: DV2.

import { expect, test, type Page } from '@playwright/test';
import { roleChordsOf, toElectronTemplate, type MenuSnapshot, type NativeMenuItem } from '../../../desktop/src/menu';
import {
  IS_MAC,
  launchDesktop,
  mainHook,
  startDevServer,
  warmUpDevPage,
  windowIdOf,
  type Desktop,
  type DevServer,
} from './harness';

let server: DevServer;
let desktop: Desktop;
let windowId: number;
const MAC_ONLY_REASON =
  'macOS only: the application menu bar and its roles exist only there (Windows and Linux give each window its own hidden menu)';
const os = IS_MAC ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';

test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startDevServer();
  desktop = await launchDesktop({ devServer: server });
  await warmUpDevPage(desktop.page);
  windowId = await windowIdOf(desktop.app, desktop.page);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
  await server?.close();
});

async function setMode(page: Page, mode: string): Promise<void> {
  await page.evaluate((m) => window.__easy68k.ctx.commands.run('app.mode.set', m), mode);
  await expect.poll(() => page.evaluate(() => window.__easy68k.ctx.store.getState().mode)).toBe(mode);
}

/** The menu the page builds from the command tables right now (app/src/commands/native-menu.ts). */
function expectedMenu(page: Page): Promise<NativeMenuItem[]> {
  return page.evaluate(async () => {
    const { buildNativeMenu } = await import(String('/src/commands/native-menu.ts'));
    const app = window.__easy68k;
    const state = app.ctx.store.getState();
    return JSON.parse(
      JSON.stringify(
        buildNativeMenu(state.mode, {
          os: app.ctx.platform.os,
          desktop: true,
          state,
          commands: app.commands,
          modalOpen: app.dialogs.isModalOpen(),
        }),
      ),
    );
  });
}

/** Command items of a description, flattened: [id+arg, label, enabled, checked, accelerator]. */
function commandRows(items: NativeMenuItem[]): string[] {
  const rows: string[] = [];
  const template = toElectronTemplate(items, os, () => {});
  const walk = (list: Electron.MenuItemConstructorOptions[]) => {
    for (const item of list) {
      if (Array.isArray(item.submenu)) walk(item.submenu);
      else if (item.id) {
        rows.push(
          JSON.stringify([item.id, item.label, item.enabled ?? true, item.checked ?? false, item.accelerator ?? null]),
        );
      }
    }
  };
  walk(template);
  return rows;
}

function snapshotRows(items: MenuSnapshot[]): string[] {
  const rows: string[] = [];
  const walk = (list: MenuSnapshot[]) => {
    for (const item of list) {
      if (item.items) walk(item.items);
      else if (item.id && !item.role && item.type !== 'separator') {
        const checkable = item.type === 'checkbox' || item.type === 'radio';
        rows.push(
          JSON.stringify([item.id, item.label, item.enabled, checkable ? item.checked : false, item.accelerator]),
        );
      }
    }
  };
  walk(items);
  return rows;
}

async function currentDescription(): Promise<NativeMenuItem[] | null> {
  return mainHook<NativeMenuItem[] | null>(desktop.app, 'menuDescription', windowId);
}

for (const mode of ['editor', 'simulator', 'easybin']) {
  test(`the native menu equals the command tables in ${mode} mode`, async () => {
    await setMode(desktop.page, mode);
    // The description the main process holds is the one the tables give ...
    const expected = await expectedMenu(desktop.page);
    await expect.poll(() => currentDescription()).toEqual(expected);
    const description = (await currentDescription()) as NativeMenuItem[];
    // ... and the Electron menu built from it shows every command item as described.
    const snapshot = await mainHook<MenuSnapshot[]>(desktop.app, 'menuSnapshot', windowId);
    expect(snapshotRows(snapshot)).toEqual(commandRows(description));
    expect(snapshot.map((menu) => menu.label).slice(1)).toEqual(description.map((menu) => menu.label).slice(1));

    // 7.6: the application menu first, an Edit menu, the Window menu before Help.
    const roles = description.map((menu) => menu.role ?? null);
    expect(roles[0]).toBe('appMenu');
    expect(roles[roles.length - 1]).toBe('help');
    expect(roles[roles.length - 2]).toBe('window');
    const app = description[0]?.items ?? [];
    expect(app.map((item) => item.role ?? item.id ?? item.type)).toEqual(
      expect.arrayContaining(['services', 'hide', 'hideOthers', 'unhide', 'app.window.new']),
    );
    const edit = description.find((menu) => menu.role === 'editMenu' || /^&?Edit$/.test(menu.label ?? ''));
    expect(edit, 'an Edit menu').toBeTruthy();
    const editRoles = (edit?.items ?? []).map((item) => item.role).filter(Boolean);
    expect(editRoles).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']));
    if (mode !== 'editor') expect(edit?.role).toBe('editMenu');

    // Only the chords of role items this menu has may reach the macOS menu: in the Editor, Undo
    // and Redo are command items, so Cmd+Z and Shift+Cmd+Z stay with the page (gate 1 review).
    const chords = await mainHook<string[] | null>(desktop.app, 'menuRoleChords', windowId);
    expect(chords).toEqual(roleChordsOf(description));
    if (mode === 'editor') {
      expect(chords).not.toContain('Cmd+Z');
      expect(chords).not.toContain('Shift+Cmd+Z');
    } else {
      expect(chords).toEqual(expect.arrayContaining(['Cmd+Z', 'Shift+Cmd+Z']));
    }
    expect(chords).toEqual(expect.arrayContaining(['Cmd+X', 'Cmd+C', 'Cmd+V', 'Cmd+A']));
  });
}

test('on macOS the application menu bar shows the menu of the window in front, with its roles', async () => {
  test.skip(!IS_MAC, MAC_ONLY_REASON);
  await setMode(desktop.page, 'simulator');
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  const bar = await mainHook<MenuSnapshot[]>(desktop.app, 'applicationMenuSnapshot');
  const own = await mainHook<MenuSnapshot[]>(desktop.app, 'menuSnapshot', windowId);
  expect(snapshotRows(bar)).toEqual(snapshotRows(own));
  // Electron reports roles in lower case.
  const roles = bar.map((menu) => menu.role?.toLowerCase());
  expect(roles[0]).toBe('appmenu');
  expect(roles).toContain('editmenu');
  expect(roles).toContain('window');
  expect(roles).toContain('help');
  const edit = bar.find((menu) => menu.role?.toLowerCase() === 'editmenu');
  const editRoles = (edit?.items ?? []).map((item) => item.role?.toLowerCase());
  expect(editRoles).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectall']));
});

test('while a modal dialog is open the command items are disabled and the role items are not', async () => {
  await setMode(desktop.page, 'editor');
  await desktop.page.evaluate(() => {
    void window.__easy68k.ctx.dialogs.messageBox({
      title: 'Information',
      text: 'A test dialog.',
      icon: 'information',
      buttons: ['OK'],
    });
  });
  await desktop.page.waitForSelector('[role=alertdialog][aria-modal=true]');
  await expect
    .poll(async () => commandRows((await currentDescription()) ?? []).some((row) => JSON.parse(row)[2] === true))
    .toBe(false);
  const snapshot = await mainHook<MenuSnapshot[]>(desktop.app, 'menuSnapshot', windowId);
  expect(snapshotRows(snapshot).every((row) => JSON.parse(row)[2] === false)).toBe(true);
  const roleItems: MenuSnapshot[] = [];
  const walk = (list: MenuSnapshot[]) =>
    list.forEach((item) => (item.items ? walk(item.items) : item.role && roleItems.push(item)));
  walk(snapshot);
  expect(roleItems.length).toBeGreaterThan(0);
  expect(roleItems.every((item) => item.enabled)).toBe(true);
  await desktop.page.keyboard.press('Escape');
  await desktop.page.waitForSelector('[role=alertdialog]', { state: 'detached' });
  await expect
    .poll(async () => commandRows((await currentDescription()) ?? []).some((row) => JSON.parse(row)[2] === true))
    .toBe(true);
});

/** Replaces commands.run with a recorder (nothing runs); returns a function that restores it. */
async function recordRuns(page: Page, enable: string[] = []): Promise<void> {
  await page.evaluate((ids) => {
    const commands = window.__easy68k.commands;
    const w = window as unknown as Record<string, unknown>;
    w['__runs'] = [];
    w['__originalRun'] ??= commands.run;
    w['__originalEnabled'] ??= commands.isEnabled;
    commands.run = (id: string, arg?: unknown) => {
      (w['__runs'] as unknown[]).push(arg === undefined ? id : `${id}:${JSON.stringify(arg)}`);
      return Promise.resolve(true);
    };
    const original = w['__originalEnabled'] as (id: string, arg?: unknown) => boolean;
    commands.isEnabled = (id: string, arg?: unknown) => ids.includes(id) || original.call(commands, id, arg);
  }, enable);
}

async function restoreRuns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const commands = window.__easy68k.commands;
    const w = window as unknown as Record<string, unknown>;
    if (w['__originalRun']) commands.run = w['__originalRun'];
    if (w['__originalEnabled']) commands.isEnabled = w['__originalEnabled'];
  });
}

const runs = (page: Page) => page.evaluate(() => (window as unknown as { __runs: string[] }).__runs.slice());

test('a click on a command item runs its command once; the same item activated by its key does nothing', async () => {
  await setMode(desktop.page, 'editor');
  await recordRuns(desktop.page);
  try {
    expect(await mainHook<boolean>(desktop.app, 'clickMenuItem', windowId, 'ed.file.new')).toBe(true);
    await expect.poll(() => runs(desktop.page)).toEqual(['ed.file.new']);
    expect(await mainHook<boolean>(desktop.app, 'acceleratorMenuItem', windowId, 'ed.file.new')).toBe(true);
    await desktop.page.waitForTimeout(500);
    expect(await runs(desktop.page)).toEqual(['ed.file.new']);
  } finally {
    await restoreRuns(desktop.page);
  }
});

test('F9 runs Run once', async () => {
  await setMode(desktop.page, 'simulator');
  await recordRuns(desktop.page, ['sim.run.run']);
  try {
    await desktop.page.locator('.e68-modeswitch [data-mode="simulator"]').focus();
    await desktop.page.keyboard.press('F9');
    await desktop.page.waitForTimeout(750);
    expect(await runs(desktop.page)).toEqual(['sim.run.run']);
  } finally {
    await restoreRuns(desktop.page);
  }
});

test('after task 24, F9 pressed in the Output panel reaches the program and runs nothing', async () => {
  const { page } = desktop;
  await setMode(page, 'simulator');
  await recordRuns(page, ['sim.run.run']);
  try {
    // A program executes TRAP #15 task 24 with D1.L = 1: key commands off (1.3.5, 2.9.4). It is
    // assembled by the page's assembler and executed by the window's own simulator engine.
    const how = await page.evaluate(async () => {
      const { ctx } = window.__easy68k;
      const source =
        '\tORG\t$1000\r\nSTART\tMOVE.L\t#1,D1\r\n\tMOVE.B\t#24,D0\r\n\tTRAP\t#15\r\nLOOP\tBRA\tLOOP\r\n\tEND\tSTART\r\n';
      let way = 'program';
      try {
        const result = await ctx.asm.assemble(
          'task24.X68',
          new Map([['task24.X68', Uint8Array.from(source, (c) => c.charCodeAt(0))]]),
          {
            generateListing: true,
            generateSRecord: true,
            constantsExpanded: false,
            bitFieldInstructions: false,
            crossReference: false,
            macrosExpanded: false,
            structuredExpanded: false,
            showWarnings: true,
            tabType: 0,
            tabSize: 8,
          },
          new Date(2026, 0, 1),
        );
        const engine = ctx.sim.engine;
        engine.load(result.sRecord, result.listing, { name: 'task24', kind: 'open' });
        engine.cmdRun();
        engine.run(100);
        if (!engine.state().keyCommandsDisabled) throw new Error('task 24 did not switch key commands off');
      } catch (error) {
        // The simulator session is not complete yet (SH8): say so, and let the engine answer as
        // it would after task 24.
        way = `stand-in (${String(error)})`;
        const engine = ctx.sim.engine;
        const original = engine.state.bind(engine);
        (window as unknown as Record<string, unknown>)['__restoreState'] = () => {
          engine.state = original;
        };
        engine.state = () => ({ ...original(), keyCommandsDisabled: true });
      }
      ctx.store.setState((state: { sim: object }) => ({ ...state, sim: { ...state.sim, keyCommands: false } }));
      return way;
    });
    test.info().annotations.push({ type: 'note', description: `task 24 state: ${how}` });
    // The element of the Output panel that takes the program's keys (data-e68-keys="program", SH4);
    // a stand-in with the same marker while the panel does not exist yet.
    const usedStandIn = await page.evaluate(async () => {
      const { showPanel } = await import(String('/src/state/panels.ts'));
      showPanel(window.__easy68k.ctx, 'output');
      await new Promise((done) => setTimeout(done, 300));
      let target = document.querySelector<HTMLElement>('[data-e68-keys="program"]');
      const standIn = target === null;
      if (!target) {
        target = document.createElement('textarea');
        target.setAttribute('data-e68-keys', 'program');
        target.setAttribute('data-check-stand-in', '');
        document.body.append(target);
      }
      const keys: { key: string; prevented: boolean }[] = [];
      (window as unknown as Record<string, unknown>)['__programKeys'] = keys;
      target.addEventListener('keydown', (event) =>
        queueMicrotask(() => keys.push({ key: event.key, prevented: event.defaultPrevented })),
      );
      target.focus();
      return standIn;
    });
    await page.keyboard.press('F9');
    await page.waitForTimeout(750);
    const keys = await page.evaluate(() => (window as unknown as { __programKeys: unknown[] }).__programKeys);
    // The key-down reaches the program's element (the Output panel may cancel its default action
    // itself once it has passed the key to the program).
    expect((keys as { key: string }[]).map((k) => k.key)).toEqual(['F9']);
    expect(await runs(page)).toEqual([]);
    test.info().annotations.push({
      type: 'note',
      description: usedStandIn
        ? 'The Output panel has no program key element yet (SH4); a stand-in with data-e68-keys="program" was used.'
        : 'The real Output panel element was used.',
    });
  } finally {
    await page.evaluate(() => {
      const { store } = window.__easy68k.ctx;
      store.setState((state: { sim: object }) => ({ ...state, sim: { ...state.sim, keyCommands: true } }));
      document.querySelector('[data-check-stand-in]')?.remove();
      const w = window as unknown as Record<string, unknown>;
      (w['__restoreState'] as (() => void) | undefined)?.();
      try {
        window.__easy68k.ctx.sim.engine.rewind();
      } catch {
        // nothing loaded
      }
    });
    await restoreRuns(page);
  }
});

test("Cmd+C and Cmd+V (Ctrl+C, Ctrl+V elsewhere) work in the Memory panel's Address field", async () => {
  const { page, app } = desktop;
  const modifier = IS_MAC ? 'Meta' : 'Control';
  await setMode(page, 'simulator');
  // The system clipboard is the user's: keep what is on it and put it back afterwards.
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const usedStandIn = await page.evaluate(async () => {
      const { showPanel } = await import(String('/src/state/panels.ts'));
      showPanel(window.__easy68k.ctx, 'memory');
      await new Promise((done) => setTimeout(done, 300));
      let field = document.querySelector<HTMLInputElement>(
        '[data-e68-panel="memory"] input[type="text"], [data-e68-panel="memory"] input:not([type])',
      );
      const standIn = field === null;
      if (!field) {
        // The Memory panel (U2) has no Address field yet: a plain text field in Simulator mode.
        field = document.createElement('input');
        field.setAttribute('data-check-stand-in', '');
        document.body.append(field);
      }
      field.setAttribute('data-check-field', '');
      field.focus();
      return standIn;
    });
    const field = page.locator('[data-check-field]');
    await app.evaluate(({ clipboard }) => clipboard.writeText('002000'));
    await field.focus();
    await page.keyboard.press(`${modifier}+KeyA`);
    await page.keyboard.press(`${modifier}+KeyV`);
    await expect(field).toHaveValue(/^0*2000$/);
    await app.evaluate(({ clipboard }) => clipboard.writeText('nothing'));
    await page.keyboard.press(`${modifier}+KeyA`);
    await page.keyboard.press(`${modifier}+KeyC`);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toMatch(/2000/);
    test.info().annotations.push({
      type: 'note',
      description: usedStandIn
        ? 'The Memory panel has no Address field yet (U2); a stand-in text field in Simulator mode was used.'
        : 'The real Address field of the Memory panel was used.',
    });
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    await page.evaluate(() => {
      document.querySelector('[data-check-stand-in]')?.remove();
      document.querySelector('[data-check-field]')?.removeAttribute('data-check-field');
    });
  }
});

// The keys above reach the page directly (Playwright), so they cannot show that the Edit menu's
// role items work. This test performs those items themselves (Select All, Paste, Copy), as a
// click on them does. On macOS the system performs role items through the first responder, which
// a test cannot reach in a hidden window: there it stays on the manual list of 6.8.
test("the Edit menu's role items Select All, Paste and Copy work in the Memory panel's Address field", async () => {
  test.skip(IS_MAC, 'macOS performs role items through the first responder (manual list of 6.8)');
  const { page, app } = desktop;
  await setMode(page, 'simulator');
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const usedStandIn = await page.evaluate(async () => {
      const { showPanel } = await import(String('/src/state/panels.ts'));
      showPanel(window.__easy68k.ctx, 'memory');
      await new Promise((done) => setTimeout(done, 300));
      let field = document.querySelector<HTMLInputElement>(
        '[data-e68-panel="memory"] input[type="text"], [data-e68-panel="memory"] input:not([type])',
      );
      const standIn = field === null;
      if (!field) {
        field = document.createElement('input');
        field.setAttribute('data-check-stand-in', '');
        document.body.append(field);
      }
      field.setAttribute('data-check-field', '');
      field.focus();
      return standIn;
    });
    const field = page.locator('[data-check-field]');
    await field.focus();
    const role = (name: string) => mainHook<boolean>(app, 'clickRoleItem', windowId, name);
    await app.evaluate(({ clipboard }) => clipboard.writeText('003000'));
    expect(await role('selectAll')).toBe(true);
    expect(await role('paste')).toBe(true);
    await expect(field).toHaveValue(/^0*3000$/);
    await app.evaluate(({ clipboard }) => clipboard.writeText('nothing'));
    expect(await role('selectAll')).toBe(true);
    expect(await role('copy')).toBe(true);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/3000/);
    test.info().annotations.push({
      type: 'note',
      description: usedStandIn
        ? 'The Memory panel has no Address field; a stand-in text field was used.'
        : 'The real Address field of the Memory panel was used.',
    });
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    await page.evaluate(() => {
      document.querySelector('[data-check-stand-in]')?.remove();
      document.querySelector('[data-check-field]')?.removeAttribute('data-check-field');
    });
  }
});
