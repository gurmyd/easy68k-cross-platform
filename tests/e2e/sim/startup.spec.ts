// Start-up, opening and closing programs (ARCHITECTURE.md 1.3.4 File menu; 1.3.5 rows "Several
// simulators at once", "Command line", "Load sequence ... window title", "Drag and drop of an
// .S68", "Shut-down"; 1.3.7 row "Simple PC breakpoints"; 4.7.1; 5.7; 1.4 notes 20, 22, 39; sim-ui
// §8). Owner: X2.

import { expect, test, type App } from '../fixtures';
import {
  answer,
  assemble,
  execute,
  expectReg,
  expectState,
  gutter,
  listingRow,
  listingRows,
  messages,
  newDocument,
  panel,
  program,
  reg,
  switchMode,
  tool,
  typeInto,
  view,
  step,
} from './sim';

const FIRST = program('    MOVE.L  #$11111111,D1', '    MOVE.L  #$22222222,D2', '    SIMHALT');
const SECOND = program('    MOVE.L  #$33333333,D3', '    SIMHALT');

/**
 * Assembles `lines` saved as `name`.X68 in My Programs (so that name.S68 and name.L68 exist there),
 * in a document of its own, and leaves a new empty document active for what the test does next.
 */
async function build(app: App, name: string, lines: string[]): Promise<void> {
  await newDocument(app);
  const dialog = await assemble(app, lines, `${name}.X68`);
  await app.button(dialog, 'Close').click();
  await expect(dialog).toBeHidden();
  await newDocument(app);
}

/**
 * Chooses `name` in My Programs in an open file dialog. The dialog starts in the folder of the
 * loaded program, which for an unsaved document is not My Programs: "Look in" goes there first.
 */
async function chooseInMyPrograms(app: App, title: string, name: string): Promise<void> {
  const dialog = app.page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Look in:').selectOption({ label: 'My Programs' });
  await app.fileDialogName(dialog, name, 'Open');
  await expect(dialog).toBeHidden();
}

/** File > Open... of Simulator mode: chooses `name` in My Programs. */
async function openProgram(app: App, name: string): Promise<void> {
  await app.chooseMenu('File', 'Open...');
  await chooseInMyPrograms(app, 'Open', name);
}

test('the web command line: ?open= loads an .S68 without running it; run, exceptions and bitfield apply', async ({
  app,
}) => {
  await build(app, 'cmd', FIRST);
  const other = await app.openWindow('?open=/browser/cmd.S68');
  await expect.poll(() => other.mode()).toBe('simulator');
  await expect(listingRows(other).filter({ hasText: '#$11111111' })).toHaveCount(1);
  await expectState(other, 'Stopped');
  await expect.poll(() => other.page.title()).toContain('cmd.S68');
  const third = await app.openWindow('?open=/browser/cmd.S68&run=1&exceptions=1&bitfield=1');
  await expectState(third, 'Halted');
  await expectReg(third, 'D2', '22222222');
  await expect(third.page.locator('[data-e68-status="exceptions"]')).toHaveText('exceptions on');
  await expect(third.page.locator('[data-e68-status="bitField"]')).toHaveText('bit field on');
});

test('switches with no loadable file still apply and the mode stays (sim-ui §8.1)', async ({ app }) => {
  const other = await app.openWindow('?open=/browser/none.S68&exceptions=1');
  expect(await other.mode()).toBe('editor');
  await switchMode(other, 'Simulator');
  await expect(other.page.locator('[data-e68-status="exceptions"]')).toHaveText('exceptions on');
});

test('File > Open loads the program afresh and clears PC breakpoints only when a file was chosen (note 39)', async ({
  app,
}) => {
  await build(app, 'second', SECOND);
  await execute(app, FIRST);
  await gutter(listingRow(app, '#$22222222')).click();
  // Cancel keeps the breakpoint.
  await app.chooseMenu('File', 'Open...');
  const dialog = app.page.getByRole('dialog', { name: 'Open', exact: true });
  await app.button(dialog, 'Cancel').click();
  await expect(dialog).toBeHidden();
  expect(await listingRow(app, '#$22222222').getAttribute('data-bp')).toBe('on');
  await openProgram(app, 'second.S68');
  await expect(listingRows(app).filter({ hasText: '#$33333333' })).toHaveCount(1);
  await expect.poll(() => messages(app)).toEqual(['S0 = 68KPROG   20CREATED BY EASY68K', '.S68 file read successful']);
  await expect.poll(() => app.page.title()).toContain('second.S68');
  // The breakpoint of the earlier program's address is gone: Run goes to the end.
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D3', '33333333');
});

test('an .S68 without its .L68: Unable to open .L68 file. and the nine explanatory lines', async ({ app }) => {
  await build(app, 'nolist', FIRST);
  await switchMode(app, 'Editor');
  const s68 = await app.exportFile('nolist.S68');
  await app.importFiles([{ name: 'bare.S68', data: s68 }]);
  await switchMode(app, 'Simulator');
  await openProgram(app, 'bare.S68');
  await expect.poll(() => messages(app)).toContain('Unable to open .L68 file.');
  await expect(listingRows(app)).toHaveCount(9);
  await expectReg(app, 'PC', '00001000');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D2', '22222222');
});

