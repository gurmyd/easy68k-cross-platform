// The Break Points panel: advanced breakpoints (ARCHITECTURE.md 1.3.7 row "EASy68K Advanced Break
// Points"; 2.6; 1.4 note 40; sim-ui §12.2). Owner: X2.
//
// The engine evaluates the expressions (quirks included); these tests prove that what is entered in
// the panel reaches it and stops a program where it should.

import type { Locator } from '@playwright/test';
import { expect, test, type App } from '../fixtures';
import { answer, execute, expectReg, expectState, messages, program, reg, tool, typeInto, view } from './sim';

/** D0 counts up; the word at $2000 is written when D0 reaches 3. */
const COUNT = program(
  'LOOP ADDQ.L  #1,D0',
  '    CMP.L   #3,D0',
  '    BNE     LOOP2',
  '    MOVE.W  #$BEEF,$2000',
  'LOOP2 CMP.L  #10,D0',
  '    BNE     LOOP',
  '    SIMHALT',
);

const cell = (panel: Locator, grid: string, row: number, column = 0) =>
  panel.locator(`[data-bp-group="${grid}"] [role="row"][data-row="${row}"] [role="gridcell"]`).nth(column);
const button = (panel: Locator, name: string) => panel.locator(`[data-bp-button="${name}"]`);

/** The texts of a grid's defined rows (cells joined by |). */
async function rows(panel: Locator, grid: string): Promise<string[]> {
  return panel
    .locator(`[data-bp-group="${grid}"] [role="row"][data-row]`)
    .evaluateAll((items) =>
      items
        .map((row) => [...row.querySelectorAll('[role="gridcell"]')].map((c) => (c.textContent ?? '').trim()).join('|'))
        .filter((text) => text.replace(/\|/g, '') !== ''),
    );
}

/** Enters register condition 1: D0 >= `value` (long). */
async function registerCondition(app: App, panel: Locator, value: string): Promise<void> {
  await cell(panel, 'registers', 0).dblclick();
  await panel.getByLabel('PC/Reg of row 1').selectOption({ label: 'D0' });
  await panel.getByLabel('Op of row 1').selectOption({ label: '>=' });
  await typeInto(panel.getByLabel('Value of row 1'), value);
  await panel.getByLabel('Size of row 1').selectOption({ label: 'L' });
  await button(panel, 'registers-set').click();
  await expect.poll(() => rows(panel, 'registers')).toHaveLength(1);
  void app;
}

/** Builds expression 1 from the builder's buttons: `parts` are 'reg N', 'mem N', 'AND', 'OR'. */
async function expression(panel: Locator, parts: string[]): Promise<void> {
  await cell(panel, 'expressions', 0).dblclick();
  for (const part of parts) {
    const [kind, number] = part.split(' ');
    if (kind === 'reg' || kind === 'mem') {
      await typeInto(panel.locator(`input[data-bp-field="${kind}"]`), number!.padStart(2, '0'));
      await button(panel, kind).click();
    } else {
      await button(panel, kind!.toLowerCase()).click();
    }
  }
  await button(panel, 'expressions-set').click();
  await expect.poll(() => rows(panel, 'expressions')).toHaveLength(1);
}

test('the panel: three groups of 49 numbered rows, every button disabled at first', async ({ app }) => {
  await execute(app, COUNT);
  const panel = await view(app, 'Break Points', 'breakpoints');
  await expect(panel.locator('legend')).toHaveText(['Registers', 'Memory', 'Expression Builder']);
  for (const grid of ['registers', 'memory', 'expressions']) {
    await expect(panel.locator(`[data-bp-group="${grid}"] [role="row"][data-row]`)).toHaveCount(49);
  }
  const enabled = await panel
    .locator('[data-bp-button]')
    .evaluateAll((buttons) =>
      buttons.filter((b) => !(b as HTMLButtonElement).disabled).map((b) => b.getAttribute('data-bp-button')),
    );
  expect(enabled).toEqual([]);
});

test('a register condition in an expression stops Run when D0 reaches the value', async ({ app }) => {
  await execute(app, COUNT);
  const panel = await view(app, 'Break Points', 'breakpoints');
  await registerCondition(app, panel, '00000005');
  expect((await rows(panel, 'registers'))[0]).toMatch(/D0\|>=\|00000005\|L/);
  await expression(panel, ['reg 1']);
  expect((await rows(panel, 'expressions'))[0]).toMatch(/^ON\|\s*R1\s*\|/);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Stopped');
  await expectReg(app, 'D0', '00000005');
  await expect.poll(async () => (await messages(app)).some((line) => line.startsWith('break point at '))).toBe(true);
});

test('a memory access condition stops Run after the instruction that accessed the address', async ({ app }) => {
  await execute(app, COUNT);
  const panel = await view(app, 'Break Points', 'breakpoints');
  await cell(panel, 'memory', 0).dblclick();
  await typeInto(panel.getByLabel('Address of row 1'), '00002000');
  // R/W, not Write: the core reads a MOVE's destination before writing it, and a condition sees
  // either the read or the write of one instruction, the read first (sim-ui §12.2, BPoint.cpp), so
  // `Write` never fires for MOVE to memory - only for a write without a read, such as BSR's push.
  await panel.getByLabel('R/W of row 1').selectOption({ label: 'R/W' });
  await panel.getByLabel('Op of row 1').selectOption({ label: 'N/A' });
  await panel.getByLabel('Address of row 1').press('Enter');
  await expect.poll(() => rows(panel, 'memory')).toEqual(['00002000|N/A|00000000|L|R/W']);
  await expression(panel, ['mem 1']);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Stopped');
  await expectReg(app, 'D0', '00000003');
});

test('the Expression Builder follows the grammar; an undefined condition gives the original box', async ({ app }) => {
  await execute(app, COUNT);
  const panel = await view(app, 'Break Points', 'breakpoints');
  await cell(panel, 'expressions', 0).dblclick();
  // An operand first: PC/Reg, Memory and ( only.
  await expect(button(panel, 'reg')).toBeEnabled();
  await expect(button(panel, 'and')).toBeDisabled();
  await typeInto(panel.locator('input[data-bp-field="reg"]'), '01');
  await button(panel, 'reg').click();
  expect(await answer(app, 'OK')).toBe('Invalid PC/Reg Breakpoint. Set PC/Reg in Registers area first.');
  await panel.locator('[data-bp-draft]').waitFor();
  await panel.getByLabel('Enabled of row 1').press('Escape');
  await expect(panel.locator('[data-bp-draft]')).toHaveCount(0);
  expect(await rows(panel, 'expressions')).toEqual([]);
});

test('Clear of a condition that an expression uses asks first and removes the expression (note 40)', async ({
  app,
}) => {
  await execute(app, COUNT);
  const panel = await view(app, 'Break Points', 'breakpoints');
  await registerCondition(app, panel, '00000005');
  await expression(panel, ['reg 1']);
  await cell(panel, 'registers', 0).click();
  await button(panel, 'registers-clear').click();
  const box = app.messageBox;
  await expect(box).toBeVisible();
  await app
    .button(box, (await box.getByRole('button').allTextContents()).find((t) => /Yes|OK/.test(t))!.trim())
    .click();
  await expect.poll(() => rows(panel, 'registers')).toEqual([]);
  await expect.poll(() => rows(panel, 'expressions')).toEqual([]);
  // The program now runs to its end.
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  expect(await reg(app, 'D0')).toBe('0000000A');
});
