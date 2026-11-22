// Keyboard and mouse input of a running program (ARCHITECTURE.md 1.3.5 row "TRAP #15 task 24", 1.3.6
// rows "Paste clipboard as typed input", "Keyboard input, key state table, key and mouse
// interrupts, input prompt"; 2.9.4; 3.6; 1.4 note 44; trap15-a §3.9, tasks 2, 4, 5, 19, 24;
// trap15-b §8, task 61). Owner: X2.
//
// 6.6, "Hold keys and buttons": a program sees a key by polling, so keys it polls are pressed with
// keyboard.down, held until the program shows that it saw them, and released.

import { expect, test, type App } from '../fixtures';
import {
  canvas,
  execute,
  expectOutputLine,
  expectReg,
  expectState,
  hold,
  outputText,
  panel,
  program,
  programKeys,
  reg,
  tool,
} from './sim';

/** Task 2 into BUF, the length into D7, then the string again with task 13. */
const READ_STRING = program(
  '    LEA     BUF,A1',
  '    MOVE.B  #2,D0',
  '    TRAP    #15',
  '    MOVE.L  D1,D7',
  '    LEA     BUF,A1',
  '    MOVE.B  #13,D0',
  '    TRAP    #15',
  '    MOVE.B  #5,D0',
  '    TRAP    #15',
  '    SIMHALT',
  'BUF DS.B    80',
);

/** Waits in a task 19 loop until the key with virtual-key code `vk` is down, then halts. */
function waitForKey(vk: number, ...before: string[]): string[] {
  return program(
    ...before,
    `LOOP MOVE.L  #$${vk.toString(16).toUpperCase()},D1`,
    '    MOVE.B  #19,D0',
    '    TRAP    #15',
    '    TST.B   D1',
    '    BEQ     LOOP',
    '    SIMHALT',
  );
}

/** Starts the program with Run; Run gives the Output panel the keyboard (trap15-a §3.9). */
async function run(app: App): Promise<void> {
  await tool(app, 'sim.run.run');
  await expect(programKeys(app)).toBeFocused();
}

/**
 * The paste chord in the Output panel (Shift+Insert; Cmd+V on macOS) with `text` on the clipboard,
 * as a browser delivers it: the chord's key-down, which the panel leaves to the browser, then the
 * browser's `paste` event with the text, then the key-up. Dispatched in the page, because the
 * clipboard of a headless browser cannot be filled the same way in Chromium and WebKit.
 */
async function pasteChord(app: App, text: string): Promise<void> {
  const mac = app.keys === 'mac';
  await programKeys(app).evaluate(
    (element, [value, onMac]) => {
      const chord = onMac
        ? { key: 'v', code: 'KeyV', keyCode: 86, metaKey: true, shiftKey: false }
        : { key: 'Insert', code: 'Insert', keyCode: 45, metaKey: false, shiftKey: true };
      const init = { ...chord, bubbles: true, cancelable: true };
      element.dispatchEvent(new KeyboardEvent('keydown', init));
      const data = new DataTransfer();
      data.setData('text/plain', value);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', init));
    },
    [text, mac] as const,
  );
}

/** The id of the panel that holds the keyboard focus. */
async function focusedPanel(app: App): Promise<string | null> {
  return app.page.evaluate(() => {
    const element = document.activeElement?.closest('[data-e68-panel]');
    return element instanceof HTMLElement ? (element.dataset.e68Panel ?? null) : null;
  });
}

test('task 2: a typed line is echoed, ends with Enter, and is stored with its length', async ({ app, page }) => {
  await execute(app, READ_STRING);
  await run(app);
  await expectState(app, 'Waiting for input');
  await page.keyboard.type('hellx');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('o');
  await page.keyboard.press('Enter');
  // Task 13 wrote the stored string on the next line. The echo of typed input is drawn, not stored in
  // the text shadow array (trap15-a §3.9), so the text mirror shows the second line only: the
  // first is the empty echo row, the second the program's own output.
  await expect.poll(() => outputText(app)).toEqual(expect.arrayContaining(['', 'hello']));
  expect((await outputText(app)).filter((line) => line === 'hello')).toHaveLength(1);
  expect((await outputText(app))[1]).toBe('hello');
  await page.keyboard.type('q');
  await expectState(app, 'Halted');
  // The registers are shown when the program stops (sim-ui §4.2).
  await expectReg(app, 'D7', '00000005');
});

