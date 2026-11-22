// The Memory and Stack panels (ARCHITECTURE.md 1.3.7 rows "68000 Memory window", "Memory window live
// update", "68000 Stack window"; 1.4 note 38; sim-ui §10, §11). Owner: X2.

import { expect, test, type App } from '../fixtures';
import { answer, execute, expectReg, expectState, panel, program, switchMode, tool, typeInto, view } from './sim';

/** Data at $2000 that the tests read back: "AB", $00, $7F, $FF and a word. */
const DATA = program(
  '    MOVE.L  #$11223344,-(A7)',
  '    MOVE.L  #$55667788,-(A7)',
  '    LEA     4(A7),A0',
  '    SIMHALT',
  '    ORG     $2000',
  "    DC.B    'AB',0,$7F,$FF",
  '    DC.W    $CAFE',
);

/** The rows of the Memory panel as text: `00002000: 41 42 ... AB-...`. */
async function memoryRows(app: App): Promise<string[]> {
  return panel(app, 'memory')
    .locator('.e68-memory__row:not(.e68-memory__measure)')
    .evaluateAll((rows) =>
      rows.map((row) =>
        [...row.querySelectorAll('span')]
          .map((span) => span.textContent ?? '')
          .join('')
          .trimEnd(),
      ),
    );
}

async function firstRow(app: App): Promise<string> {
  return (await memoryRows(app))[0] ?? '';
}

function field(app: App, name: 'Address' | 'From' | 'To' | 'Bytes') {
  return panel(app, 'memory').getByLabel(name, { exact: true });
}

async function showMemory(app: App, address: string): Promise<void> {
  await view(app, 'Memory', 'memory');
  await typeInto(field(app, 'Address'), address);
  await expect(field(app, 'Address')).toHaveValue(address.slice(0, 5) + '0');
}

test('rows of 16 bytes with the address, hex and ASCII (signed-char rule); the address snaps to 16', async ({
  app,
}) => {
  await execute(app, DATA);
  await view(app, 'Memory', 'memory');
  await expect(panel(app, 'memory')).toContainText('00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF');
  await typeInto(field(app, 'Address'), '002005');
  await expect(field(app, 'Address')).toHaveValue('002000');
  // DC.W is aligned to an even address, so $2005 keeps $FF. $41 $42 are shown as themselves, $00
  // and $FF as '-', $7F as itself (drawn as a box: Courier New has no glyph for it).
  await expect
    .poll(() => firstRow(app))
    .toBe('00002000: 41 42 00 7F FF FF CA FE FF FF FF FF FF FF FF FF AB-□------------');
});

test('Row and Page buttons, the arrow keys in the Address field and the wheel move the view', async ({ app }) => {
  await execute(app, DATA);
  await showMemory(app, '002000');
  const memory = panel(app, 'memory');
  await memory.getByRole('button', { name: 'Row down' }).click();
  await expect(field(app, 'Address')).toHaveValue('002010');
  await memory.getByRole('button', { name: 'Row up' }).click();
  await expect(field(app, 'Address')).toHaveValue('002000');
  const rows = (await memoryRows(app)).length;
  expect(rows).toBeGreaterThan(2);
  await memory.getByRole('button', { name: 'Page down' }).click();
  await expect(field(app, 'Address')).toHaveValue((0x2000 + rows * 16).toString(16).toUpperCase().padStart(6, '0'));
  await memory.getByRole('button', { name: 'Page up' }).click();
  await expect(field(app, 'Address')).toHaveValue('002000');
  await field(app, 'Address').press('ArrowDown');
  await expect(field(app, 'Address')).toHaveValue('002010');
  await field(app, 'Address').press('ArrowUp');
  await expect(field(app, 'Address')).toHaveValue('002000');
  await memory.locator('.e68-memory__rows').hover();
  await app.page.mouse.wheel(0, 120);
  await expect.poll(() => field(app, 'Address').inputValue()).not.toBe('002000');
  // The lower limit is 0.
  await typeInto(field(app, 'Address'), '000000');
  await memory.getByRole('button', { name: 'Row up' }).click();
  await expect(field(app, 'Address')).toHaveValue('000000');
});

