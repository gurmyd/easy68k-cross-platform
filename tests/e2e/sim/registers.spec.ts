// The Registers panel (ARCHITECTURE.md 1.3.5 rows "Registers" and "Editing registers"; 3.11.3; 1.4
// note 31; sim-ui §4). Owner: X2.
//
// The rules: hex fields typed in overwrite mode, SR takes 0 and 1 only; D0-D7, SR and PC reach the
// CPU at the next run command (a display refresh before that, such as Pause, shows the CPU's values
// again), A0-A7, US and SS at once; A7, US and SS mirror each other by the S bit; a double-click on
// PC finds the PC row, on an address register shows the Memory panel at that address.

import { expect, test } from '../fixtures';
import { execute, expectReg, listingRow, panel, program, reg, register, selectedRowText, tool, typeInto } from './sim';

/** Copies D0 and A1 into D6 and D7, so that a step shows what the CPU holds. */
const COPY = program('    MOVE.L  D0,D6', '    MOVE.L  A1,D7', '    NOP', '    NOP', '    SIMHALT');

test('the twenty fields: D0-D7, A0-A7, US, SS, PC in hex, SR in binary under T S  INT   XNZVC', async ({ app }) => {
  await execute(app, COPY);
  const regs = panel(app, 'registers');
  for (const [box, value] of [
    ['D0', '00000000'],
    ['A6', '00000000'],
    ['A7', '01000000'],
    ['US', '00FF0000'],
    ['SS', '01000000'],
    ['PC', '00001000'],
    ['SR', '0010000000000000'],
  ] as const) {
    await expectReg(app, box, value);
  }
  await expect(regs.locator('input[data-box]')).toHaveCount(20);
  await expect(regs).toContainText('T S  INT   XNZVC');
  for (const label of ['D0=', 'D7=', 'A0=', 'A7=', 'US=', 'SS=', 'PC=', 'SR=']) {
    await expect(regs.getByLabel(label, { exact: true })).toHaveCount(1);
  }
});

test('typing overwrites hex digits, lower case becomes upper case, other keys are refused', async ({ app }) => {
  await execute(app, COPY);
  await typeInto(register(app, 'D0'), 'abc');
  await expectReg(app, 'D0', 'ABC00000');
  await register(app, 'D0').press('g');
  await register(app, 'D0').press('-');
  await expectReg(app, 'D0', 'ABC00000');
  await register(app, 'D0').pressSequentially('12');
  await expectReg(app, 'D0', 'ABC12000');
});

test('SR takes 0 and 1 only; another key types a 0; the S bit decides what A7 shows', async ({ app }) => {
  await execute(app, COPY);
  const sr = register(app, 'SR');
  await typeInto(sr, '1');
  await expectReg(app, 'SR', '1010000000000000');
  // An invalid key types a 0 at the caret (sim-ui §4.4, regSRKeyPress): here over the S bit.
  await sr.press('ArrowRight');
  await sr.press('7');
  await expectReg(app, 'SR', '1000000000000000');
  // The S bit is now 0: A7 shows the user stack pointer.
  await expectReg(app, 'A7', '00FF0000');
  await sr.press('ArrowLeft');
  await sr.press('1');
  await expectReg(app, 'SR', '1010000000000000');
  await expectReg(app, 'A7', '01000000');
});

test('D0 reaches the CPU at the next run command; Pause before that shows the CPU value again', async ({ app }) => {
  await execute(app, COPY);
  await typeInto(register(app, 'D0'), '0000BEEF');
  await expectReg(app, 'D0', '0000BEEF');
  await app.press('sim.run.traceInto');
  await expectReg(app, 'D6', '0000BEEF', 'MOVE.L D0,D6 used the edited D0');
  // A register that changed since the last stop is marked (added, note 31); one that did not is not.
  await expect(register(app, 'D6')).toHaveAttribute('data-changed', 'true');
  await expect(register(app, 'D3')).not.toHaveAttribute('data-changed', 'true');
  await typeInto(register(app, 'D0'), '11111111');
  await tool(app, 'sim.run.pause');
  await expectReg(app, 'D0', '0000BEEF', 'Pause shows the CPU registers; the edit had not reached the CPU');
});

test('A1 reaches the CPU at once: Pause keeps it', async ({ app }) => {
  await execute(app, COPY);
  await typeInto(register(app, 'A1'), '00ABCDEF');
  await expectReg(app, 'A1', '00ABCDEF');
  await tool(app, 'sim.run.pause');
  await expectReg(app, 'A1', '00ABCDEF');
  await app.press('sim.run.traceInto');
  await app.press('sim.run.traceInto');
  await expectReg(app, 'D7', '00ABCDEF');
});

test('A7, US and SS mirror each other by the S bit', async ({ app }) => {
  await execute(app, COPY);
  // S = 1 (supervisor): A7 is the supervisor stack pointer.
  await typeInto(register(app, 'A7'), '00002000');
  await expectReg(app, 'SS', '00002000');
  await expectReg(app, 'US', '00FF0000');
  await typeInto(register(app, 'SS'), '00003000');
  await expectReg(app, 'A7', '00003000');
  await typeInto(register(app, 'US'), '00004000');
  await expectReg(app, 'A7', '00003000', 'a US edit does not touch A7 while S = 1');
  await expectReg(app, 'US', '00004000');
});

test('PC edit moves the listing selection; a double-click on PC finds the PC row again', async ({ app }) => {
  await execute(app, COPY);
  const nop = (await listingRow(app, 'NOP').textContent())!.trim().slice(0, 8);
  await typeInto(register(app, 'PC'), nop);
  await expect.poll(() => selectedRowText(app)).toContain('NOP');
  await listingRow(app, 'SIMHALT').click();
  expect(await selectedRowText(app)).toContain('SIMHALT');
  await register(app, 'PC').dblclick();
  await expect.poll(() => selectedRowText(app)).toContain('NOP');
  // The edited PC is used by the next run command.
  await app.press('sim.run.traceInto');
  await expect.poll(() => reg(app, 'PC')).not.toBe(nop);
  expect(await reg(app, 'D6'), 'the MOVE at $1000 was skipped').toBe('00000000');
});

test('a double-click on an address register shows the Memory panel at that address', async ({ app }) => {
  await execute(app, COPY);
  await typeInto(register(app, 'A2'), '00001234');
  await register(app, 'A2').dblclick();
  const memory = panel(app, 'memory');
  await expect(memory).toBeVisible();
  // The memory window snaps the address down to a multiple of 16 (sim-ui §10.3).
  await expect(memory.getByLabel('Address', { exact: true })).toHaveValue('001230');
});

test('the tab order of the original: D0-D7, A0-A7, SR, PC, SS, Clear Cycles, US', async ({ app }) => {
  await execute(app, COPY);
  const order = await panel(app, 'registers')
    .locator('input[data-box], button')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-box') ?? item.textContent?.trim()));
  expect(order).toEqual([...Array.from({ length: 16 }, (_v, i) => String(i)), '19', '18', '17', 'Clear Cycles', '16']);
  // Tab from A7 reaches SR, then PC (fields are Tab stops in every browser).
  await register(app, 'A7').focus();
  await app.page.keyboard.press('Tab');
  await expect(register(app, 'SR')).toBeFocused();
  await app.page.keyboard.press('Tab');
  await expect(register(app, 'PC')).toBeFocused();
});