test('File > Open Data overlays memory and appends its messages; the listing stays', async ({ app }) => {
  await build(app, 'data', [
    '    ORG    $1000',
    'START:',
    '    MOVE.L  #$44444444,D4',
    '    SIMHALT',
    '    END    START',
  ]);
  await execute(app, FIRST);
  await app.chooseMenu('File', 'Open Data...');
  await chooseInMyPrograms(app, 'Open', 'data.S68');
  await expect
    .poll(async () => (await messages(app)).filter((line) => line === '.S68 file read successful').length)
    .toBe(2);
  // The listing is the first program's; memory at $1000 is the data file's.
  await expect(listingRows(app).filter({ hasText: '#$11111111' })).toHaveCount(1);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D4', '44444444');
});

test('File > Close asks Caution; OK resets the simulator, clears the listing and keeps memory', async ({ app }) => {
  await execute(app, FIRST);
  await step(app);
  await expectReg(app, 'D1', '11111111');
  await app.chooseMenu('File', 'Close');
  expect(await answer(app, 'Cancel', 'Caution')).toBe(
    'The current debug environment will be lost, click OK to continue.',
  );
  await expect(listingRows(app).first()).toBeVisible();
  await app.chooseMenu('File', 'Close');
  await answer(app, 'OK', 'Caution');
  await expect(listingRows(app)).toHaveCount(0);
  await expectReg(app, 'D1', '00000000');
});

test('an .S68 dropped on the simulator asks Caution, then loads it (sim-ui §8.4)', async ({ app }) => {
  await build(app, 'drop', SECOND);
  await switchMode(app, 'Editor');
  const s68 = await app.exportFile('drop.S68');
  await execute(app, FIRST);
  await app.dropFiles([{ name: 'dropped.S68', data: s68 }], '[data-e68-panel="listing"]');
  await answer(app, 'OK', 'Caution');
  await expect.poll(() => messages(app)).toContain('Unable to open .L68 file.');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D3', '33333333');
});

test('Execute starts the simulator afresh: no output size, memory map or breakpoint of the last program (4.7.1)', async ({
  app,
}) => {
  await execute(app, [...program('    MOVE.L  #$03200258,D1', '    MOVE.B  #33,D0', '    TRAP    #15', '    SIMHALT')]);
  const hw = await view(app, 'Hardware', 'hardware');
  await hw.getByRole('checkbox', { name: 'Invalid:' }).check();
  await typeInto(hw.getByLabel('Invalid start'), '003000');
  await gutter(listingRow(app, 'SIMHALT')).click();
  await tool(app, 'sim.run.run');
  await expect
    .poll(() =>
      panel(app, 'output')
        .locator('canvas')
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(800);
  await execute(app, SECOND);
  await expect
    .poll(() =>
      panel(app, 'output')
        .locator('canvas')
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(640);
  await view(app, 'Hardware', 'hardware');
  await expect(hw.getByRole('checkbox', { name: 'Invalid:' })).not.toBeChecked();
  expect(await listingRow(app, /SIMHALT$/).getAttribute('data-bp')).toBe('off');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D3', '33333333');
});

test('Execute while a program runs asks Caution first (note 20); Open stays enabled while it runs (note 22)', async ({
  app,
}) => {
  await execute(app, program('LOOP BRA     LOOP'));
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  await expect(app.toolbarButton('sim.file.open')).toBeEnabled();
  await switchMode(app, 'Editor');
  await app.replaceText(SECOND.join('\n'));
  await app.focusEditor();
  await app.press('ed.project.assemble');
  const status = app.dialog('Assembler Status - untitled1.x68');
  await app.button(status, 'Execute').click();
  expect(await answer(app, 'OK', 'Caution')).toBe('The current debug environment will be lost, click OK to continue.');
  await expect.poll(() => app.mode()).toBe('simulator');
  await expect(listingRows(app).filter({ hasText: '#$33333333' })).toHaveCount(1);
  await expectState(app, 'Stopped');
});

test('a second window has a simulator of its own (note 43)', async ({ app }) => {
  await build(app, 'twin', FIRST);
  await execute(app, program('LOOP BRA     LOOP'));
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  const other = await app.openWindow('?open=/browser/twin.S68&run=1');
  await expectState(other, 'Halted');
  await expectReg(other, 'D2', '22222222');
  // The first window's program is still running.
  await expectState(app, 'Running');
  await tool(app, 'sim.run.pause');
  await expectState(app, 'Stopped');
});

test('leaving the page asks nothing while a program is loaded and stopped (shut-down)', async ({ app, page }) => {
  // Saved, so that no modified document of the editor makes the page ask (1.3.3, Exit row).
  await execute(app, FIRST, 'shutdown.X68');
  await step(app);
  await expectReg(app, 'D1', '11111111');
  // What the browser asks the page before it unloads: a `beforeunload` that a handler cancels (or
  // gives a return value) makes the browser show its "leave site?" question. Dispatched in the page,
  // because how each browser then shows (or suppresses) that question is not the page's doing.
  // The page may ask while bytes are still on their way to storage (the document just saved, 3.8.6;
  // the guard of features/run/session.ts): polled until everything is written.
  const asked = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        returnValue: (event as Event & { returnValue: unknown }).returnValue,
      };
    });
  await expect.poll(asked, { timeout: 30_000 }).toEqual({ prevented: false, returnValue: true });
  void reg;
});