test('typing in the hex columns sets nibbles; typing in the ASCII column stores the character', async ({
  app,
  page,
}) => {
  await execute(app, DATA);
  await showMemory(app, '002000');
  const rows = panel(app, 'memory').locator('.e68-memory__rows');
  // The keyboard focus puts the cursor on the first byte (no cursor yet).
  await rows.focus();
  await page.keyboard.type('9');
  await page.keyboard.type('c');
  await expect.poll(() => firstRow(app)).toMatch(/^00002000: 9C 42 /);
  // Right arrow: the next byte is the third (skipping nothing more), and digits keep going.
  await page.keyboard.type('01');
  await expect.poll(() => firstRow(app)).toMatch(/^00002000: 9C 01 00 /);
  // A click on the first ASCII cell, then a character.
  const cell = await panel(app, 'memory')
    .locator('.e68-memory__measure')
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width / 10, height: box.height };
    });
  const padding = await rows.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft) || 0);
  await rows.click({ position: { x: padding + 58 * cell.width + cell.width / 2, y: cell.height / 2 } });
  await page.keyboard.type('Z');
  await expect.poll(() => firstRow(app)).toMatch(/^00002000: 5A 01 00 /);
  // A key that is not a hex digit in the hex columns is ignored.
  await rows.click({ position: { x: padding + 13 * cell.width + cell.width / 2, y: cell.height / 2 } });
  await page.keyboard.type('x');
  await expect.poll(() => firstRow(app)).toMatch(/^00002000: 5A 01 00 /);
});

test('Fill writes a 4-byte pattern From through To; Copy copies Bytes bytes; bad ranges are refused', async ({
  app,
}) => {
  await execute(app, DATA);
  await showMemory(app, '003000');
  await typeInto(field(app, 'From'), '003000');
  await typeInto(field(app, 'To'), '003005');
  await typeInto(field(app, 'Bytes'), '12345678');
  await panel(app, 'memory').getByRole('button', { name: 'Fill', exact: true }).click();
  await expect.poll(() => firstRow(app)).toMatch(/^00003000: 12 34 56 78 12 34 FF FF /);
  await typeInto(field(app, 'To'), '003008');
  await typeInto(field(app, 'Bytes'), '00000003');
  await panel(app, 'memory').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(() => firstRow(app)).toMatch(/^00003000: 12 34 56 78 12 34 FF FF 12 34 56 FF /);
  // To = From: `Invalid copy range`.
  await typeInto(field(app, 'To'), '003000');
  await panel(app, 'memory').getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await answer(app, 'OK')).toBe('Invalid copy range');
});

test('Save writes From through To as a raw binary file', async ({ app }) => {
  await execute(app, DATA);
  await view(app, 'Memory', 'memory');
  await typeInto(field(app, 'From'), '002000');
  await typeInto(field(app, 'To'), '002006');
  await panel(app, 'memory').getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = app.dialog('Save As');
  await expect(dialog).toBeVisible();
  await app.fileDialogName(dialog, 'dump.bin', 'Save');
  await expect(dialog).toBeHidden();
  await switchMode(app, 'Editor');
  await expect
    .poll(async () => Array.from(await app.exportFile('dump.bin')))
    .toEqual([0x41, 0x42, 0x00, 0x7f, 0xff, 0xff, 0xca]);
});

test('Save with To before From: Invalid memory range.', async ({ app }) => {
  await execute(app, DATA);
  await view(app, 'Memory', 'memory');
  await typeInto(field(app, 'From'), '002006');
  await typeInto(field(app, 'To'), '002000');
  await panel(app, 'memory').getByRole('button', { name: 'Save', exact: true }).click();
  expect(await answer(app, 'OK', 'Information')).toBe('Invalid memory range.');
});

