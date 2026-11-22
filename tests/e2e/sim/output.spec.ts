// The Output panel: one surface for text and graphics, its size, text wrap, full screen and fonts
// (ARCHITECTURE.md 1.3.4 rows "Output Window Font...", "Output Window Size", "Output Window Text
// Wrap"; 1.3.6 rows "Window Sim68K I/O", "One surface ...", "Full screen"; 2.5; 1.4 notes 27, 35,
// 36; trap15-a §3.10, task 33; trap15-b §4). Owner: X2.

import { expect, test, type App } from '../fixtures';
import {
  canvas,
  execute,
  expectOutputLine,
  expectReg,
  expectState,
  outputText,
  panel,
  pixel,
  program,
  programKeys,
  surface,
  tool,
  pressCommand,
  step,
} from './sim';

/** Prints 100 characters with task 1 (no CR LF), then halts. */
const LONG_LINE = program(
  '    LEA     TEXT,A1',
  '    MOVE.W  #100,D1',
  '    MOVE.B  #1,D0',
  '    TRAP    #15',
  '    SIMHALT',
  `TEXT DC.B   '${'0123456789'.repeat(10)}'`,
);

/** The panel's size text, the canvas's backing store and the checked item of Output Window Size. */
async function sizes(app: App): Promise<{ header: string; canvas: string; checked: string[] }> {
  const header = (await panel(app, 'output').locator('.e68-output__size').textContent()) ?? '';
  const store = await canvas(app).evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`);
  const menu = await app.openMenu('Options');
  await app.menuItem(menu, 'Output Window Size').click();
  const entries = await app.entriesOf(app.openMenuList);
  await app.page.keyboard.press('Escape');
  await app.page.keyboard.press('Escape');
  return { header, canvas: store, checked: entries.filter((e) => e.checked).map((e) => e.caption) };
}

test('task 33 sets the surface size; the menu check follows; a size that is not on the menu checks nothing', async ({
  app,
}) => {
  await execute(
    app,
    program(
      '    MOVE.L  #$03200258,D1',
      '    MOVE.B  #33,D0',
      '    TRAP    #15',
      '    MOVE.L  #0,D1',
      '    TRAP    #15',
      '    MOVE.L  D1,D6',
      '    MOVE.L  #$02BC01F4,D1',
      '    TRAP    #15',
      '    SIMHALT',
    ),
  );
  await step(app);
  await step(app);
  await step(app);
  await expect.poll(async () => (await sizes(app)).canvas).toBe('800x600');
  expect(await sizes(app)).toEqual({ header: '800x600', canvas: '800x600', checked: ['800x600'] });
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D6', '03200258');
  // 700x500 is not one of the nine sizes.
  await expect.poll(async () => (await sizes(app)).canvas).toBe('700x500');
  expect((await sizes(app)).checked).toEqual([]);
  // A size set by the menu clears the surface to black (trap15-a §3.10).
  const surfaceNow = await surface(app);
  expect(surfaceNow.width).toBe(700);
});

test('text and graphics share one black surface; the canvas holds exactly its pixels', async ({ app }) => {
  await execute(
    app,
    program(
      '    MOVE.L  #$0000FF00,D1',
      '    MOVE.B  #80,D0',
      '    TRAP    #15',
      '    MOVE.B  #81,D0',
      '    TRAP    #15',
      '    MOVE.W  #100,D1',
      '    MOVE.W  #100,D2',
      '    MOVE.W  #199,D3',
      '    MOVE.W  #149,D4',
      '    MOVE.B  #87,D0',
      '    TRAP    #15',
      '    LEA     TEXT,A1',
      '    MOVE.B  #13,D0',
      '    TRAP    #15',
      '    SIMHALT',
      "TEXT DC.B   'Hi',0",
    ),
  );
  const blank = await surface(app);
  expect(blank).toMatchObject({ width: 640, height: 480, colours: 1 });
  expect(await pixel(app, 320, 240)).toBe('#000000');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectOutputLine(app, 'Hi');
  // The filled rectangle of task 87 in green ($00BBGGRR = $0000FF00).
  await expect.poll(() => pixel(app, 150, 120)).toBe('#00ff00');
  expect(await pixel(app, 99, 120)).toBe('#000000');
  expect(await pixel(app, 300, 300)).toBe('#000000');
  // Text in white on the same surface, at the top left.
  const drawn = await surface(app);
  expect(drawn.colours).toBeGreaterThanOrEqual(3);
  expect(drawn.hash).not.toBe(blank.hash);
});

test('Output Window Text Wrap: off, text runs past the right edge; on, it continues on the next row', async ({
  app,
}) => {
  await execute(app, LONG_LINE);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  // 640 pixels of Fixedsys are 80 columns. The second text row (pixels 18-28 lie inside it) is read
  // from the surface: the text mirror follows the text shadow array, whose rows the original fills
  // past the right edge as well (trap15-a §3.7), so it cannot show the difference.
  await expect.poll(async () => (await outputText(app))[0]).toBe('0123456789'.repeat(8));
  expect(await litPixels(app, 18, 28), 'wrap off: nothing drawn on the second row').toBe(0);
  await app.chooseMenu('Options', 'Output Window Text Wrap');
  expect((await app.menuEntries('Options')).find((e) => e.caption === 'Output Window Text Wrap')?.checked).toBe(true);
  await tool(app, 'sim.run.rewind');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expect
    .poll(() => litPixels(app, 18, 28), 'wrap on: the last 20 characters on the second row')
    .toBeGreaterThan(0);
});

/** The number of pixels that are not black in the rows `top` to `bottom` of the surface. */
async function litPixels(app: App, top: number, bottom: number): Promise<number> {
  return canvas(app).evaluate(
    (element: HTMLCanvasElement, [y0, y1]) => {
      const data = element.getContext('2d')!.getImageData(0, y0, element.width, y1 - y0 + 1).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i]! | data[i + 1]! | data[i + 2]!) lit++;
      return lit;
    },
    [top, bottom] as const,
  );
}

test('Output Window Font: a font dialog limited to the measured fixed-pitch fonts (note 27)', async ({ app }) => {
  await execute(app, LONG_LINE);
  await app.chooseMenu('Options', 'Output Window Font...');
  const dialog = app.dialog('Output Window Font');
  await expect(dialog).toBeVisible();
  const fonts = await dialog.getByRole('listbox', { name: 'Font', exact: true }).getByRole('option').allTextContents();
  expect(fonts.map((font) => font.trim())).toEqual([
    'Fixedsys',
    'Courier',
    'Courier New',
    'Lucida Console',
    'Consolas',
  ]);
  await app.button(dialog, 'Cancel').click();
  await expect(dialog).toBeHidden();
});

test('full screen: the button enters, Alt+Enter in the Output panel leaves; the surface keeps its size', async ({
  app,
  browserName,
}) => {
  await execute(app, LONG_LINE);
  const output = panel(app, 'output').locator('.e68-output');
  const before = await surface(app);
  await panel(app, 'output')
    .getByRole('button', { name: /^Full Screen/ })
    .click();
  const refused = app.dialog('Information');
  // A headless browser may refuse full screen; then the port shows the original's failure box (2.5).
  await expect
    .poll(async () =>
      (await output.getAttribute('data-fullscreen')) === 'true'
        ? 'full'
        : (await refused.count()) > 0
          ? 'refused'
          : 'none',
    )
    .not.toBe('none');
  const outcome = (await refused.count()) > 0 ? 'refused (the original box)' : 'entered';
  // Printed, so that the CI log says which way each browser went.
  console.log(`full screen in ${browserName} on ${process.platform}: ${outcome}`);
  if ((await refused.count()) > 0) {
    test.info().annotations.push({ type: 'note', description: `${browserName}: full screen refused in this browser` });
    expect(await app.boxText(refused)).toBe(
      "Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.",
    );
    await app.button(refused, 'OK').click();
    return;
  }
  expect((await surface(app)).width).toBe(before.width);
  await programKeys(app).focus();
  await pressCommand(app, 'sim.output.fullscreen');
  await expect(output).not.toHaveAttribute('data-fullscreen', 'true');
});

test('the Output panel collapses but is not closed; output shows it again (note 35)', async ({ app }) => {
  await execute(app, LONG_LINE);
  await panel(app, 'output').getByRole('button', { name: 'Collapse the Output panel' }).click();
  await expect(canvas(app)).toBeHidden();
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  // A program that writes text shows the panel (sim-ui §15: shown on text output).
  await expect(canvas(app)).toBeVisible();
});
