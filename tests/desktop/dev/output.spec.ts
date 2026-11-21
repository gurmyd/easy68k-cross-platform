// The Output panel inside the desktop app (2.5, 2.9.4, 3.6; asked for by SH4): the paste chord
// pastes into a TRAP #15 task 5 loop as the original does (`HELLO` stores `HO`), the command
// sim.output.paste pastes through Platform.pasteIntoFocus (the main process's native paste), and a
// full-screen change made by the system reaches the page (Platform.onFullScreenChange). On macOS
// also Alt+Enter, which takes the window into full screen with Platform.setFullScreen.
//
// The page comes from the Vite dev server (window.__easy68k; the page's own modules by path). The
// program is assembled by the real assembler and run by the window's own simulator through the
// run controller, as File > Open and Run do it.
//
// Owner: DV2.

import { expect, test, type Page } from '@playwright/test';
import {
  enginesAvailable,
  IS_MAC,
  launchDesktop,
  startDevServer,
  waitForApplication,
  warmUpDevPage,
  windowIdOf,
  type Desktop,
  type DevServer,
} from './harness';

let server: DevServer;
let desktop: Desktop;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startDevServer();
  desktop = await launchDesktop({ devServer: server });
  await warmUpDevPage(desktop.page);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
  await server?.close();
});

/** Assembles charLoopProgram, opens it as File > Open does and runs it until it waits in task 5. */
async function startCharLoop(page: Page): Promise<void> {
  const path = await page.evaluate(async () => {
    const [engine, programs] = await Promise.all([
      import(String('/src/engine/testing.ts')),
      import(String('/src/features/output/testing/programs.ts')),
    ]);
    const { ctx } = window.__easy68k;
    await ctx.commands.run('app.mode.set', 'simulator');
    const { s68, l68 } = await engine.assembleProgram(programs.charLoopProgram());
    const file = `/browser/desktop-output/chars-${Date.now()}.S68`;
    await ctx.vfs.writeFile(file, s68);
    await ctx.vfs.writeFile(file.replace(/S68$/, 'L68'), l68);
    void ctx.sim.controller.open(file, 'open');
    return file;
  });
  await expect
    .poll(
      () =>
        page.evaluate((file) => {
          const state = window.__easy68k.ctx.store.getState().sim;
          return state.phase === 'idle' && state.program?.path === file;
        }, path),
      { timeout: 60_000, message: 'the program is loaded' },
    )
    .toBe(true);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.run.run'));
  await expect
    .poll(() => page.evaluate(() => window.__easy68k.ctx.sim.controller.phase), { timeout: 30_000 })
    .toBe('waitInput');
}

/**
 * The characters the program has read with task 5 (programs.ts CHARS). Throws if the page has been
 * reloaded since recordPasteTiming() (then the engine is a new one and its memory says nothing).
 */
function charsRead(page: Page): Promise<string> {
  return page.evaluate(() => {
    if (!(window as unknown as Record<string, unknown>)['__pasteLog']) {
      throw new Error('the page was reloaded during the test (Vite optimised a dependency late?)');
    }
    const engine = window.__easy68k.ctx.sim.engine;
    const count = engine.readLong(0x3000) >>> 0;
    let text = '';
    for (let i = 0; i < Math.min(count, 256); i++) text += String.fromCharCode(engine.readByte(0x3100 + i));
    return text;
  });
}

/** Records, in the page, when the program's textarea gets key-downs and paste events. */
async function recordPasteTiming(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('[data-e68-keys="program"]');
    if (!target) throw new Error('the Output panel has no program key element');
    const log: { type: string; key?: string; at: number }[] = [];
    (window as unknown as Record<string, unknown>)['__pasteLog'] = log;
    target.addEventListener(
      'keydown',
      (event) => log.push({ type: 'keydown', key: event.key, at: performance.now() }),
      {
        capture: true,
      },
    );
    target.addEventListener('paste', () => log.push({ type: 'paste', at: performance.now() }), { capture: true });
    target.focus();
  });
}

const pasteLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pasteLog: { type: string; key?: string; at: number }[] }).__pasteLog);