test('Live repaints rows the running program changes, also at address 0 (note 38); without Live only at the stop', async ({
  app,
}) => {
  await execute(app, program('LOOP ADDQ.B   #1,$0002', '    ADDQ.B  #1,$2000', '    BRA     LOOP'));
  await showMemory(app, '000000');
  const before = await firstRow(app);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  // Without Live the panel stays as it was while the program runs.
  await app.page.waitForTimeout(300);
  expect(await firstRow(app)).toBe(before);
  await panel(app, 'memory').getByRole('checkbox', { name: 'Live' }).check();
  await expect.poll(() => firstRow(app)).not.toBe(before);
  const one = await firstRow(app);
  await expect.poll(() => firstRow(app)).not.toBe(one);
  await app.press('sim.run.pause');
  await expectState(app, 'Stopped');
});

test('Stack: the selected pointer on the middle row, aqua and yellow marks, View A0..SS, spin buttons', async ({
  app,
}) => {
  await execute(app, DATA);
  const stack = await view(app, 'Stack', 'stack');
  const select = stack.getByLabel('View');
  await expect(select).toHaveValue('8');
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'US', 'SS']);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'SS', '00FFFFF8');
  const rows = () =>
    stack.locator('.e68-stack__row:not(.e68-stack__measure)').evaluateAll((items) =>
      items.map((row) => ({
        text: (row.textContent ?? '').trimEnd(),
        marks: [...row.querySelectorAll('[data-mark]')].map(
          (b) => `${b.textContent?.trim()}:${b.getAttribute('data-mark')}`,
        ),
      })),
    );
  await expect
    .poll(async () => (await rows()).find((row) => row.text.startsWith('00FFFFF8:'))?.text)
    .toBe('00FFFFF8: 55 66 77 88');
  const all = await rows();
  const middle = all[Math.floor(all.length / 2)]!;
  expect(middle.text).toBe('00FFFFF8: 55 66 77 88');
  // The selected register (SS) marks its byte aqua ('reg'); it is also the active stack pointer.
  expect(middle.marks).toEqual(['55:reg']);
  expect(all.find((row) => row.text.startsWith('00FFFFFC:'))?.text).toBe('00FFFFFC: 11 22 33 44');
  // A0 = SS + 4: its pointer on the middle row and aqua, the active pointer (SS) yellow ('sp').
  const middleText = async () => {
    const now = await rows();
    return now[Math.floor(now.length / 2)]?.text;
  };
  await select.selectOption({ label: 'A0' });
  await expect.poll(middleText).toBe('00FFFFFC: 11 22 33 44');
  expect((await rows()).flatMap((row) => row.marks)).toEqual(['55:sp', '11:reg']);
  // US: its pointer on the middle row.
  await select.selectOption({ label: 'US' });
  await expect.poll(middleText).toMatch(/^00FF0000: /);
  // The spin buttons move the view by one row (4 bytes) without changing the register.
  await stack.getByRole('button', { name: 'Higher addresses' }).click();
  await expect.poll(middleText).toMatch(/^00FF0004: /);
  await stack.getByRole('button', { name: 'Lower addresses' }).click();
  await expect.poll(middleText).toMatch(/^00FF0000: /);
  // The mouse wheel moves the view by rows of 4 bytes too, and back (sim-ui §11).
  await stack.locator('.e68-stack__rows').hover();
  await app.page.mouse.wheel(0, 100);
  await expect.poll(middleText).not.toMatch(/^00FF0000: /);
  const moved = await middleText();
  expect(moved).toMatch(/^00FF[0-9A-F]{3}[048C]: /);
  await app.page.mouse.wheel(0, -100);
  await expect.poll(middleText).toMatch(/^00FF0000: /);
});