test('task 4 reads a number with atoi rules; task 5 reads one character into D1.B', async ({ app, page }) => {
  await execute(
    app,
    program(
      '    MOVE.B  #4,D0',
      '    TRAP    #15',
      '    MOVE.L  D1,D6',
      '    MOVE.B  #5,D0',
      '    TRAP    #15',
      '    SIMHALT',
    ),
  );
  await run(app);
  await expectState(app, 'Waiting for input');
  await page.keyboard.type('-42x');
  await page.keyboard.press('Enter');
  await expectState(app, 'Waiting for input');
  await page.keyboard.type('Z');
  await expectState(app, 'Halted');
  await expectReg(app, 'D6', 'FFFFFFD6');
  // Bits 31..8 of D1 are kept by task 5 (they hold the number read before).
  await expectReg(app, 'D1', 'FFFFFF5A');
});

test('type-ahead: keys typed while nothing waits keep the last one for the next input', async ({ app, page }) => {
  await execute(
    app,
    program(
      '    MOVE.L  #300,D1',
      '    MOVE.B  #23,D0',
      '    TRAP    #15',
      '    MOVE.B  #5,D0',
      '    TRAP    #15',
      '    SIMHALT',
    ),
  );
  await run(app);
  await expectState(app, 'Running');
  await page.keyboard.type('ab');
  await expectState(app, 'Halted');
  // D1 held 300 ($12C); task 5 replaces only D1.B.
  await expectReg(app, 'D1', '00000162');
});

test('paste chord: one line completes a task 2 input; of several lines the last character is the type-ahead', async ({
  app,
}) => {
  await execute(app, READ_STRING);
  await run(app);
  await expectState(app, 'Waiting for input');
  await pasteChord(app, 'pasted\r\nsecond line\r\nxy');
  // Task 5 found the last pasted character pending and returned at once (trap15-a §3.9).
  await expectState(app, 'Halted');
  await expectReg(app, 'D7', '00000006');
  expect((await reg(app, 'D1')).slice(6)).toBe('79');
  await expectOutputLine(app, 'pasted');
});

test('dead-key and composed input arrive as one Windows-1252 character', async ({ app, page }) => {
  await execute(
    app,
    program(
      '    MOVE.B  #5,D0',
      '    TRAP    #15',
      '    MOVE.L  D1,D6',
      '    MOVE.B  #5,D0',
      '    TRAP    #15',
      '    SIMHALT',
    ),
  );
  await run(app);
  await expectState(app, 'Waiting for input');
  // The text a dead key or an input method commits (an `input` event without a key).
  await page.keyboard.insertText('é');
  await expectOutputLine(app, 'é');
  // An input method's composition, completed.
  await programKeys(app).evaluate((element: HTMLTextAreaElement) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    element.value = 'ñ';
    element.dispatchEvent(new CompositionEvent('compositionend', { data: 'ñ', bubbles: true }));
  });
  await expectState(app, 'Halted');
  expect((await reg(app, 'D6')).slice(6)).toBe('E9');
  expect((await reg(app, 'D1')).slice(6)).toBe('F1');
  await expectOutputLine(app, 'éñ');
});

test('task 19 sees a held letter key', async ({ app, page }) => {
  await execute(app, waitForKey(0x41));
  await run(app);
  await expectState(app, 'Running');
  await hold(page, 'KeyA', () => expectState(app, 'Halted'));
  await expectReg(app, 'D1', '000000FF');
});