test('the paste chord and sim.output.paste paste into a task 5 loop as the original does (HELLO stores HO)', async () => {
  test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
  test.setTimeout(240_000);
  const { page, app } = desktop;
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await startCharLoop(page);
    await page.evaluate(async () => {
      const { showPanel } = await import(String('/src/state/panels.ts'));
      showPanel(window.__easy68k.ctx, 'output');
    });
    await page.locator('[data-e68-keys="program"]').waitFor({ state: 'attached', timeout: 30_000 });
    await recordPasteTiming(page);
    await app.evaluate(({ clipboard }) => clipboard.writeText('HELLO'));

    // 1. The paste chord of the panel: Cmd+V on macOS (through the Edit menu's Paste role, which
    //    sends the paste back to the page), Shift+Insert elsewhere (Ctrl+V is the character $16
    //    there, as in the original).
    await page.keyboard.press(IS_MAC ? 'Meta+KeyV' : 'Shift+Insert');
    await expect.poll(() => charsRead(page), { timeout: 20_000 }).toBe('HO');
    await page.waitForTimeout(300);
    expect(await charsRead(page)).toBe('HO');
    const chordLog = await pasteLog(page);
    const down = chordLog.find((entry) => entry.type === 'keydown');
    const paste = chordLog.find((entry) => entry.type === 'paste');
    expect(paste, 'a paste event after the chord').toBeTruthy();
    const delay = (paste?.at ?? 0) - (down?.at ?? 0);
    test.info().annotations.push({
      type: 'note',
      description: `paste chord: the paste event came ${delay.toFixed(1)} ms after the key-down (the panel waits 150 ms)`,
    });
    expect(delay).toBeLessThan(150);

    // 2. The command (Edit menu, toolbar): Platform.pasteIntoFocus, the main process's paste.
    await page.evaluate(() => {
      (window as unknown as { __pasteLog: unknown[] }).__pasteLog.length = 0;
      (window as unknown as Record<string, unknown>)['__commandAt'] = performance.now();
      void window.__easy68k.ctx.commands.run('sim.output.paste');
    });
    await expect.poll(() => charsRead(page), { timeout: 20_000 }).toBe('HOHO');
    await page.waitForTimeout(300);
    expect(await charsRead(page)).toBe('HOHO');
    const commandLog = await pasteLog(page);
    const commandAt = await page.evaluate(() => (window as unknown as { __commandAt: number }).__commandAt);
    const commandPaste = commandLog.find((entry) => entry.type === 'paste');
    expect(commandPaste, 'a paste event after Platform.pasteIntoFocus').toBeTruthy();
    const commandDelay = (commandPaste?.at ?? 0) - commandAt;
    test.info().annotations.push({
      type: 'note',
      description: `sim.output.paste: the paste event came ${commandDelay.toFixed(1)} ms after the command (the panel waits 150 ms)`,
    });
    expect(commandDelay).toBeLessThan(150);
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    await page.evaluate(() => {
      try {
        window.__easy68k.ctx.sim.controller.pause();
      } catch {
        // not running
      }
    });
  }
});

test('a full-screen change made by the system reaches the page (Platform.onFullScreenChange)', async () => {
  const { page, app } = desktop;
  const id = await windowIdOf(app, page);
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as Record<string, unknown>)['__fullScreenSeen'] = seen;
    const stop = window.__easy68k.ctx.platform.onFullScreenChange((on: boolean) => seen.push(on));
    (window as unknown as Record<string, unknown>)['__fullScreenStop'] = stop;
  });
  // What the window reports when the user presses the green button and leaves again (the window
  // itself does not change: this would cover the screen of whoever uses the machine).
  await app.evaluate(({ BrowserWindow }, windowId) => {
    const window = BrowserWindow.fromId(windowId);
    window?.emit('enter-full-screen');
    window?.emit('leave-full-screen');
  }, id);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fullScreenSeen: boolean[] }).__fullScreenSeen))
    .toEqual([true, false]);
  await page.evaluate(() => (window as unknown as { __fullScreenStop: () => void }).__fullScreenStop());
});

test('Alt+Enter in the Output panel takes the window into full screen and out again (macOS)', async () => {
  test.skip(
    !IS_MAC,
    'macOS only: window-level full screen moves the window into its own Space there; on this OS it would cover the screen of whoever uses the machine',
  );
  test.setTimeout(240_000);
  const own = await launchDesktop({ devServer: server, windows: 'inactive' });
  try {
    await warmUpDevPage(own.page);
    await waitForApplication(own.page);
    await own.page.evaluate(async () => {
      const { ctx } = window.__easy68k;
      await ctx.commands.run('app.mode.set', 'simulator');
      const { showPanel } = await import(String('/src/state/panels.ts'));
      showPanel(ctx, 'output');
    });
    const keys = own.page.locator('[data-e68-keys="program"]');
    await keys.waitFor({ state: 'attached', timeout: 30_000 });
    await keys.focus();
    const isFull = () => own.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen());
    await own.page.keyboard.press('Alt+Enter');
    await expect.poll(isFull, { timeout: 30_000 }).toBe(true);
    await keys.focus();
    await own.page.keyboard.press('Alt+Enter');
    await expect.poll(isFull, { timeout: 30_000 }).toBe(false);
  } finally {
    await own.close();
  }
});