test('F1, F2, F4 and Shift+F2 reach the program in the Output panel and do nothing else (2.9.4)', async ({
  app,
  page,
}) => {
  for (const [vk, key] of [
    [0x70, 'F1'],
    [0x71, 'F2'],
    [0x73, 'F4'],
    [0x71, 'Shift+F2'],
  ] as const) {
    await execute(app, waitForKey(vk));
    await run(app);
    await expectState(app, 'Running');
    const [modifier, name] = key.includes('+') ? key.split('+') : [null, key];
    if (modifier) await page.keyboard.down(modifier);
    await hold(page, name!, () => expectState(app, 'Halted'));
    if (modifier) await page.keyboard.up(modifier);
    expect(await app.mode(), `${key}: no mode switch`).toBe('simulator');
    expect(await focusedPanel(app), `${key}: the Output panel keeps the keyboard`).toBe('output');
    expect(await reg(app, 'PC'), `${key}: no Rewind`).not.toBe('00001000');
    await expect(app.page.locator('[data-e68-panel="help"] iframe'), `${key}: no help`).toHaveCount(0);
  }
});

test('task 24: the simulator keys go to the program; Ctrl+Alt+O still leaves the Output panel (note 44)', async ({
  app,
  page,
}) => {
  // Without task 24, F6 in the Output panel is Pause.
  await execute(app, waitForKey(0x75));
  await run(app);
  await expectState(app, 'Running');
  await page.keyboard.press('F6');
  await expectState(app, 'Stopped');
  // With task 24, F6 is a key of the program.
  await execute(app, waitForKey(0x75, '    MOVE.L  #1,D1', '    MOVE.B  #24,D0', '    TRAP    #15'));
  await run(app);
  await expectState(app, 'Running');
  await hold(page, 'F6', () => expectState(app, 'Halted'));
  // The keyboard-release chord works in every state.
  await programKeys(app).focus();
  await app.press('sim.output.releaseKeyboard');
  await expect.poll(() => focusedPanel(app)).not.toBe('output');
  // The toolbar still works after task 24 (only the keys were taken).
  await tool(app, 'sim.run.rewind');
  await expectState(app, 'Stopped');
});

test('tasks 62 and 60: a key-down and a mouse button-down raise their interrupt levels (exceptions on)', async ({
  app,
  page,
}) => {
  await app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Simulator' }).click();
  await app.chooseMenu('Options', 'Enable Exceptions');
  await execute(app, [
    '    ORG    $64',
    '    DC.L   KEY',
    '    DC.L   MOUSE',
    ...program(
      '    MOVE.L  #$0101,D1',
      '    MOVE.B  #62,D0',
      '    TRAP    #15',
      '    MOVE.L  #$0201,D1',
      '    MOVE.B  #60,D0',
      '    TRAP    #15',
      'LOOP CMP.L   #2,D6',
      '    BNE     LOOP',
      '    SIMHALT',
      'KEY ADDQ.L   #1,D6',
      '    MOVE.L  #0,D1',
      '    MOVE.B  #19,D0',
      '    TRAP    #15',
      '    MOVE.B  D1,D5',
      '    RTE',
      'MOUSE ADDQ.L #1,D6',
      '    MOVE.L  #$4D,D4',
      '    RTE',
    ),
  ]);
  await run(app);
  await expectState(app, 'Running');
  // An interrupt needs no polling: a press of 100 ms (6.6) is enough.
  await page.keyboard.press('KeyK', { delay: 100 });
  const box = (await canvas(app).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.up();
  await expectState(app, 'Halted');
  // The key handler read the key with task 19: K = $4B.
  expect((await reg(app, 'D5')).slice(6)).toBe('4B');
  await expectReg(app, 'D4', '0000004D');
});

test('task 61 reads the mouse in surface pixels while the left button is held', async ({ app, page }) => {
  await execute(
    app,
    program(
      'LOOP MOVE.B  #0,D1',
      '    MOVE.B  #61,D0',
      '    TRAP    #15',
      '    BTST    #0,D0',
      '    BEQ     LOOP',
      '    SIMHALT',
    ),
  );
  await run(app);
  await expectState(app, 'Running');
  const box = (await canvas(app).boundingBox())!;
  const size = await canvas(app).evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
  const scale = box.width / size.width;
  // The middle of surface pixel (100, 50).
  await page.mouse.move(box.x + 100.5 * scale, box.y + 50.5 * scale);
  await page.mouse.down();
  try {
    await expectState(app, 'Halted');
  } finally {
    await page.mouse.up();
  }
  await expectReg(app, 'D1', '00320064');
  expect((await reg(app, 'D0')).slice(6)).toBe('01');
  await expect(panel(app, 'output')).toBeVisible();
});
